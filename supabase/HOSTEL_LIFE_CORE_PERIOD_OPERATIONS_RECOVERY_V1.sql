-- ============================================================================
-- HOSTEL LIFE — CORE PERIOD & OPERATIONS RECOVERY V1
-- Controlled recovery for the application's month/period operational core.
--
-- PURPOSE
--   * Establish one canonical, server-side current-period authority.
--   * Repair a stale RUNNING period whose end_date fell behind today's date
--     while still inside the same calendar month.
--   * Ensure period days exist through the repaired end_date.
--   * Make month-management context internally consistent with the frontend.
--   * Restore one-argument and two-argument start_new_month wrappers.
--   * Make close_current_month use a reliable current-period boundary.
--   * Correct archived Khala-money permission window to period.end_date + 15 days.
--   * Add safe v2 read RPCs for manager meal requests, market history/detail,
--     and Khala-money history so broken legacy read paths no longer block UI.
--   * Preserve all business rows; no DROP/TRUNCATE and no automatic deletion of
--     historical records.
--   * Preserve the two previously observed historical meal-request overlaps.
--
-- IMPORTANT
--   Execute the ENTIRE file once in Supabase SQL Editor.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_advisory_xact_lock(
  hashtextextended('hostel-life:core-period-operations-recovery:v1', 0)
);

-- --------------------------------------------------------------------------
-- 0) Required-shape guard. Abort before writes if the known Hostel Life core
--    objects are not present.
-- --------------------------------------------------------------------------
DO $guard$
DECLARE
  v_missing text := '';
  v_obj text;
BEGIN
  FOREACH v_obj IN ARRAY ARRAY[
    'public.hostels',
    'public.hostel_memberships',
    'public.profiles',
    'public.monthly_periods',
    'public.daily_meal_days',
    'public.daily_meal_records',
    'public.meal_requests',
    'public.meal_request_days',
    'public.khala_money_entries',
    'public.market_entries',
    'public.market_items',
    'public.ledger_transactions',
    'public.period_assistant_managers',
    'public.notifications'
  ] LOOP
    IF to_regclass(v_obj) IS NULL THEN
      v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || v_obj;
    END IF;
  END LOOP;

  IF to_regprocedure('private.assert_authenticated()') IS NULL THEN
    v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'private.assert_authenticated()';
  END IF;
  IF to_regprocedure('private.current_hostel_id(boolean)') IS NULL THEN
    v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'private.current_hostel_id(boolean)';
  END IF;
  IF to_regprocedure('private.current_membership_id(boolean)') IS NULL THEN
    v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'private.current_membership_id(boolean)';
  END IF;
  IF to_regprocedure('private.current_local_date(uuid)') IS NULL THEN
    v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'private.current_local_date(uuid)';
  END IF;
  IF to_regprocedure('private.ensure_period_days(uuid)') IS NULL THEN
    v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'private.ensure_period_days(uuid)';
  END IF;
  IF to_regprocedure('private.start_next_period(date,date)') IS NULL THEN
    v_missing := v_missing || CASE WHEN v_missing = '' THEN '' ELSE ', ' END || 'private.start_next_period(date,date)';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION USING
      message = 'Core Period Recovery aborted. Required object(s) missing: ' || v_missing;
  END IF;
END
$guard$;

-- --------------------------------------------------------------------------
-- 1) Canonical stale-running-period reconciliation.
--
-- A RUNNING period is not allowed to silently fall behind today's date while
-- still belonging to the same calendar month. When this is detected, extend
-- its operational end_date to that calendar month's natural end. Historical
-- archived periods are never touched.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.reconcile_running_period(
  p_hostel_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $reconcile$
DECLARE
  v_period public.monthly_periods;
  v_count integer := 0;
  v_today date;
  v_calendar_end date;
  v_old_end date;
  v_repaired boolean := false;
BEGIN
  IF p_hostel_id IS NULL THEN
    RETURN jsonb_build_object('period_id', NULL, 'repaired', false, 'reason', 'no_hostel');
  END IF;

  SELECT count(*) INTO v_count
  FROM public.monthly_periods
  WHERE hostel_id = p_hostel_id
    AND status = 'running';

  IF v_count > 1 THEN
    RAISE EXCEPTION USING
      message = 'এই মেসে একাধিক চলমান মাস পাওয়া গেছে। আগে period conflict যাচাই করতে হবে।';
  END IF;

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE hostel_id = p_hostel_id
    AND status = 'running'
  ORDER BY start_date DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_period.id IS NULL THEN
    RETURN jsonb_build_object('period_id', NULL, 'repaired', false, 'reason', 'no_running_period');
  END IF;

  v_today := private.current_local_date(p_hostel_id);
  v_calendar_end := (date_trunc('month', v_period.start_date) + interval '1 month - 1 day')::date;
  v_old_end := v_period.end_date;

  -- A stale end_date within the same calendar month is a broken operational
  -- boundary, not a legitimate archived period.
  IF v_period.end_date < v_today AND v_today <= v_calendar_end THEN
    UPDATE public.monthly_periods
    SET end_date = v_calendar_end,
        updated_at = now()
    WHERE id = v_period.id;

    PERFORM private.ensure_period_days(v_period.id);
    v_repaired := true;

    SELECT * INTO v_period
    FROM public.monthly_periods
    WHERE id = v_period.id;
  END IF;

  RETURN jsonb_build_object(
    'period_id', v_period.id,
    'label', v_period.label,
    'start_date', v_period.start_date,
    'end_date', v_period.end_date,
    'status', v_period.status,
    'today', v_today,
    'calendar_end', v_calendar_end,
    'old_end_date', v_old_end,
    'repaired', v_repaired
  );
END
$reconcile$;

-- --------------------------------------------------------------------------
-- 2) Replace the period resolver used by operational write functions.
--
-- Normal behavior: return the period containing p_date.
-- Recovery behavior: if there is exactly one RUNNING period in the same
-- calendar month but its stored end_date is stale, repair it and return it.
-- This is the critical bridge for market/deposit/expense/meal writes.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.period_for_hostel_date(
  p_hostel_id uuid,
  p_date date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $period_resolver$
DECLARE
  v_period uuid;
  v_running public.monthly_periods;
  v_count integer := 0;
  v_calendar_end date;
  v_today date;
BEGIN
  IF p_hostel_id IS NULL OR p_date IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT mp.id INTO v_period
  FROM public.monthly_periods mp
  WHERE mp.hostel_id = p_hostel_id
    AND mp.start_date <= p_date
    AND p_date <= mp.end_date
    AND mp.status IN ('running', 'archived')
  ORDER BY
    CASE WHEN mp.status = 'running' THEN 0 ELSE 1 END,
    mp.start_date DESC,
    mp.created_at DESC
  LIMIT 1;

  IF v_period IS NOT NULL THEN
    RETURN v_period;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.monthly_periods
  WHERE hostel_id = p_hostel_id
    AND status = 'running';

  IF v_count <> 1 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_running
  FROM public.monthly_periods
  WHERE hostel_id = p_hostel_id
    AND status = 'running'
  ORDER BY start_date DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  v_calendar_end := (date_trunc('month', v_running.start_date) + interval '1 month - 1 day')::date;

  -- Allow the resolver to recover a stale current month for dates that are
  -- within the month itself. It will not extend a period beyond its natural
  -- calendar-month boundary and will not alter archived periods.
  IF p_date >= v_running.start_date
     AND p_date <= v_calendar_end
     AND v_running.end_date < p_date THEN
    UPDATE public.monthly_periods
    SET end_date = v_calendar_end,
        updated_at = now()
    WHERE id = v_running.id;

    PERFORM private.ensure_period_days(v_running.id);
    RETURN v_running.id;
  END IF;

  RETURN NULL;
END
$period_resolver$;

-- Immediately reconcile existing live RUNNING periods once during this migration.
-- Only one running period per hostel is accepted; its missing daily days are also
-- re-created through the existing helper. No archived rows are touched.
DO $initial_repair$
DECLARE
  v_hostel uuid;
BEGIN
  FOR v_hostel IN SELECT id FROM public.hostels LOOP
    PERFORM private.reconcile_running_period(v_hostel);
    IF EXISTS (SELECT 1 FROM public.monthly_periods mp WHERE mp.hostel_id=v_hostel AND mp.status='running') THEN
      PERFORM private.ensure_period_days((
        SELECT mp.id
        FROM public.monthly_periods mp
        WHERE mp.hostel_id=v_hostel AND mp.status='running'
        ORDER BY mp.start_date DESC,mp.created_at DESC
        LIMIT 1
      ));
    END IF;
  END LOOP;
END
$initial_repair$;

-- --------------------------------------------------------------------------
-- 3) Canonical current-period context. This is the single frontend contract
--    for knowing which month is currently operational.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_running_period_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $running_context$
DECLARE
  v_hostel uuid;
  v_reconciled jsonb;
  v_period public.monthly_periods;
  v_today date;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  IF v_hostel IS NULL THEN
    RAISE EXCEPTION USING message = 'আপনি কোনো মেসের সদস্য নন।';
  END IF;

  v_reconciled := private.reconcile_running_period(v_hostel);
  v_today := private.current_local_date(v_hostel);

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE id = NULLIF(v_reconciled->>'period_id','')::uuid;

  RETURN jsonb_build_object(
    'period', CASE WHEN v_period.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_period.id,
      'period_id', v_period.id,
      'label', v_period.label,
      'start_date', v_period.start_date,
      'end_date', v_period.end_date,
      'status', v_period.status,
      'primary_manager_membership_id', v_period.primary_manager_membership_id,
      'manager_at_start_membership_id', v_period.manager_at_start_membership_id,
      'manager_at_close_membership_id', v_period.manager_at_close_membership_id,
      'is_current_for_today', (v_today BETWEEN v_period.start_date AND v_period.end_date),
      'calendar_end', (date_trunc('month', v_period.start_date) + interval '1 month - 1 day')::date
    ) END,
    'today', v_today,
    'running_period_count', (SELECT count(*) FROM public.monthly_periods mp WHERE mp.hostel_id=v_hostel AND mp.status='running'),
    'has_running_period', (v_period.id IS NOT NULL),
    'reconciled', coalesce((v_reconciled->>'repaired')::boolean, false)
  );
END
$running_context$;

GRANT EXECUTE ON FUNCTION public.get_running_period_context() TO authenticated;

-- --------------------------------------------------------------------------
-- 4) Month-management context. Keeps the exact fields used by New Month,
--    Close Month and Assistant Manager screens, with period_id + id aliases.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_month_management_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $management_context$
DECLARE
  v_hostel uuid;
  v_actor uuid;
  v_today date;
  v_period public.monthly_periods;
  v_last_archived public.monthly_periods;
  v_running_count integer := 0;
  v_next_start date;
  v_is_primary boolean := false;
  v_assistants jsonb := '[]'::jsonb;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  v_actor := private.current_membership_id(true);
  IF v_hostel IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION USING message = 'মেসের সক্রিয় সদস্য হওয়া প্রয়োজন।';
  END IF;

  PERFORM private.reconcile_running_period(v_hostel);
  v_today := private.current_local_date(v_hostel);

  SELECT count(*) INTO v_running_count
  FROM public.monthly_periods
  WHERE hostel_id=v_hostel AND status='running';

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE hostel_id=v_hostel AND status='running'
  ORDER BY start_date DESC, created_at DESC
  LIMIT 1;

  IF v_period.id IS NOT NULL THEN
    v_is_primary := v_period.primary_manager_membership_id = v_actor;
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'membership_id', hm.id,
        'member_name', p.full_name,
        'name', p.full_name,
        'status', hm.status,
        'assigned_at', pam.created_at
      ) ORDER BY p.full_name
    ), '[]'::jsonb)
    INTO v_assistants
    FROM public.period_assistant_managers pam
    JOIN public.hostel_memberships hm ON hm.id=pam.membership_id
    JOIN public.profiles p ON p.id=hm.user_id
    WHERE pam.period_id=v_period.id;
  ELSE
    SELECT * INTO v_last_archived
    FROM public.monthly_periods
    WHERE hostel_id=v_hostel AND status='archived'
    ORDER BY end_date DESC, created_at DESC
    LIMIT 1;
    v_next_start := coalesce(v_last_archived.end_date + 1, v_today);
  END IF;

  IF v_period.id IS NOT NULL THEN
    v_next_start := v_period.end_date + 1;
  END IF;

  RETURN jsonb_build_object(
    'today', v_today,
    'has_running_period', v_period.id IS NOT NULL,
    'running_period_count', v_running_count,
    'can_manage_month', v_is_primary,
    'can_manage_operations', v_is_primary OR exists(
      SELECT 1 FROM public.period_assistant_managers pam
      WHERE pam.period_id=v_period.id AND pam.membership_id=v_actor
    ),
    'period', CASE WHEN v_period.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_period.id,
      'period_id', v_period.id,
      'label', v_period.label,
      'start_date', v_period.start_date,
      'end_date', v_period.end_date,
      'status', v_period.status,
      'primary_manager_membership_id', v_period.primary_manager_membership_id,
      'is_primary_manager', v_is_primary,
      'assistant_managers', v_assistants,
      'is_current_for_today', (v_today BETWEEN v_period.start_date AND v_period.end_date),
      'calendar_end', (date_trunc('month', v_period.start_date) + interval '1 month - 1 day')::date
    ) END,
    'next_required_start_date', v_next_start
  );
END
$management_context$;

GRANT EXECUTE ON FUNCTION public.get_month_management_context() TO authenticated;

-- --------------------------------------------------------------------------
-- 5) Start-month wrappers. The frontend currently calls start_new_month(date),
--    while the underlying hardened helper takes both start and end dates.
--    Default end is always the natural calendar-month end.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_new_month(p_start_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $start_one$
DECLARE
  v_end date;
BEGIN
  v_end := (date_trunc('month', p_start_date) + interval '1 month - 1 day')::date;
  RETURN private.start_next_period(p_start_date, v_end);
END
$start_one$;

CREATE OR REPLACE FUNCTION public.start_new_month(p_start_date date, p_end_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $start_two$
DECLARE
  v_end date;
BEGIN
  v_end := coalesce(
    p_end_date,
    (date_trunc('month', p_start_date) + interval '1 month - 1 day')::date
  );
  RETURN private.start_next_period(p_start_date, v_end);
END
$start_two$;

GRANT EXECUTE ON FUNCTION public.start_new_month(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_new_month(date,date) TO authenticated;

-- --------------------------------------------------------------------------
-- 6) Reliable month-close implementation. If a running period's end_date is
--    stale but the calendar month is still current, the reconciliation above
--    restores it before close. If the calendar month already passed, close at
--    the natural calendar end rather than at an obsolete stale date.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_current_month(p_confirm_future_cancel boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $close_month$
DECLARE
  v_hostel uuid;
  v_actor uuid;
  v_today date;
  v_period public.monthly_periods;
  v_calendar_end date;
  v_close_date date;
  v_future_count integer := 0;
  v_cancel jsonb := '{}'::jsonb;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  v_actor := private.current_membership_id(true);
  v_today := private.current_local_date(v_hostel);

  PERFORM private.reconcile_running_period(v_hostel);

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE hostel_id=v_hostel AND status='running'
  ORDER BY start_date DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION USING message='কোনো চলমান মাস পাওয়া যায়নি।';
  END IF;
  IF v_period.primary_manager_membership_id <> v_actor THEN
    RAISE EXCEPTION USING message='শুধু প্রধান ম্যানেজার বর্তমান মাস শেষ করতে পারবেন।';
  END IF;
  IF v_today < v_period.start_date THEN
    RAISE EXCEPTION USING message='মাসের শুরুর তারিখ এখনও আসেনি।';
  END IF;

  v_calendar_end := (date_trunc('month', v_period.start_date) + interval '1 month - 1 day')::date;
  v_close_date := CASE
    WHEN v_today < v_calendar_end THEN v_today
    ELSE v_calendar_end
  END;

  IF v_close_date < v_period.start_date THEN
    RAISE EXCEPTION USING message='মাসের বৈধ শেষ তারিখ নির্ধারণ করা যায়নি।';
  END IF;

  SELECT count(*) INTO v_future_count
  FROM public.meal_requests mr
  WHERE mr.period_id=v_period.id
    AND mr.status IN ('submitted','approved')
    AND mr.end_date > v_close_date;

  IF v_future_count>0 AND NOT p_confirm_future_cancel THEN
    RAISE EXCEPTION USING message=format(
      'FUTURE_REQUEST_CONFIRMATION_REQUIRED: এই মাসের %sটি ভবিষ্যতের মিল রিকোয়েস্ট বর্তমান close date-এর পরে রয়েছে। নিশ্চিত করলে সেগুলো বাতিল হবে।',
      v_future_count
    );
  END IF;

  IF v_future_count>0 THEN
    v_cancel := private.cancel_period_after_date(v_period.id,v_close_date);
  ELSE
    v_cancel := '{}'::jsonb;
  END IF;

  UPDATE public.monthly_periods
  SET end_date=v_close_date,
      status='archived',
      archived_at=coalesce(archived_at,now()),
      manager_at_close_membership_id=v_actor,
      updated_at=now()
  WHERE id=v_period.id;

  PERFORM public.generate_monthly_summary(v_period.id);

  INSERT INTO public.notifications(
    hostel_id,notification_type,title,body,created_by
  ) VALUES(
    v_hostel,
    'system',
    'মাস শেষ হয়েছে',
    v_period.label||' মাস বন্ধ করা হয়েছে। কার্যকর শেষ তারিখ: '||to_char(v_close_date,'DD Mon YYYY')||'.',
    v_actor
  );

  RETURN jsonb_build_object(
    'period_id',v_period.id,
    'label',v_period.label,
    'closed_date',v_close_date,
    'calendar_end',v_calendar_end,
    'future_request_count',v_future_count,
    'cancel_result',v_cancel,
    'status','archived'
  );
END
$close_month$;

GRANT EXECUTE ON FUNCTION public.close_current_month(boolean) TO authenticated;

-- --------------------------------------------------------------------------
-- 7) Month close preflight. Same business contract as existing frontend, but
--    now reconciles stale period state before counting future requests.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_month_close_preflight()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $close_preflight$
DECLARE
  v_hostel uuid;
  v_actor uuid;
  v_today date;
  v_period public.monthly_periods;
  v_running_count integer := 0;
  v_future_count integer := 0;
  v_overlap_pairs integer := 0;
  v_calendar_end date;
  v_default_close date;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  v_actor := private.current_membership_id(true);
  IF v_hostel IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION USING message='মেসের সক্রিয় সদস্য হওয়া প্রয়োজন।';
  END IF;

  PERFORM private.reconcile_running_period(v_hostel);
  v_today := private.current_local_date(v_hostel);

  SELECT count(*) INTO v_running_count
  FROM public.monthly_periods
  WHERE hostel_id=v_hostel AND status='running';

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE hostel_id=v_hostel AND status='running'
  ORDER BY start_date DESC,created_at DESC
  LIMIT 1;

  IF v_period.id IS NOT NULL THEN
    v_calendar_end := (date_trunc('month', v_period.start_date) + interval '1 month - 1 day')::date;
    v_default_close := CASE WHEN v_today < v_calendar_end THEN v_today ELSE v_calendar_end END;

    SELECT count(*) INTO v_future_count
    FROM public.meal_requests mr
    WHERE mr.period_id=v_period.id
      AND mr.status IN ('submitted','approved')
      AND mr.end_date>v_default_close;

    SELECT count(*) INTO v_overlap_pairs
    FROM public.meal_requests a
    JOIN public.meal_requests b
      ON b.id>a.id
     AND b.period_id=a.period_id
     AND b.member_id=a.member_id
     AND b.request_type='normal'
     AND a.request_type='normal'
     AND b.status IN ('submitted','approved')
     AND a.status IN ('submitted','approved')
     AND a.start_date<=b.end_date
     AND b.start_date<=a.end_date
    WHERE a.period_id=v_period.id;
  END IF;

  RETURN jsonb_build_object(
    'period_id',v_period.id,
    'period_label',v_period.label,
    'today',v_today,
    'running_period_count',v_running_count,
    'future_active_request_count',v_future_count,
    'overlap_pair_count',v_overlap_pairs,
    'calendar_end',v_calendar_end,
    'default_close_date',v_default_close,
    'can_close',(
      v_period.id IS NOT NULL
      AND v_period.primary_manager_membership_id=v_actor
      AND v_default_close IS NOT NULL
      AND v_default_close>=v_period.start_date
    )
  );
END
$close_preflight$;

GRANT EXECUTE ON FUNCTION public.get_month_close_preflight() TO authenticated;

-- --------------------------------------------------------------------------
-- 8) Khala Money period list + permission window.
--    Archived-period authority is kept with manager_at_close, through 15 days
--    after THAT PERIOD'S end_date (not calendar month start + 14).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.can_enter_khala_period(p_period_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $khala_perm$
  SELECT EXISTS(
    SELECT 1
    FROM public.monthly_periods mp
    JOIN public.hostel_memberships hm
      ON hm.id = private.current_membership_id(true)
     AND hm.hostel_id = mp.hostel_id
     AND hm.status = 'active'
    WHERE mp.id=p_period_id
      AND (
        (
          mp.status='running'
          AND (
            mp.primary_manager_membership_id=hm.id
            OR EXISTS(
              SELECT 1 FROM public.period_assistant_managers pam
              WHERE pam.period_id=mp.id AND pam.membership_id=hm.id
            )
          )
        )
        OR
        (
          mp.status='archived'
          AND mp.manager_at_close_membership_id=hm.id
          AND private.current_local_date(mp.hostel_id) <= mp.end_date + 15
        )
      )
  );
$khala_perm$;

CREATE OR REPLACE FUNCTION public.get_khala_entry_periods_v2()
RETURNS TABLE(
  period_id uuid,
  label text,
  start_date date,
  end_date date,
  is_current boolean,
  permission_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $khala_periods$
  SELECT
    mp.id,
    mp.label,
    mp.start_date,
    mp.end_date,
    mp.status='running',
    CASE
      WHEN mp.status='running' THEN 'বর্তমান মাস'
      ELSE 'আগের মাসের খালার টাকা (মাস শেষের পর ১৫ দিন পর্যন্ত)'
    END
  FROM public.monthly_periods mp
  WHERE mp.hostel_id=private.current_hostel_id(true)
    AND private.can_enter_khala_period(mp.id)
  ORDER BY CASE WHEN mp.status='running' THEN 0 ELSE 1 END, mp.end_date DESC;
$khala_periods$;

GRANT EXECUTE ON FUNCTION public.get_khala_entry_periods_v2() TO authenticated;

CREATE OR REPLACE FUNCTION public.manager_add_khala_money_for_period(
  p_period_id uuid,
  p_member_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $khala_add$
DECLARE
  v_hostel uuid;
  v_actor uuid;
  v_period public.monthly_periods;
  v_id uuid;
  v_today date;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  v_actor := private.current_membership_id(true);
  v_today := private.current_local_date(v_hostel);

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE id=p_period_id AND hostel_id=v_hostel
  FOR UPDATE;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION USING message='নির্বাচিত কাজের মাস পাওয়া যায়নি।';
  END IF;
  IF NOT private.can_enter_khala_period(p_period_id) THEN
    RAISE EXCEPTION USING message='এই মাসের খালার টাকা এন্ট্রি করার অনুমতি এখন নেই।';
  END IF;
  IF p_member_id IS NULL THEN
    RAISE EXCEPTION USING message='সদস্য নির্বাচন করতে হবে।';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION USING message='খালার টাকার পরিমাণ শূন্যের বেশি হতে হবে।';
  END IF;
  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION USING message='প্রদানের তারিখ দিতে হবে।';
  END IF;
  IF p_payment_date > v_today THEN
    RAISE EXCEPTION USING message='প্রদানের তারিখ ভবিষ্যতের হতে পারবে না।';
  END IF;
  IF p_payment_date < v_period.start_date THEN
    RAISE EXCEPTION USING message='প্রদানের তারিখ কাজের মাস শুরুর আগের হতে পারবে না।';
  END IF;

  IF v_period.status='archived' AND v_today > v_period.end_date + 15 THEN
    RAISE EXCEPTION USING message='এই মাসের খালার টাকা এন্ট্রির ১৫ দিনের সময়সীমা শেষ হয়েছে।';
  END IF;

  PERFORM private.assert_membership(p_member_id,v_hostel,false);

  INSERT INTO public.khala_money_entries(
    hostel_id,period_id,member_id,entry_date,amount,description,status,created_by
  ) VALUES(
    v_hostel,p_period_id,p_member_id,p_payment_date,p_amount,
    nullif(trim(coalesce(p_description,'')),''),'active',v_actor
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END
$khala_add$;

GRANT EXECUTE ON FUNCTION public.manager_add_khala_money_for_period(uuid,uuid,numeric,date,text) TO authenticated;

-- --------------------------------------------------------------------------
-- 9) Safe v2 read RPC: manager meal requests.
--    Returns one JSON object per request, with its day rows embedded.
--    This intentionally avoids changing the legacy RPC's return type.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_manager_meal_requests_v2(
  p_period_id uuid DEFAULT NULL,
  p_request_type text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $manager_requests$
DECLARE
  v_hostel uuid;
  v_actor uuid;
  v_period uuid;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  v_actor := private.current_membership_id(true);

  IF v_hostel IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION USING message='মেসের সক্রিয় সদস্য হওয়া প্রয়োজন।';
  END IF;

  PERFORM private.reconcile_running_period(v_hostel);

  IF NOT EXISTS (
    SELECT 1
    FROM public.monthly_periods mp
    WHERE mp.hostel_id=v_hostel
      AND (
        mp.primary_manager_membership_id=v_actor
        OR EXISTS (
          SELECT 1 FROM public.period_assistant_managers pam
          WHERE pam.period_id=mp.id AND pam.membership_id=v_actor
        )
      )
      AND (p_period_id IS NULL OR mp.id=p_period_id)
  ) THEN
    RAISE EXCEPTION USING message='মিল রিকোয়েস্ট দেখার জন্য ম্যানেজার বা সহকারী ম্যানেজার অনুমতি প্রয়োজন।';
  END IF;

  v_period := coalesce(
    p_period_id,
    (
      SELECT mp.id FROM public.monthly_periods mp
      WHERE mp.hostel_id=v_hostel AND mp.status='running'
      ORDER BY mp.start_date DESC,mp.created_at DESC LIMIT 1
    )
  );

  RETURN QUERY
  SELECT jsonb_build_object(
    'request_id',mr.id,
    'period_id',mr.period_id,
    'member_id',mr.member_id,
    'member_name',p.full_name,
    'request_type',mr.request_type::text,
    'status',mr.status::text,
    'start_date',mr.start_date,
    'end_date',mr.end_date,
    'submitted_at',mr.submitted_at,
    'reviewed_at',mr.reviewed_at,
    'rejection_reason',mr.rejection_reason,
    'parent_request_id',mr.parent_request_id,
    'origin',mr.origin,
    'days',coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'meal_date',mrd.meal_date,
          'breakfast',mrd.breakfast,
          'lunch',mrd.lunch,
          'dinner',mrd.dinner
        ) ORDER BY mrd.meal_date
      )
      FROM public.meal_request_days mrd
      WHERE mrd.request_id=mr.id AND mrd.is_current=true
    ),'[]'::jsonb)
  )
  FROM public.meal_requests mr
  JOIN public.hostel_memberships hm ON hm.id=mr.member_id
  JOIN public.profiles p ON p.id=hm.user_id
  WHERE mr.hostel_id=v_hostel
    AND mr.period_id=v_period
    AND (p_request_type IS NULL OR mr.request_type::text=p_request_type)
    AND (p_status IS NULL OR mr.status::text=p_status)
  ORDER BY mr.submitted_at DESC
  LIMIT greatest(1,least(coalesce(p_limit,200),1000));
END
$manager_requests$;

GRANT EXECUTE ON FUNCTION public.get_manager_meal_requests_v2(uuid,text,text,integer) TO authenticated;

-- --------------------------------------------------------------------------
-- 10) Safe v2 read RPC: market history and detail.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_market_history_v2(
  p_period_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 150
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $market_history$
DECLARE
  v_hostel uuid;
  v_period uuid;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  IF v_hostel IS NULL THEN
    RAISE EXCEPTION USING message='আপনি কোনো মেসের সদস্য নন।';
  END IF;

  PERFORM private.reconcile_running_period(v_hostel);

  v_period := coalesce(
    p_period_id,
    (
      SELECT mp.id FROM public.monthly_periods mp
      WHERE mp.hostel_id=v_hostel AND mp.status='running'
      ORDER BY mp.start_date DESC,mp.created_at DESC LIMIT 1
    ),
    (
      SELECT mp.id FROM public.monthly_periods mp
      WHERE mp.hostel_id=v_hostel
      ORDER BY mp.end_date DESC,mp.created_at DESC LIMIT 1
    )
  );

  IF v_period IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.monthly_periods mp WHERE mp.id=v_period AND mp.hostel_id=v_hostel) THEN
    RAISE EXCEPTION USING message='নির্বাচিত মাস এই মেসের নয়।';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'market_entry_id',me.id,
    'period_id',me.period_id,
    'entry_date',me.entry_date,
    'buyer_membership_id',me.buyer_membership_id,
    'buyer_name',p.full_name,
    'total_amount',me.total_amount,
    'credit_to_buyer',me.credit_to_buyer,
    'status',me.status::text,
    'created_at',me.created_at,
    'updated_at',me.updated_at,
    'voided_at',me.voided_at,
    'voided_by',me.voided_by,
    'void_reason',me.void_reason,
    'items',coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'serial_no',mi.serial_no,
          'item_name',mi.item_name,
          'quantity',mi.quantity,
          'amount',mi.amount
        ) ORDER BY mi.serial_no
      )
      FROM public.market_items mi
      WHERE mi.market_entry_id=me.id
    ),'[]'::jsonb)
  )
  FROM public.market_entries me
  JOIN public.hostel_memberships hm ON hm.id=me.buyer_membership_id
  JOIN public.profiles p ON p.id=hm.user_id
  WHERE me.hostel_id=v_hostel
    AND me.period_id=v_period
  ORDER BY me.entry_date DESC,me.created_at DESC
  LIMIT greatest(1,least(coalesce(p_limit,150),1000));
END
$market_history$;

GRANT EXECUTE ON FUNCTION public.get_market_history_v2(uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_market_detail_v2(p_market_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $market_detail$
DECLARE
  v_hostel uuid;
  v_entry public.market_entries;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  IF v_hostel IS NULL THEN
    RAISE EXCEPTION USING message='আপনি কোনো মেসের সদস্য নন।';
  END IF;

  SELECT * INTO v_entry
  FROM public.market_entries
  WHERE id=p_market_entry_id AND hostel_id=v_hostel;

  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION USING message='বাজারের এন্ট্রি পাওয়া যায়নি।';
  END IF;

  RETURN jsonb_build_object(
    'market_entry_id',v_entry.id,
    'period_id',v_entry.period_id,
    'entry_date',v_entry.entry_date,
    'buyer_membership_id',v_entry.buyer_membership_id,
    'buyer_name',(
      SELECT p.full_name
      FROM public.hostel_memberships hm
      JOIN public.profiles p ON p.id=hm.user_id
      WHERE hm.id=v_entry.buyer_membership_id
    ),
    'total_amount',v_entry.total_amount,
    'credit_to_buyer',v_entry.credit_to_buyer,
    'status',v_entry.status::text,
    'created_at',v_entry.created_at,
    'updated_at',v_entry.updated_at,
    'voided_at',v_entry.voided_at,
    'voided_by',v_entry.voided_by,
    'void_reason',v_entry.void_reason,
    'items',coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'serial_no',mi.serial_no,
          'item_name',mi.item_name,
          'quantity',mi.quantity,
          'amount',mi.amount
        ) ORDER BY mi.serial_no
      )
      FROM public.market_items mi
      WHERE mi.market_entry_id=v_entry.id
    ),'[]'::jsonb)
  );
END
$market_detail$;

GRANT EXECUTE ON FUNCTION public.get_market_detail_v2(uuid) TO authenticated;

-- --------------------------------------------------------------------------
-- 11) Safe v2 read RPC: Khala-money history. Explicit period is preferred;
--     omitted period resolves to the current operational period.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_khala_money_history_v2(
  p_period_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 300
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $khala_history$
DECLARE
  v_hostel uuid;
  v_period uuid;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  IF v_hostel IS NULL THEN
    RAISE EXCEPTION USING message='আপনি কোনো মেসের সদস্য নন।';
  END IF;

  PERFORM private.reconcile_running_period(v_hostel);

  v_period := coalesce(
    p_period_id,
    (
      SELECT mp.id FROM public.monthly_periods mp
      WHERE mp.hostel_id=v_hostel AND mp.status='running'
      ORDER BY mp.start_date DESC,mp.created_at DESC LIMIT 1
    ),
    (
      SELECT mp.id FROM public.monthly_periods mp
      WHERE mp.hostel_id=v_hostel
      ORDER BY mp.end_date DESC,mp.created_at DESC LIMIT 1
    )
  );

  IF v_period IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.monthly_periods mp WHERE mp.id=v_period AND mp.hostel_id=v_hostel) THEN
    RAISE EXCEPTION USING message='নির্বাচিত মাস এই মেসের নয়।';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'entry_id',kme.id,
    'period_id',kme.period_id,
    'member_id',kme.member_id,
    'membership_id',kme.member_id,
    'member_name',p.full_name,
    'entry_date',kme.entry_date,
    'amount',kme.amount,
    'description',kme.description,
    'status',kme.status::text,
    'created_at',kme.created_at,
    'created_by',kme.created_by
  )
  FROM public.khala_money_entries kme
  JOIN public.hostel_memberships hm ON hm.id=kme.member_id
  JOIN public.profiles p ON p.id=hm.user_id
  WHERE kme.hostel_id=v_hostel
    AND kme.period_id=v_period
  ORDER BY kme.entry_date DESC,kme.created_at DESC
  LIMIT greatest(1,least(coalesce(p_limit,300),1000));
END
$khala_history$;

GRANT EXECUTE ON FUNCTION public.get_khala_money_history_v2(uuid,integer) TO authenticated;

-- --------------------------------------------------------------------------
-- 12) Operational diagnostic for immediate post-run verification.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_core_operations_diagnostic()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $diagnostic$
DECLARE
  v_hostel uuid;
  v_actor uuid;
  v_today date;
  v_period public.monthly_periods;
  v_running integer := 0;
  v_future_requests integer := 0;
  v_overlap integer := 0;
  v_market integer := 0;
  v_khala integer := 0;
  v_manager_request integer := 0;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  v_actor := private.current_membership_id(true);
  v_today := private.current_local_date(v_hostel);

  PERFORM private.reconcile_running_period(v_hostel);

  SELECT count(*) INTO v_running
  FROM public.monthly_periods
  WHERE hostel_id=v_hostel AND status='running';

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE hostel_id=v_hostel AND status='running'
  ORDER BY start_date DESC,created_at DESC
  LIMIT 1;

  IF v_period.id IS NOT NULL THEN
    SELECT count(*) INTO v_future_requests
    FROM public.meal_requests mr
    WHERE mr.period_id=v_period.id
      AND mr.status IN ('submitted','approved')
      AND mr.end_date>v_today;

    SELECT count(*) INTO v_overlap
    FROM public.meal_requests a
    JOIN public.meal_requests b
      ON b.id>a.id
     AND b.period_id=a.period_id
     AND b.member_id=a.member_id
     AND b.request_type='normal'
     AND a.request_type='normal'
     AND b.status IN ('submitted','approved')
     AND a.status IN ('submitted','approved')
     AND a.start_date<=b.end_date
     AND b.start_date<=a.end_date
    WHERE a.period_id=v_period.id;

    SELECT count(*) INTO v_market
    FROM public.market_entries me
    WHERE me.hostel_id=v_hostel AND me.period_id=v_period.id;

    SELECT count(*) INTO v_khala
    FROM public.khala_money_entries kme
    WHERE kme.hostel_id=v_hostel AND kme.period_id=v_period.id AND kme.status='active';

    SELECT count(*) INTO v_manager_request
    FROM public.meal_requests mr
    WHERE mr.hostel_id=v_hostel AND mr.period_id=v_period.id;
  END IF;

  RETURN jsonb_build_object(
    'hostel_id',v_hostel,
    'actor_membership_id',v_actor,
    'today',v_today,
    'running_period_count',v_running,
    'period',CASE WHEN v_period.id IS NULL THEN NULL ELSE jsonb_build_object(
      'period_id',v_period.id,
      'id',v_period.id,
      'label',v_period.label,
      'start_date',v_period.start_date,
      'end_date',v_period.end_date,
      'status',v_period.status,
      'calendar_end',(date_trunc('month',v_period.start_date)+interval '1 month - 1 day')::date,
      'is_today_inside',v_today BETWEEN v_period.start_date AND v_period.end_date,
      'primary_manager_membership_id',v_period.primary_manager_membership_id,
      'manager_at_close_membership_id',v_period.manager_at_close_membership_id
    ) END,
    'future_active_meal_requests',v_future_requests,
    'normal_overlap_pairs',v_overlap,
    'market_entries',v_market,
    'active_khala_entries',v_khala,
    'meal_requests',v_manager_request,
    'primary_manager',CASE WHEN v_period.id IS NULL THEN false ELSE v_period.primary_manager_membership_id=v_actor END,
    'assistant_manager',CASE WHEN v_period.id IS NULL THEN false ELSE exists(
      SELECT 1 FROM public.period_assistant_managers pam
      WHERE pam.period_id=v_period.id AND pam.membership_id=v_actor
    ) END
  );
END
$diagnostic$;

GRANT EXECUTE ON FUNCTION public.get_core_operations_diagnostic() TO authenticated;

-- --------------------------------------------------------------------------
-- 13) Non-destructive indexes for the repaired operational paths.
-- --------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_periods_hostel_status_dates
  ON public.monthly_periods(hostel_id,status,start_date,end_date);

CREATE INDEX IF NOT EXISTS idx_meal_requests_period_member_status_dates
  ON public.meal_requests(period_id,member_id,status,start_date,end_date,submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_meal_request_days_request_current_date
  ON public.meal_request_days(request_id,is_current,meal_date);

CREATE INDEX IF NOT EXISTS idx_market_entries_period_date_created
  ON public.market_entries(period_id,entry_date DESC,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_khala_entries_period_date_created
  ON public.khala_money_entries(period_id,entry_date DESC,created_at DESC);

-- Least-privilege: new/repair RPCs are callable by authenticated clients only.
REVOKE EXECUTE ON FUNCTION private.reconcile_running_period(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.period_for_hostel_date(uuid,date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.can_enter_khala_period(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_running_period_context() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_month_management_context() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.start_new_month(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.start_new_month(date,date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_current_month(boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_month_close_preflight() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_khala_entry_periods_v2() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.manager_add_khala_money_for_period(uuid,uuid,numeric,date,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_manager_meal_requests_v2(uuid,text,text,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_market_history_v2(uuid,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_market_detail_v2(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_khala_money_history_v2(uuid,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_core_operations_diagnostic() FROM PUBLIC;

COMMIT;

-- --------------------------------------------------------------------------
-- 14) Post-run checks. These are read-only.
-- --------------------------------------------------------------------------
SELECT 'CORE_PERIOD_OPERATIONS_RECOVERY' AS check_name,
       'committed' AS result
UNION ALL
SELECT 'RUNNING_PERIODS', count(*)::text
FROM public.monthly_periods
WHERE status='running'
UNION ALL
SELECT 'STALE_RUNNING_PERIODS', count(*)::text
FROM public.monthly_periods mp
WHERE mp.status='running'
  AND mp.end_date < private.current_local_date(mp.hostel_id)
UNION ALL
SELECT 'START_NEW_MONTH_DATE_SIGNATURE',
       CASE WHEN to_regprocedure('public.start_new_month(date)') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL
SELECT 'START_NEW_MONTH_DATE_DATE_SIGNATURE',
       CASE WHEN to_regprocedure('public.start_new_month(date,date)') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL
SELECT 'MANAGER_MEAL_REQUESTS_V2',
       CASE WHEN to_regprocedure('public.get_manager_meal_requests_v2(uuid,text,text,integer)') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL
SELECT 'MARKET_HISTORY_V2',
       CASE WHEN to_regprocedure('public.get_market_history_v2(uuid,integer)') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL
SELECT 'MARKET_DETAIL_V2',
       CASE WHEN to_regprocedure('public.get_market_detail_v2(uuid)') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL
SELECT 'KHALA_HISTORY_V2',
       CASE WHEN to_regprocedure('public.get_khala_money_history_v2(uuid,integer)') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL
SELECT 'CORE_DIAGNOSTIC',
       CASE WHEN to_regprocedure('public.get_core_operations_diagnostic()') IS NOT NULL THEN 'present' ELSE 'missing' END;
