-- Hostel Life platform-admin final repair (2026-10-29)
-- Fixes realtime beacon inserts during cascading deletes and makes hostel deletion order-safe.
-- IMPORTANT: take a database backup first. No FK rules are changed and Auth users are never deleted here.
BEGIN;

-- The beacon triggers run after DELETE/UPDATE on meal-day tables. During a cascading
-- delete, their parent period/hostel may already be disappearing. Do not recreate
-- a beacon unless BOTH parent rows still exist. This prevents a snapshot FK violation.
CREATE OR REPLACE FUNCTION private.bump_realtime_beacon()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_hostel uuid;
  v_period uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_hostel := OLD.hostel_id;
    v_period := OLD.period_id;
  ELSE
    v_hostel := NEW.hostel_id;
    v_period := NEW.period_id;
  END IF;

  IF v_hostel IS NULL OR v_period IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- The delete RPC marks the hostel in a transaction-local setting before its
  -- cascade starts. This explicit guard is deterministic even while PostgreSQL
  -- is processing the parent's FK cascade and FK checks can no longer see it.
  IF current_setting('hostel_lifecycle.deleting_hostel', true) = v_hostel::text THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- A real change to an existing period should still bump realtime. A cascade
  -- after its period/hostel has gone must be ignored instead of inserting stale FK rows.
  IF NOT EXISTS (
      SELECT 1 FROM public.hostels h WHERE h.id = v_hostel
    ) OR NOT EXISTS (
      SELECT 1 FROM public.monthly_periods p
      WHERE p.id = v_period AND p.hostel_id = v_hostel
    ) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_TABLE_NAME = 'meal_requests' THEN
    INSERT INTO public.meal_late_overrides(hostel_id, period_id, touched_at)
    VALUES (v_hostel, v_period, clock_timestamp())
    ON CONFLICT (hostel_id, period_id)
    DO UPDATE SET touched_at = EXCLUDED.touched_at;
  ELSE
    INSERT INTO public.daily_meal_snapshots(hostel_id, period_id, touched_at)
    VALUES (v_hostel, v_period, clock_timestamp())
    ON CONFLICT (hostel_id, period_id)
    DO UPDATE SET touched_at = EXCLUDED.touched_at;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$fn$;

-- Delete non-cascading summary rows first, then the period tree while the hostel
-- still exists. The beacon guard above prevents cascade cleanup from creating
-- orphan snapshot rows. Auth users are deliberately left to the separate guarded
-- Edge Function and cannot be removed by this database RPC.
CREATE OR REPLACE FUNCTION public.platform_admin_permanently_delete_hostel(
  p_hostel_id uuid,
  p_delete_member_accounts boolean,
  p_confirmation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_name text;
  v_deleted integer := 0;
  v_member_count integer := 0;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING message = 'শুধু Super Admin মেস স্থায়ীভাবে মুছতে পারবেন।', errcode = '42501';
  END IF;
  IF p_confirmation IS DISTINCT FROM ('DELETE HOSTEL ' || p_hostel_id::text) THEN
    RAISE EXCEPTION USING message = 'স্থায়ীভাবে মুছে ফেলার নিশ্চিতকরণ মেলেনি। কোনো পরিবর্তন করা হয়নি।', errcode = '22023';
  END IF;

  SELECT h.name INTO v_name
  FROM public.hostels h
  WHERE h.id = p_hostel_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message = 'মেসটি পাওয়া যায়নি।', errcode = 'P0002';
  END IF;

  SELECT count(*)::integer INTO v_member_count
  FROM public.hostel_memberships m WHERE m.hostel_id = p_hostel_id;

  -- Suppress realtime beacon writes for this hostel only for the duration of
  -- this transaction, before any child-row cascade can fire its DELETE triggers.
  PERFORM set_config('hostel_lifecycle.deleting_hostel', p_hostel_id::text, true);

  -- These summary tables may have NO ACTION foreign keys; remove them first.
  IF to_regclass('public.hl_period_summary_snapshots') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.hl_period_summary_snapshots WHERE hostel_id = $1 OR period_id IN (SELECT id FROM public.monthly_periods WHERE hostel_id = $1)'
      USING p_hostel_id;
  END IF;
  IF to_regclass('public.hl_archived_final_summaries') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.hl_archived_final_summaries WHERE hostel_id = $1 OR period_id IN (SELECT id FROM public.monthly_periods WHERE hostel_id = $1)'
      USING p_hostel_id;
  END IF;

  -- Remove period cascades while the hostel parent still exists. Realtime
  -- triggers now safely ignore any row whose parent period is being removed.
  DELETE FROM public.monthly_periods WHERE hostel_id = p_hostel_id;

  -- Cleanup anything not removed by the period cascade. ON DELETE CASCADE FKs
  -- remain unchanged; there is no need to alter the schema's deletion rules.
  IF to_regclass('public.daily_meal_snapshots') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.daily_meal_snapshots WHERE hostel_id = $1' USING p_hostel_id;
  END IF;
  IF to_regclass('public.meal_late_overrides') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.meal_late_overrides WHERE hostel_id = $1' USING p_hostel_id;
  END IF;

  DELETE FROM public.hostels WHERE id = p_hostel_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION USING message = 'মেসের রেকর্ড স্থায়ীভাবে সরানো যায়নি।', errcode = '55000';
  END IF;

  INSERT INTO public.platform_audit_log(actor_user_id, action, target_type, target_id, reason, details)
  VALUES (
    auth.uid(), 'hostel_permanently_deleted', 'hostel', p_hostel_id::text, 'Super Delete',
    jsonb_build_object(
      'name', v_name,
      'member_count_at_delete', v_member_count,
      'member_accounts_deleted', 0,
      'auth_cleanup_separate', true,
      'summary_snapshots_removed', true,
      'realtime_beacon_guard', true
    )
  );

  RETURN jsonb_build_object(
    'status', 'deleted',
    'hostel_id', p_hostel_id,
    'hostel_name', v_name,
    'member_accounts_deleted', 0,
    'member_count_at_delete', v_member_count,
    'auth_cleanup_separate', true
  );
END
$fn$;

-- Member deletion intentionally never touches auth.users. The boolean argument
-- remains for RPC compatibility, but Auth deletion is delegated to the verified
-- Edge Function, which checks every hostel membership immediately before deletion.
CREATE OR REPLACE FUNCTION public.platform_admin_permanently_delete_member(
  p_hostel_id uuid,
  p_membership_id uuid,
  p_delete_auth_account boolean,
  p_confirmation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_member public.hostel_memberships%ROWTYPE;
  v_user uuid;
  v_name text;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING message = 'শুধু Super Admin সদস্য স্থায়ীভাবে মুছতে পারবেন।', errcode = '42501';
  END IF;

  SELECT * INTO v_member
  FROM public.hostel_memberships
  WHERE id = p_membership_id AND hostel_id = p_hostel_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message = 'সদস্যটি এই মেসে পাওয়া যায়নি।', errcode = 'P0002';
  END IF;

  v_user := v_member.user_id;
  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = v_user;
  IF p_confirmation IS DISTINCT FROM ('DELETE MEMBER ' || v_user::text) THEN
    RAISE EXCEPTION USING message = 'স্থায়ীভাবে মুছে ফেলার নিশ্চিতকরণ মেলেনি। কোনো পরিবর্তন করা হয়নি।', errcode = '22023';
  END IF;
  IF v_user = auth.uid() THEN
    RAISE EXCEPTION USING message = 'নিজের Super Admin account এভাবে মুছতে পারবেন না।', errcode = '42501';
  END IF;

  -- Remove only this member's data from this hostel. Auth is preserved here.
  DELETE FROM public.daily_meal_records WHERE member_id = v_member.id AND hostel_id = p_hostel_id;
  DELETE FROM public.meal_requests WHERE membership_id = v_member.id AND hostel_id = p_hostel_id;
  DELETE FROM public.ledger_transactions WHERE member_id = v_member.id AND hostel_id = p_hostel_id;
  DELETE FROM public.khala_money_entries WHERE member_id = v_member.id AND hostel_id = p_hostel_id;
  DELETE FROM public.market_entries WHERE buyer_membership_id = v_member.id AND hostel_id = p_hostel_id;
  DELETE FROM public.period_assistant_managers WHERE membership_id = v_member.id AND hostel_id = p_hostel_id;
  DELETE FROM public.archive_edit_permissions WHERE membership_id = v_member.id AND hostel_id = p_hostel_id;
  DELETE FROM public.hostel_memberships WHERE id = v_member.id AND hostel_id = p_hostel_id;

  INSERT INTO public.platform_audit_log(actor_user_id, action, target_type, target_id, reason, details)
  VALUES (
    auth.uid(), 'member_permanently_deleted', 'member', v_member.id::text, 'Super Delete',
    jsonb_build_object(
      'user_id', v_user,
      'hostel_id', p_hostel_id,
      'name', v_name,
      'auth_account_deleted', false,
      'auth_cleanup_separate', true,
      'auth_delete_requested', coalesce(p_delete_auth_account, false)
    )
  );

  RETURN jsonb_build_object(
    'status', 'deleted', 'membership_id', v_member.id, 'user_id', v_user,
    'auth_account_deleted', false, 'auth_cleanup_separate', true
  );
END
$fn$;

-- Read-only closed-period directory. A period being short-lived does not make it
-- disappear from this list; visibility is separate from deletion eligibility.
CREATE OR REPLACE FUNCTION public.platform_admin_list_closed_periods()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $catalog$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING message = 'Super Admin only', errcode = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'hostel_id', q.hostel_id,
    'hostel_name', q.hostel_name,
    'period_id', q.period_id,
    'period_label', q.period_label,
    'start_date', q.start_date,
    'end_date', q.end_date,
    'detail_until', q.detail_until,
    'delete_eligible_after', q.delete_eligible_after
  ) ORDER BY q.end_date DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT mp.hostel_id, h.name AS hostel_name, mp.id AS period_id,
      mp.label AS period_label, mp.start_date, mp.end_date,
      (mp.end_date + make_interval(months => rp.detail_months))::date AS detail_until,
      (mp.end_date + make_interval(months => rp.detail_months + rp.summary_months))::date AS delete_eligible_after
    FROM public.monthly_periods mp
    JOIN public.hostels h ON h.id = mp.hostel_id
    CROSS JOIN public.platform_retention_policy rp
    WHERE rp.singleton = true AND mp.status IN ('closed', 'archived')
    ORDER BY mp.end_date DESC, mp.created_at DESC
    LIMIT 300
  ) q;
  RETURN v_result;
END
$catalog$;

REVOKE ALL ON FUNCTION public.platform_admin_permanently_delete_hostel(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_permanently_delete_hostel(uuid, boolean, text) TO authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_list_closed_periods() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_closed_periods() TO authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_permanently_delete_member(uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_permanently_delete_member(uuid, uuid, boolean, text) TO authenticated;

COMMIT;
