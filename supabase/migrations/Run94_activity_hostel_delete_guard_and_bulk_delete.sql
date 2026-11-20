-- Run94: preserve Activity Log entries during hostel deletion and add an
-- atomic, explicitly confirmed Super Admin bulk-hostel deletion RPC.
-- Auth users are never deleted in SQL; optional Auth cleanup stays in the
-- existing membership-checking admin-delete-unlinked-user Edge Function.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.hostels') IS NULL
     OR to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('private.hl_activity_events') IS NULL THEN
    RAISE EXCEPTION 'Run94 preflight failed: required Hostel Life relations are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'private' AND table_name = 'hl_activity_events' AND column_name = 'hostel_id'
  ) THEN
    RAISE EXCEPTION 'Run94 preflight failed: private.hl_activity_events.hostel_id is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'private' AND table_name = 'hl_activity_events'
      AND column_name = 'hostel_id' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Run94 preflight failed: private.hl_activity_events.hostel_id must remain nullable to preserve orphaned audit events';
  END IF;
  IF to_regprocedure('public.platform_admin_permanently_delete_hostel(uuid,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'Run94 preflight failed: the existing single-hostel Super Admin delete RPC is missing';
  END IF;
END
$preflight$;

-- A DELETE trigger can emit an activity event after its hostel row has already
-- become invisible. Keep the audit event, but never attach a non-existent
-- hostel FK. FOR KEY SHARE also serializes an event insert against a concurrent
-- hostel DELETE; if the deletion wins, the event is retained with hostel_id NULL.
CREATE OR REPLACE FUNCTION private.hl_activity_events_guard_hostel_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_existing_hostel_id uuid;
BEGIN
  IF NEW.hostel_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT h.id
  INTO v_existing_hostel_id
  FROM public.hostels h
  WHERE h.id = NEW.hostel_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    NEW.hostel_id := NULL;
  END IF;

  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION private.hl_activity_events_guard_hostel_reference() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS hl_activity_events_guard_hostel_reference ON private.hl_activity_events;
CREATE TRIGGER hl_activity_events_guard_hostel_reference
BEFORE INSERT OR UPDATE OF hostel_id ON private.hl_activity_events
FOR EACH ROW
EXECUTE FUNCTION private.hl_activity_events_guard_hostel_reference();

-- This function validates and locks the complete selection before deleting any
-- row. The nested single-hostel RPCs execute in the same outer transaction, so
-- one failure rolls back every selected hostel and all their cascade deletes.
CREATE OR REPLACE FUNCTION public.platform_admin_permanently_delete_hostels(
  p_hostel_ids uuid[],
  p_include_member_user_ids boolean,
  p_confirmation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $bulk$
DECLARE
  v_hostel_id uuid;
  v_locked_ids uuid[] := ARRAY[]::uuid[];
  v_candidate_user_ids uuid[] := ARRAY[]::uuid[];
  v_unique_count integer := 0;
  v_deleted_results jsonb := '[]'::jsonb;
  v_one_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING message = 'শুধু Super Admin একাধিক মেস স্থায়ীভাবে মুছতে পারবেন।', errcode = '42501';
  END IF;

  IF p_hostel_ids IS NULL
     OR pg_catalog.cardinality(p_hostel_ids) < 2
     OR pg_catalog.cardinality(p_hostel_ids) > 25
     OR pg_catalog.array_position(p_hostel_ids, NULL::uuid) IS NOT NULL THEN
    RAISE EXCEPTION USING message = 'একবারে ২–২৫টি ভিন্ন ও বৈধ মেস নির্বাচন করতে হবে।', errcode = '22023';
  END IF;

  SELECT pg_catalog.count(DISTINCT selected_id)::integer
  INTO v_unique_count
  FROM pg_catalog.unnest(p_hostel_ids) AS input_ids(selected_id);
  IF v_unique_count <> pg_catalog.cardinality(p_hostel_ids) THEN
    RAISE EXCEPTION USING message = 'একই মেস একাধিকবার নির্বাচন করা হয়েছে। কোনো পরিবর্তন করা হয়নি।', errcode = '22023';
  END IF;

  IF p_confirmation IS DISTINCT FROM ('DELETE ' || pg_catalog.cardinality(p_hostel_ids)::text || ' HOSTELS') THEN
    RAISE EXCEPTION USING message = 'Bulk delete নিশ্চিতকরণ মেলেনি। কোনো পরিবর্তন করা হয়নি।', errcode = '22023';
  END IF;

  -- Acquire parent locks in deterministic order and fail before mutation if
  -- even one selected hostel no longer exists.
  FOR v_hostel_id IN
    SELECT h.id
    FROM public.hostels h
    WHERE h.id = ANY(p_hostel_ids)
    ORDER BY h.id
    FOR UPDATE
  LOOP
    v_locked_ids := pg_catalog.array_append(v_locked_ids, v_hostel_id);
  END LOOP;

  IF pg_catalog.cardinality(v_locked_ids) <> pg_catalog.cardinality(p_hostel_ids) THEN
    RAISE EXCEPTION USING message = 'নির্বাচিত মেসের একটি বা একাধিক রেকর্ড আর পাওয়া যাচ্ছে না। কোনো মেস মুছে ফেলা হয়নি।', errcode = 'P0002';
  END IF;

  -- Capture only UUIDs that were members of the selected hostels before
  -- cascade deletion. The Edge Function checks all remaining memberships and
  -- the Super Admin role again after this transaction commits.
  IF COALESCE(p_include_member_user_ids, false) THEN
    SELECT COALESCE(
      pg_catalog.array_agg(candidate.user_id ORDER BY candidate.user_id),
      ARRAY[]::uuid[]
    )
    INTO v_candidate_user_ids
    FROM (
      SELECT DISTINCT m.user_id
      FROM public.hostel_memberships m
      WHERE m.hostel_id = ANY(v_locked_ids)
        AND m.user_id IS NOT NULL
        AND m.user_id <> auth.uid()
    ) AS candidate;
  END IF;

  FOR v_hostel_id IN
    SELECT selected_id
    FROM pg_catalog.unnest(v_locked_ids) AS selected_ids(selected_id)
    ORDER BY selected_id
  LOOP
    v_one_result := public.platform_admin_permanently_delete_hostel(
      v_hostel_id,
      false,
      'DELETE HOSTEL ' || v_hostel_id::text
    );
    v_deleted_results := v_deleted_results || pg_catalog.jsonb_build_array(v_one_result);
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'deleted',
    'hostel_count', pg_catalog.cardinality(v_locked_ids),
    'hostels', v_deleted_results,
    'candidate_user_ids', pg_catalog.to_jsonb(v_candidate_user_ids),
    'auth_cleanup_separate', true
  );
END
$bulk$;

REVOKE ALL ON FUNCTION public.platform_admin_permanently_delete_hostels(uuid[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_permanently_delete_hostels(uuid[], boolean, text) TO authenticated;

COMMIT;
