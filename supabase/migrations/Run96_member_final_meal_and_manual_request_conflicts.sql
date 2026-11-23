-- Run96: fix member-month final-meal reads and make manager bulk manual requests
-- conflict-aware. Additive RPC-only migration; no tables, columns, triggers,
-- RLS policies, existing request rows, or meal-calculation rules are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $run96_preflight$
DECLARE
  v_internal text;
BEGIN
  IF to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('public.monthly_periods') IS NULL
     OR to_regclass('public.daily_meal_days') IS NULL
     OR to_regclass('public.daily_meal_records') IS NULL
     OR to_regclass('public.meal_requests') IS NULL
     OR to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.my_hostel_id()') IS NULL
     OR to_regprocedure('private.assert_hostel_manager(uuid,uuid,boolean,boolean)') IS NULL
     OR to_regprocedure('private.create_meal_request_internal(uuid,date,date,jsonb,text,boolean,text,text,uuid)') IS NULL
     OR to_regprocedure('public.manager_create_member_meal_requests(uuid[],date,date,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Run96 preflight failed: required Hostel Life membership, meal, request, or secured helper objects are missing; no changes committed.';
  END IF;

  -- Ensure the installed internal request writer is the known duplicate-aware
  -- version before the bulk RPC starts selectively skipping SQLSTATE 23505.
  v_internal := pg_get_functiondef(to_regprocedure(
    'private.create_meal_request_internal(uuid,date,date,jsonb,text,boolean,text,text,uuid)'
  ));
  IF position('এই তারিখের জন্য ইতিমধ্যে একটি সক্রিয় মিল অনুরোধ আছে।' IN v_internal) = 0 THEN
    RAISE EXCEPTION 'Run96 preflight failed: the installed internal meal-request duplicate contract is not the expected version; no changes committed.';
  END IF;
END
$run96_preflight$;

-- Minimal read-only data source for the Person-based Final Meal editor.
-- Access is limited to the primary manager / period-assigned assistant manager
-- using the same guard as manager_set_meal_entries for this exact period.
CREATE OR REPLACE FUNCTION public.manager_get_member_final_meal_month(
  p_member_id uuid,
  p_period_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hostel uuid;
  v_period public.monthly_periods%ROWTYPE;
  v_member public.hostel_memberships%ROWTYPE;
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  v_hostel := private.my_hostel_id();
  PERFORM private.assert_hostel_manager(v_hostel, p_period_id, false, false);

  SELECT * INTO v_period
    FROM public.monthly_periods
   WHERE id = p_period_id
     AND hostel_id = v_hostel
     AND status = 'running';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='চলমান মাসের তথ্য পাওয়া যায়নি। পৃষ্ঠা রিফ্রেশ করে আবার চেষ্টা করুন।', ERRCODE='55000';
  END IF;

  SELECT * INTO v_member
    FROM public.hostel_memberships
   WHERE id = p_member_id
     AND hostel_id = v_hostel
     AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='নির্বাচিত সক্রিয় সদস্যের তথ্য পাওয়া যায়নি।', ERRCODE='42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'daily_meal_day_id', d.id,
        'member_id', v_member.id,
        'planned_breakfast', r.planned_breakfast,
        'planned_lunch', r.planned_lunch,
        'planned_dinner', r.planned_dinner,
        'actual_breakfast', r.actual_breakfast,
        'actual_lunch', r.actual_lunch,
        'actual_dinner', r.actual_dinner,
        'final_breakfast', r.final_breakfast,
        'final_lunch', r.final_lunch,
        'final_dinner', r.final_dinner,
        'cancelled', COALESCE(r.cancelled, false),
        'finalization_source', r.finalization_source,
        'finalized_by', r.finalized_by,
        'finalized_at', r.finalized_at
      ) ORDER BY d.meal_date
    ), '[]'::jsonb
  ) INTO v_result
  FROM public.daily_meal_days d
  JOIN public.daily_meal_records r
    ON r.daily_meal_day_id = d.id
   AND r.member_id = v_member.id
  WHERE d.hostel_id = v_hostel
    AND d.period_id = v_period.id
    AND d.meal_date BETWEEN v_period.start_date AND v_period.end_date;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.manager_get_member_final_meal_month(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_get_member_final_meal_month(uuid,uuid) TO authenticated;

-- Read-only preflight for the Manual Meal Request form. It returns only the
-- members and requested dates that would be rejected by the existing request
-- writer's duplicate predicate; it does not write, reserve, or alter any row.
CREATE OR REPLACE FUNCTION public.manager_preview_member_meal_request_conflicts(
  p_member_ids uuid[],
  p_period_id uuid,
  p_start_date date,
  p_end_date date,
  p_days jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hostel uuid;
  v_period public.monthly_periods%ROWTYPE;
  v_member record;
  v_member_id uuid;
  v_member_count integer;
  v_active_count integer;
  v_requested_date date;
  v_dates jsonb;
  v_conflicts jsonb := '[]'::jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  v_hostel := private.my_hostel_id();
  PERFORM private.assert_hostel_manager(v_hostel, p_period_id, false, false);

  IF p_member_ids IS NULL OR cardinality(p_member_ids) = 0 THEN
    RAISE EXCEPTION USING MESSAGE='অন্তত একজন সক্রিয় সদস্য নির্বাচন করুন।', ERRCODE='22023';
  END IF;
  IF cardinality(p_member_ids) > 200 THEN
    RAISE EXCEPTION USING MESSAGE='একবারে সর্বোচ্চ ২০০ জন সদস্য যাচাই করা যাবে।', ERRCODE='22023';
  END IF;
  SELECT count(DISTINCT requested.member_id)
    INTO v_member_count
    FROM unnest(p_member_ids) AS requested(member_id);
  IF v_member_count <> cardinality(p_member_ids)
     OR EXISTS (SELECT 1 FROM unnest(p_member_ids) AS requested(member_id) WHERE requested.member_id IS NULL) THEN
    RAISE EXCEPTION USING MESSAGE='সদস্য তালিকায় duplicate বা অবৈধ পরিচয় রয়েছে।', ERRCODE='22023';
  END IF;

  SELECT * INTO v_period
    FROM public.monthly_periods
   WHERE id = p_period_id
     AND hostel_id = v_hostel
     AND status = 'running'
     AND p_start_date >= start_date
     AND p_end_date <= end_date;
  IF NOT FOUND OR p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION USING MESSAGE='নির্বাচিত তারিখগুলো চলমান মাসের মধ্যে নেই।', ERRCODE='22023';
  END IF;

  IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array'
     OR jsonb_array_length(p_days) = 0 OR jsonb_array_length(p_days) > 62 THEN
    RAISE EXCEPTION USING MESSAGE='মিলের তারিখের তালিকা সঠিক নয়।', ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_days) AS requested(value)
    WHERE COALESCE(requested.value->>'meal_date','') !~ '^\d{4}-\d{2}-\d{2}$'
       OR (requested.value->>'meal_date')::date < p_start_date
       OR (requested.value->>'meal_date')::date > p_end_date
  ) THEN
    RAISE EXCEPTION USING MESSAGE='মিলের তারিখ শুরুর ও শেষের তারিখের মধ্যে থাকতে হবে।', ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT (requested.value->>'meal_date')::date
      FROM jsonb_array_elements(p_days) AS requested(value)
     GROUP BY (requested.value->>'meal_date')::date
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING MESSAGE='একই তারিখ একাধিকবার দেওয়া হয়েছে।', ERRCODE='22023';
  END IF;

  SELECT count(*) INTO v_active_count
    FROM public.hostel_memberships m
   WHERE m.id = ANY(p_member_ids)
     AND m.hostel_id = v_hostel
     AND m.status = 'active';
  IF v_active_count <> cardinality(p_member_ids) THEN
    RAISE EXCEPTION USING MESSAGE='নির্বাচিত সদস্যদের মধ্যে কেউ এই মেসের সক্রিয় সদস্য নন। তালিকা রিফ্রেশ করে আবার চেষ্টা করুন।', ERRCODE='42501';
  END IF;

  FOR v_member IN
    SELECT m.id AS membership_id,
           COALESCE(NULLIF(btrim(p.full_name),''),'সদস্য') AS member_name
      FROM public.hostel_memberships m
      LEFT JOIN public.profiles p ON p.id = m.user_id
     WHERE m.id = ANY(p_member_ids)
       AND m.hostel_id = v_hostel
       AND m.status = 'active'
     ORDER BY m.id
  LOOP
    v_member_id := v_member.membership_id;
    v_dates := '[]'::jsonb;

    FOR v_requested_date IN
      SELECT DISTINCT (requested.value->>'meal_date')::date
        FROM jsonb_array_elements(p_days) AS requested(value)
       ORDER BY 1
    LOOP
      IF EXISTS (
        SELECT 1
          FROM public.meal_requests other
         WHERE other.hostel_id = v_hostel
           AND other.period_id = v_period.id
           AND other.membership_id = v_member_id
           AND other.status IN ('submitted','approved')
           AND EXISTS (
             SELECT 1
               FROM jsonb_array_elements(other.days) AS existing_day(value)
              WHERE (existing_day.value->>'meal_date')::date = v_requested_date
           )
           AND (
             (other.request_type = 'normal' AND NOT other.is_late_request)
             OR other.status = 'submitted'
             OR EXISTS (
               SELECT 1
                 FROM public.daily_meal_days existing_day_state
                WHERE existing_day_state.period_id = v_period.id
                  AND existing_day_state.meal_date = v_requested_date
                  AND existing_day_state.status <> 'finalized'
             )
           )
      ) THEN
        v_dates := v_dates || jsonb_build_array(v_requested_date);
      END IF;
    END LOOP;

    IF jsonb_array_length(v_dates) > 0 THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'membership_id', v_member_id,
        'member_name', v_member.member_name,
        'meal_dates', v_dates
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('conflicts', v_conflicts);
END;
$function$;

REVOKE ALL ON FUNCTION public.manager_preview_member_meal_request_conflicts(uuid[],uuid,date,date,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_preview_member_meal_request_conflicts(uuid[],uuid,date,date,jsonb) TO authenticated;

-- Keep race protection server-side: a duplicate that appears after preview is
-- skipped for that member only. Any non-duplicate error still aborts the whole
-- transaction, preserving the previous all-or-nothing safety for real failures.
CREATE OR REPLACE FUNCTION public.manager_create_member_meal_requests(
  p_member_ids uuid[],
  p_start_date date,
  p_end_date date,
  p_days jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hostel uuid;
  v_member_id uuid;
  v_selected_count integer;
  v_active_count integer;
  v_created_count integer := 0;
  v_skipped_member_ids uuid[] := ARRAY[]::uuid[];
  v_error_message text;
BEGIN
  PERFORM private.assert_signed_in();
  v_hostel := private.my_hostel_id();
  PERFORM private.assert_hostel_manager(v_hostel, NULL, false, false);

  IF p_member_ids IS NULL OR cardinality(p_member_ids) = 0 THEN
    RAISE EXCEPTION USING MESSAGE='অন্তত একজন সক্রিয় সদস্য নির্বাচন করুন।', ERRCODE='22023';
  END IF;
  IF cardinality(p_member_ids) > 200 THEN
    RAISE EXCEPTION USING MESSAGE='একবারে সর্বোচ্চ ২০০ জন সদস্যের ম্যানুয়াল অনুরোধ তৈরি করা যাবে।', ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_member_ids) AS requested(member_id) WHERE requested.member_id IS NULL) THEN
    RAISE EXCEPTION USING MESSAGE='সদস্য তালিকায় অবৈধ পরিচয় পাওয়া গেছে।', ERRCODE='22023';
  END IF;

  SELECT count(DISTINCT requested.member_id)
    INTO v_selected_count
    FROM unnest(p_member_ids) AS requested(member_id);
  IF v_selected_count <> cardinality(p_member_ids) THEN
    RAISE EXCEPTION USING MESSAGE='একই সদস্য একাধিকবার নির্বাচন করা হয়েছে।', ERRCODE='22023';
  END IF;

  SELECT count(*)
    INTO v_active_count
    FROM public.hostel_memberships membership
   WHERE membership.id = ANY(p_member_ids)
     AND membership.hostel_id = v_hostel
     AND membership.status = 'active';
  IF v_active_count <> cardinality(p_member_ids) THEN
    RAISE EXCEPTION USING MESSAGE='নির্বাচিত সদস্যদের মধ্যে কেউ এই মেসের সক্রিয় সদস্য নন। তালিকা রিফ্রেশ করে আবার চেষ্টা করুন।', ERRCODE='42501';
  END IF;

  FOR v_member_id IN
    SELECT requested.member_id
      FROM unnest(p_member_ids) AS requested(member_id)
     ORDER BY requested.member_id
  LOOP
    BEGIN
      PERFORM private.create_meal_request_internal(
        v_member_id,
        p_start_date,
        p_end_date,
        p_days,
        'normal',
        false,
        'ম্যানেজার কর্তৃক যোগ করা হয়েছে',
        'manager',
        NULL
      );
      v_created_count := v_created_count + 1;
    EXCEPTION WHEN SQLSTATE '23505' THEN
      GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
      IF v_error_message LIKE 'এই তারিখের জন্য ইতিমধ্যে একটি সক্রিয় মিল অনুরোধ আছে.%' THEN
        v_skipped_member_ids := array_append(v_skipped_member_ids, v_member_id);
      ELSE
        RAISE;
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'created_count', v_created_count,
    'skipped_count', cardinality(v_skipped_member_ids),
    'skipped_member_ids', to_jsonb(v_skipped_member_ids)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.manager_create_member_meal_requests(uuid[],date,date,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_create_member_meal_requests(uuid[],date,date,jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
