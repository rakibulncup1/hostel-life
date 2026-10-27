-- HOSTEL LIFE: FINISHING / RELIABILITY INCREMENTAL MIGRATION
-- Apply only after taking a Supabase backup and confirming the existing Pro Master,
-- Module B, and open-ended-running-period fixes have already been applied.
-- Do NOT re-run any full/master migration as a substitute for this script.
-- Changes: safe same-month reopen, Khala entry creator name, permanent notification
-- deletion (including cleanup of already-soft-deleted rows), robust hostel deletion,
-- and retention queue/list RPC reliability.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $preflight$
BEGIN
  IF to_regclass('public.hostels') IS NULL
     OR to_regclass('public.monthly_periods') IS NULL
     OR to_regclass('public.notifications') IS NULL
     OR to_regclass('public.khala_money_entries') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('public.daily_meal_days') IS NULL
     OR to_regclass('public.archive_period_audit') IS NULL
     OR to_regclass('public.platform_audit_log') IS NULL
     OR to_regclass('public.platform_retention_policy') IS NULL
     OR to_regclass('public.hl_archived_final_summaries') IS NULL THEN
    RAISE EXCEPTION 'Expected Pro Master / Module B tables are missing. No changes applied; restore the expected migration state first.';
  END IF;
  IF to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.my_hostel_id()') IS NULL
     OR to_regprocedure('private.assert_hostel_manager(uuid,uuid,boolean,boolean)') IS NULL
     OR to_regprocedure('private.is_super_admin()') IS NULL
     OR to_regprocedure('private.can_access_hostel(uuid)') IS NULL
     OR to_regprocedure('private.finalize_due_days(uuid,uuid)') IS NULL
     OR to_regprocedure('private.apply_request_days(uuid)') IS NULL
     OR to_regprocedure('private.get_request_json(public.meal_requests)') IS NULL
     OR to_regprocedure('public.manager_review_correction(uuid,boolean,text)') IS NULL
     OR to_regprocedure('public.manager_review_late_meal_request(uuid,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'Expected authorization helpers are missing. No changes applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_retention_policy WHERE singleton = true) THEN
    RAISE EXCEPTION 'The singleton retention policy row is missing. Restore it before this migration.';
  END IF;
  IF to_regprocedure('private.hl_b_guard_period_dates()') IS NULL THEN
    RAISE EXCEPTION 'Open-ended running-period trigger helper is missing. Apply/repair the open-ended-period migration first.';
  END IF;
END
$preflight$;

-- 1. Khala payment history now returns the identity of the creator.
CREATE OR REPLACE FUNCTION public.get_khala_money_history_v2(
  p_period_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_period uuid := p_period_id;
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF v_hostel IS NULL OR NOT private.can_access_hostel(v_hostel) THEN
    RAISE EXCEPTION USING message = 'এই হিসাব দেখার অনুমতি নেই।', errcode = '42501';
  END IF;
  IF v_period IS NULL THEN
    SELECT id INTO v_period FROM public.monthly_periods
    WHERE hostel_id = v_hostel AND status = 'running'
    ORDER BY start_date DESC LIMIT 1;
  END IF;
  IF v_period IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.monthly_periods WHERE id = v_period AND hostel_id = v_hostel
  ) THEN
    RAISE EXCEPTION USING message = 'এই মাসের খালার টাকার তথ্য দেখার অনুমতি নেই।', errcode = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'entry_id', k.id, 'id', k.id, 'hostel_id', k.hostel_id, 'period_id', k.period_id,
    'member_id', NULL, 'member_name', 'খালার পারিশ্রমিক',
    'amount', k.amount, 'entry_date', k.payment_date, 'payment_date', k.payment_date,
    'description', k.description, 'status', k.status, 'void_reason', k.void_reason,
    'created_at', k.created_at, 'updated_at', k.updated_at,
    'created_by', k.created_by,
    'created_by_name', COALESCE(NULLIF(btrim(p.full_name), ''), 'নাম পাওয়া যায়নি')
  ) ORDER BY k.payment_date DESC, k.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT * FROM public.khala_money_entries
    WHERE hostel_id = v_hostel AND (v_period IS NULL OR period_id = v_period)
    ORDER BY payment_date DESC, created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 200), 3000))
  ) k
  LEFT JOIN public.profiles p ON p.id = k.created_by;
  RETURN v_result;
END
$fn$;
CREATE OR REPLACE FUNCTION public.get_khala_money_history(
  p_period_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT public.get_khala_money_history_v2(p_period_id, p_limit)
$fn$;
REVOKE ALL ON FUNCTION public.get_khala_money_history_v2(uuid,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_khala_money_history(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_khala_money_history_v2(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_khala_money_history(uuid,integer) TO authenticated;

-- 2. Reopen is only for an accidental close of the latest period in the current
-- Bangladesh calendar month. A running period must not already exist.
CREATE OR REPLACE FUNCTION public.get_archive_management_items()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.assert_hostel_manager(v_hostel, NULL, true, false);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'period_id', q.id, 'id', q.id, 'label', q.label,
    'start_date', q.start_date, 'end_date', q.end_date, 'status', q.status,
    'primary_manager_membership_id', q.primary_manager_membership_id,
    'manager_at_close_membership_id', q.closer_id,
    'manager_at_close_name', q.closer_name,
    'closer_is_active', q.closer_active,
    'current_manager_is_closer', q.closed_by = auth.uid(),
    'can_grant_closer_edit', q.closer_id IS NOT NULL AND q.closer_active
       AND q.closed_by IS DISTINCT FROM auth.uid(),
    'can_reopen', q.status = 'closed' AND q.is_latest AND q.start_date <= v_today
       AND date_trunc('month', q.start_date::timestamp) =
           date_trunc('month', v_today::timestamp)
       AND NOT EXISTS (
         SELECT 1 FROM public.monthly_periods current_period
         WHERE current_period.hostel_id = q.hostel_id AND current_period.status = 'running'
       ),
    'archive_read_only', false,
    'permission_count', q.permission_count
  ) ORDER BY q.start_date DESC, q.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT mp.*, closer.id AS closer_id, profile.full_name AS closer_name,
      COALESCE(closer.status = 'active', false) AS closer_active,
      NOT EXISTS (
        SELECT 1 FROM public.monthly_periods later
        WHERE later.hostel_id = mp.hostel_id AND later.id <> mp.id
          AND (later.start_date > mp.start_date OR
              (later.start_date = mp.start_date AND later.created_at > mp.created_at))
      ) AS is_latest,
      (SELECT count(*) FROM public.archive_edit_permissions a
       WHERE a.period_id = mp.id AND a.revoked_at IS NULL
         AND (a.expires_at IS NULL OR a.expires_at > now())) AS permission_count
    FROM public.monthly_periods mp
    LEFT JOIN public.hostel_memberships closer
      ON closer.hostel_id = mp.hostel_id AND closer.user_id = mp.closed_by
    LEFT JOIN public.profiles profile ON profile.id = closer.user_id
    WHERE mp.hostel_id = v_hostel AND mp.status IN ('closed','archived')
  ) q;
  RETURN v_result;
END
$fn$;

CREATE OR REPLACE FUNCTION public.reopen_archived_period(p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_period public.monthly_periods%rowtype;
  v_today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
  v_previous_end date;
  v_old_end_date date;
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.assert_hostel_manager(v_hostel, NULL, true, false);

  PERFORM pg_advisory_xact_lock(hashtext(v_hostel::text), hashtext('reopen_period'));
  IF EXISTS (SELECT 1 FROM public.monthly_periods WHERE hostel_id = v_hostel AND status = 'running') THEN
    RAISE EXCEPTION USING message = 'আর্কাইভ খোলার আগে বর্তমান চলমান মাস বন্ধ করুন।', errcode = '55000';
  END IF;

  SELECT * INTO v_period FROM public.monthly_periods
  WHERE id = p_period_id AND hostel_id = v_hostel AND status = 'closed'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message = 'নির্বাচিত বন্ধ মাসটি পাওয়া যায়নি।', errcode = 'P0002';
  END IF;
  v_old_end_date := v_period.end_date;
  IF v_period.start_date > v_today OR
     date_trunc('month', v_period.start_date::timestamp) <> date_trunc('month', v_today::timestamp) THEN
    RAISE EXCEPTION USING message = 'শুধু চলতি ক্যালেন্ডার মাসে ভুলবশত বন্ধ হওয়া মাস পুনরায় চালু করা যাবে।', errcode = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.monthly_periods later
    WHERE later.hostel_id = v_hostel AND later.id <> v_period.id
      AND (later.start_date > v_period.start_date OR
          (later.start_date = v_period.start_date AND later.created_at > v_period.created_at))
  ) THEN
    RAISE EXCEPTION USING message = 'এর পরে আরেকটি period তৈরি হয়েছে; এই পুরোনো মাস পুনরায় চালু করা যাবে না।', errcode = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hl_archived_final_summaries s
             WHERE s.period_id = v_period.id AND s.purged_at IS NOT NULL) THEN
    RAISE EXCEPTION USING message = 'এই মাসের বিস্তারিত ইতিমধ্যে অপসারণ করা হয়েছে; এটি পুনরায় চালু করা যাবে না।', errcode = '55000';
  END IF;

  SELECT max(end_date) INTO v_previous_end FROM public.monthly_periods p
  WHERE p.hostel_id = v_hostel AND p.id <> v_period.id AND p.end_date < DATE '9999-01-01'
    AND p.start_date < v_period.start_date;
  IF v_previous_end IS NOT NULL AND v_previous_end >= v_period.start_date THEN
    RAISE EXCEPTION USING message = 'আগের period-এর তারিখের সঙ্গে সংঘর্ষ রয়েছে। আগে মাসের ইতিহাস যাচাই করুন।', errcode = '23514';
  END IF;

  UPDATE public.monthly_periods
  SET status = 'running', closed_at = NULL, closed_by = NULL, updated_at = now()
  WHERE id = v_period.id AND hostel_id = v_hostel
  RETURNING * INTO v_period;

  -- Rebuild missing day metadata using the same 21:00 Dhaka cutoff used by
  -- normal requests. A reopen after cutoff must not make today's finalized day
  -- editable; a reopen before cutoff may restore today's non-cancelled day.
  -- Never reactivate days/requests cancelled during month-close and never
  -- generate rows beyond today (the running end-date sentinel is not a date).
  INSERT INTO public.daily_meal_days(
    hostel_id, period_id, meal_date, status, cutoff_at, finalizes_at
  )
  SELECT v_hostel, v_period.id, dates.day::date,
         CASE
           WHEN dates.day::date < v_today
             OR ((dates.day::date + TIME '21:00') AT TIME ZONE 'Asia/Dhaka') <= now()
             THEN 'finalized'
           ELSE 'open'
         END,
         ((dates.day::date + TIME '21:00') AT TIME ZONE 'Asia/Dhaka'),
         ((dates.day::date + TIME '21:00') AT TIME ZONE 'Asia/Dhaka')
  FROM generate_series(v_period.start_date::timestamp, v_today::timestamp, interval '1 day') AS dates(day)
  ON CONFLICT(period_id, meal_date) DO NOTHING;

  UPDATE public.daily_meal_days
  SET cutoff_at = COALESCE(cutoff_at, ((meal_date + TIME '21:00') AT TIME ZONE 'Asia/Dhaka')),
      finalizes_at = COALESCE(finalizes_at, ((meal_date + TIME '21:00') AT TIME ZONE 'Asia/Dhaka')),
      status = CASE
        WHEN meal_date < v_today
          OR COALESCE(finalizes_at, ((meal_date + TIME '21:00') AT TIME ZONE 'Asia/Dhaka')) <= now()
          THEN 'finalized'
        ELSE 'open'
      END,
      updated_at = now()
  WHERE period_id = v_period.id AND status <> 'cancelled';

  INSERT INTO public.archive_period_audit(hostel_id, period_id, actor_user_id, action, summary, details)
  VALUES(v_hostel, v_period.id, auth.uid(), 'update:archive_reopened',
    'ভুলবশত বন্ধ হওয়া চলতি মাস পুনরায় চালু করা হয়েছে',
    jsonb_build_object('period_id', v_period.id, 'reopened_at', now(), 'previous_end_date', v_old_end_date));

  RETURN jsonb_build_object('period_id', v_period.id, 'id', v_period.id,
    'label', v_period.label, 'status', 'running', 'end_date_open', true);
END
$fn$;
REVOKE ALL ON FUNCTION public.get_archive_management_items() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_archived_period(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_archive_management_items() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_archived_period(uuid) TO authenticated;

-- 3. Notification removals are actual DELETEs, restricted to the recipient's inbox.
CREATE OR REPLACE FUNCTION public.delete_my_notification(p_notification_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_count bigint;
BEGIN
  PERFORM private.assert_signed_in();
  DELETE FROM public.notifications
  WHERE id = p_notification_id AND recipient_user_id = auth.uid();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION USING message = 'নোটিফিকেশনটি পাওয়া যায়নি বা এটি আপনার জন্য নয়।', errcode = 'P0002';
  END IF;
  RETURN jsonb_build_object('status','deleted','notification_id',p_notification_id,'deleted_count',v_count);
END
$fn$;

CREATE OR REPLACE FUNCTION public.manager_delete_notification(p_notification_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_hostel uuid := private.my_hostel_id(); v_count bigint;
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.assert_hostel_manager(v_hostel, NULL, false, false);
  DELETE FROM public.notifications
  WHERE id = p_notification_id AND hostel_id = v_hostel AND recipient_user_id = auth.uid();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION USING message = 'নোটিফিকেশনটি আপনার ইনবক্সে পাওয়া যায়নি।', errcode = 'P0002';
  END IF;
  RETURN jsonb_build_object('status','deleted','notification_id',p_notification_id,'deleted_count',v_count);
END
$fn$;

CREATE OR REPLACE FUNCTION public.delete_all_my_notifications()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_count bigint;
BEGIN
  PERFORM private.assert_signed_in();
  DELETE FROM public.notifications WHERE recipient_user_id = auth.uid();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('status','success','deleted_count',v_count);
END
$fn$;
REVOKE ALL ON FUNCTION public.delete_my_notification(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.manager_delete_notification(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_all_my_notifications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_notification(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_delete_notification(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_all_my_notifications() TO authenticated;

-- Existing soft-deleted notification rows are already absent from every inbox;
-- remove those old tombstones now to reclaim the storage the user asked to free.
DELETE FROM public.notifications WHERE deleted_at IS NOT NULL;

-- 4. Correct whole-hostel permanent deletion. The summary staging table has an
-- ON DELETE RESTRICT FK to monthly_periods and NO ACTION FK to hostels, so it must
-- be removed explicitly before the ordinary hostel cascade can succeed.
CREATE OR REPLACE FUNCTION public.platform_admin_permanently_delete_hostel(
  p_hostel_id uuid,
  p_delete_member_accounts boolean,
  p_confirmation text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_ids uuid[];
  v_count integer := 0;
  v_name text;
  v_deleted integer := 0;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING message = 'শুধু Super Admin মেস স্থায়ীভাবে মুছতে পারবেন।', errcode = '42501';
  END IF;
  IF p_confirmation IS DISTINCT FROM ('DELETE HOSTEL ' || p_hostel_id::text) THEN
    RAISE EXCEPTION USING message = 'স্থায়ীভাবে মুছে ফেলার নিশ্চিতকরণ মেলেনি। কোনো পরিবর্তন করা হয়নি।', errcode = '22023';
  END IF;

  SELECT name INTO v_name FROM public.hostels WHERE id = p_hostel_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING message = 'মেসটি পাওয়া যায়নি।', errcode = 'P0002'; END IF;
  SELECT COALESCE(array_agg(DISTINCT user_id), '{}'::uuid[])
    INTO v_ids FROM public.hostel_memberships WHERE hostel_id = p_hostel_id;

  IF to_regclass('public.hl_period_summary_snapshots') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.hl_period_summary_snapshots WHERE hostel_id = $1 OR period_id IN (SELECT id FROM public.monthly_periods WHERE hostel_id = $1)' USING p_hostel_id;
  END IF;
  IF to_regclass('public.hl_archived_final_summaries') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.hl_archived_final_summaries WHERE hostel_id = $1 OR period_id IN (SELECT id FROM public.monthly_periods WHERE hostel_id = $1)' USING p_hostel_id;
  END IF;

  DELETE FROM public.hostels WHERE id = p_hostel_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN RAISE EXCEPTION USING message = 'মেসের রেকর্ড স্থায়ীভাবে সরানো যায়নি।', errcode = '55000'; END IF;

  -- Write the audit record before optionally deleting now-unshared auth accounts.
  INSERT INTO public.platform_audit_log(actor_user_id, action, target_type, target_id, reason, details)
  VALUES(auth.uid(), 'hostel_permanently_deleted', 'hostel', p_hostel_id::text, 'Super Delete',
    jsonb_build_object('name', v_name, 'member_accounts_deleted', 0,
                       'summary_snapshots_removed', true));

  IF coalesce(p_delete_member_accounts, false) THEN
    -- A login used by another hostel must survive this hostel deletion.
    DELETE FROM auth.users u
    WHERE u.id = ANY(v_ids)
      AND u.id <> auth.uid()
      AND NOT EXISTS (SELECT 1 FROM public.hostel_memberships m WHERE m.user_id = u.id);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    UPDATE public.platform_audit_log
    SET details = coalesce(details, '{}'::jsonb) || jsonb_build_object('member_accounts_deleted', v_count)
    WHERE action = 'hostel_permanently_deleted' AND target_type = 'hostel'
      AND target_id = p_hostel_id::text AND actor_user_id = auth.uid()
      AND created_at = (SELECT max(created_at) FROM public.platform_audit_log
                        WHERE action = 'hostel_permanently_deleted' AND target_id = p_hostel_id::text
                          AND actor_user_id = auth.uid());
  END IF;

  RETURN jsonb_build_object('status','deleted','hostel_id',p_hostel_id,
    'hostel_name',v_name,'member_accounts_deleted',v_count);
END
$fn$;
REVOKE ALL ON FUNCTION public.platform_admin_permanently_delete_hostel(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_permanently_delete_hostel(uuid,boolean,text) TO authenticated;

-- 5. Make the retention queue independent and explicit. It returns only closed
-- periods whose total detailed+summary retention has expired; never includes running.
CREATE OR REPLACE FUNCTION public.platform_admin_list_expired_archives()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING message = 'Only Super Admin is allowed', errcode = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'hostel_id', eligible.hostel_id,
    'period_id', eligible.period_id,
    'hostel_name', eligible.hostel_name,
    'period_label', eligible.period_label,
    'expired_at', eligible.expired_at,
    'summary_exists', eligible.summary_exists,
    'summary_verified', eligible.summary_verified
  ) ORDER BY eligible.expired_at, eligible.hostel_name, eligible.period_label), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT mp.hostel_id, mp.id AS period_id, h.name AS hostel_name, mp.label AS period_label,
      (mp.end_date + make_interval(months => rp.detail_months + rp.summary_months))::date AS expired_at,
      (s.period_id IS NOT NULL AND s.purged_at IS NULL) AS summary_exists,
      (s.verified_at IS NOT NULL AND s.purged_at IS NULL) AS summary_verified
    FROM public.monthly_periods mp
    JOIN public.hostels h ON h.id = mp.hostel_id
    CROSS JOIN public.platform_retention_policy rp
    LEFT JOIN public.hl_archived_final_summaries s
      ON s.period_id = mp.id AND s.hostel_id = mp.hostel_id
    WHERE rp.singleton = true AND mp.status IN ('closed','archived')
      AND (mp.end_date + make_interval(months => rp.detail_months + rp.summary_months))::date
          < (now() AT TIME ZONE 'Asia/Dhaka')::date
    ORDER BY mp.end_date, mp.created_at
    LIMIT 500
  ) eligible;
  RETURN v_result;
END
$fn$;

CREATE OR REPLACE FUNCTION public.platform_admin_list_saved_summaries()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING message = 'Super Admin only', errcode = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'period_id', s.period_id, 'hostel_id', s.hostel_id,
    'hostel_name', COALESCE(h.name, s.hostel_name), 'period_label', s.period_label,
    'start_date', s.start_date, 'end_date', s.end_date,
    'archived_at', s.archived_at, 'purged_at', s.purged_at,
    'verified_at', s.verified_at, 'verified_by', s.verified_by
  ) ORDER BY s.end_date DESC, s.archived_at DESC), '[]'::jsonb)
  INTO v_result
  FROM public.hl_archived_final_summaries s
  LEFT JOIN public.hostels h ON h.id = s.hostel_id;
  RETURN v_result;
END
$fn$;
REVOKE ALL ON FUNCTION public.platform_admin_list_expired_archives() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_saved_summaries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_expired_archives() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_saved_summaries() TO authenticated;

-- 5b. Never return historical manager request rows when there is no running period.
-- The UI already fails closed; this also makes the RPC safe for old clients and direct calls.
CREATE OR REPLACE FUNCTION public.get_manager_meal_requests_v3(
  p_period_id uuid DEFAULT NULL,
  p_request_type text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_late_only boolean DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_hostel uuid;
  v_period uuid;
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  v_hostel := private.my_hostel_id();
  IF v_hostel IS NULL OR NOT private.can_manage_hostel(v_hostel, p_period_id, false, true) THEN
    RAISE EXCEPTION USING message='মিল অনুরোধের তালিকা দেখার অনুমতি নেই।', errcode='42501';
  END IF;

  SELECT id INTO v_period
  FROM public.monthly_periods
  WHERE hostel_id = v_hostel AND status = 'running'
    AND (p_period_id IS NULL OR id = p_period_id)
  ORDER BY start_date DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT private.can_manage_hostel(v_hostel, v_period, false, true) THEN
    RAISE EXCEPTION USING message='চলমান মাসের মিল অনুরোধ দেখার অনুমতি নেই।', errcode='42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
    private.get_request_json(q) || jsonb_build_object(
      'member_name', COALESCE(p.full_name, q.member_name_snapshot),
      'member_status', m.status
    ) ORDER BY q.submitted_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT r.*
    FROM public.meal_requests r
    WHERE r.hostel_id = v_hostel AND r.period_id = v_period
      AND (p_request_type IS NULL OR r.request_type = p_request_type)
      AND (p_status IS NULL OR r.status = p_status)
      AND (p_late_only IS NULL OR r.is_late_request = p_late_only)
    ORDER BY r.submitted_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
  ) q
  LEFT JOIN public.hostel_memberships m ON m.id = q.membership_id
  LEFT JOIN public.profiles p ON p.id = m.user_id;
  RETURN COALESCE(v_result, '[]'::jsonb);
END
$fn$;
REVOKE ALL ON FUNCTION public.get_manager_meal_requests_v3(uuid,text,text,boolean,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_manager_meal_requests_v3(uuid,text,text,boolean,integer) TO authenticated;

-- 6. Enforce the 10 PM normal-request cutoff on the server, and expose the late
-- request path only after 10 PM for tomorrow. This also checks duplicates server-side.
CREATE OR REPLACE FUNCTION public.create_meal_request(
  p_start_date date,
  p_end_date date,
  p_days jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_local_now timestamp without time zone := now() AT TIME ZONE 'Asia/Dhaka';
  v_today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
  v_days_date date;
BEGIN
  PERFORM private.assert_signed_in();
  IF v_local_now::time >= TIME '22:00' THEN
    RAISE EXCEPTION USING message='রাত ১০টার পর সাধারণ মিল অনুরোধ বন্ধ। আগামী দিনের জন্য লেট মিল অনুরোধ ব্যবহার করুন।', errcode='55000';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date OR p_start_date <= v_today THEN
    RAISE EXCEPTION USING message='সাধারণ মিল অনুরোধের তারিখ আগামী দিন থেকে দিতে হবে।', errcode='22023';
  END IF;
  IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array' OR jsonb_array_length(p_days) = 0 THEN
    RAISE EXCEPTION USING message='অন্তত একটি দিনের মিলের তথ্য দিন।', errcode='22023';
  END IF;
  FOR v_days_date IN SELECT (value->>'meal_date')::date FROM jsonb_array_elements(p_days) LOOP
    IF v_days_date <= v_today THEN
      RAISE EXCEPTION USING message='সাধারণ অনুরোধে আজ বা আগের দিনের তথ্য দেওয়া যাবে না।', errcode='22023';
    END IF;
  END LOOP;
  RETURN private.create_meal_request_internal(
    private.my_membership_id(), p_start_date, p_end_date, p_days,
    'normal', false, NULL, 'member', NULL
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.create_late_meal_request(
  p_meal_date date,
  p_breakfast numeric,
  p_lunch numeric,
  p_dinner numeric,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_local_now timestamp without time zone := now() AT TIME ZONE 'Asia/Dhaka';
  v_today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
  v_hostel uuid;
  v_membership uuid;
  v_period public.monthly_periods%ROWTYPE;
  v_days jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  v_hostel := private.my_hostel_id();
  v_membership := private.my_membership_id();
  IF v_local_now::time < TIME '22:00' THEN
    RAISE EXCEPTION USING message='লেট মিল অনুরোধ রাত ১০টার পর দেওয়া যাবে। তার আগে সাধারণ অনুরোধ ব্যবহার করুন।', errcode='55000';
  END IF;
  IF p_meal_date IS DISTINCT FROM (v_today + 1) THEN
    RAISE EXCEPTION USING message='লেট মিল অনুরোধ শুধু আগামী দিনের জন্য দেওয়া যাবে।', errcode='22023';
  END IF;
  SELECT * INTO v_period FROM public.monthly_periods
  WHERE hostel_id = v_hostel AND status = 'running'
    AND p_meal_date >= start_date AND p_meal_date <= end_date
  ORDER BY start_date DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='কোনো উপযুক্ত চলমান মাস নেই অথবা আগামী দিনের তারিখটি মাসের মধ্যে পড়ে না।', errcode='55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.meal_requests r
    CROSS JOIN LATERAL jsonb_array_elements(r.days) d
    WHERE r.hostel_id = v_hostel AND r.period_id = v_period.id
      AND r.membership_id = v_membership AND r.status IN ('submitted','approved')
      AND (d->>'meal_date')::date = p_meal_date
  ) THEN
    RAISE EXCEPTION USING message='এই তারিখের জন্য একটি সক্রিয় মিল অনুরোধ ইতিমধ্যে আছে। অনুরোধের ইতিহাস যাচাই করুন।', errcode='23505';
  END IF;

  v_days := jsonb_build_array(jsonb_build_object(
    'meal_date', p_meal_date,
    'breakfast', p_breakfast,
    'lunch', p_lunch,
    'dinner', p_dinner
  ));
  RETURN private.create_meal_request_internal(
    v_membership, p_meal_date, p_meal_date, v_days,
    'normal', true, p_reason, 'member', NULL
  );
END
$fn$;

-- 7. Corrections must reference the member's own approved normal request, target
-- only days in that request whose cutoff has passed/finalized, and prevent duplicate
-- pending corrections. Final-day application is audited by private.apply_request_days.
CREATE OR REPLACE FUNCTION public.create_meal_correction_request(
  p_start_date date,
  p_end_date date,
  p_days jsonb,
  p_parent_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_hostel uuid;
  v_membership uuid;
  v_parent public.meal_requests%ROWTYPE;
  v_period public.monthly_periods%ROWTYPE;
  v_item jsonb;
  v_date date;
  v_day public.daily_meal_days%ROWTYPE;
  v_min_date date;
  v_max_date date;
BEGIN
  PERFORM private.assert_signed_in();
  v_hostel := private.my_hostel_id();
  v_membership := private.my_membership_id();
  IF p_parent_request_id IS NULL THEN
    RAISE EXCEPTION USING message='সংশোধনের জন্য মূল অনুমোদিত অনুরোধটি নির্বাচন করতে হবে।', errcode='22023';
  END IF;
  SELECT * INTO v_parent FROM public.meal_requests
  WHERE id = p_parent_request_id AND hostel_id = v_hostel AND membership_id = v_membership
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='মূল অনুরোধটি পাওয়া যায়নি বা এটি আপনার নয়।', errcode='42501';
  END IF;
  IF v_parent.status <> 'approved' OR v_parent.request_type <> 'normal' OR v_parent.is_late_request THEN
    RAISE EXCEPTION USING message='শুধু নিজের অনুমোদিত সাধারণ অনুরোধের জন্য সংশোধন পাঠানো যাবে।', errcode='42501';
  END IF;
  SELECT * INTO v_period FROM public.monthly_periods
  WHERE id = v_parent.period_id AND hostel_id = v_hostel AND status = 'running';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='সংশোধনের মূল মাসটি আর চলমান নেই।', errcode='55000';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date
     OR p_start_date < v_period.start_date OR p_end_date > v_period.end_date THEN
    RAISE EXCEPTION USING message='সংশোধনের তারিখ চলমান মাসের সীমার বাইরে।', errcode='22023';
  END IF;
  PERFORM private.assert_meal_days(p_days, v_parent.period_id, true);
  SELECT min((value->>'meal_date')::date), max((value->>'meal_date')::date)
  INTO v_min_date, v_max_date FROM jsonb_array_elements(p_days);
  IF v_min_date IS DISTINCT FROM p_start_date OR v_max_date IS DISTINCT FROM p_end_date THEN
    RAISE EXCEPTION USING message='সংশোধনের তারিখের পরিসর নির্বাচিত দিনগুলোর সঙ্গে মিলছে না।', errcode='22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_days) LOOP
    v_date := (v_item->>'meal_date')::date;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_parent.days) parent_day
      WHERE (parent_day->>'meal_date')::date = v_date
    ) THEN
      RAISE EXCEPTION USING message='মূল অনুরোধে নেই এমন দিনের মিল সংশোধন করা যাবে না।', errcode='22023';
    END IF;
    SELECT * INTO v_day FROM public.daily_meal_days
    WHERE period_id = v_parent.period_id AND meal_date = v_date
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING message='সংশোধনের দিনের মিল-তথ্য পাওয়া যায়নি।', errcode='55000';
    END IF;
    IF v_day.status = 'cancelled' THEN
      RAISE EXCEPTION USING message='বাতিল হওয়া দিনের মিল সংশোধন করা যাবে না।', errcode='55000';
    END IF;
    IF v_day.status IS DISTINCT FROM 'finalized'
       AND (v_day.cutoff_at IS NULL OR v_day.cutoff_at > now()) THEN
      RAISE EXCEPTION USING message='এই দিনের স্বাভাবিক সময়সীমা এখনো শেষ হয়নি; সাধারণ এডিট ব্যবহার করুন।', errcode='55000';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.meal_requests existing
    WHERE existing.hostel_id = v_hostel AND existing.period_id = v_parent.period_id
      AND existing.membership_id = v_membership AND existing.request_type = 'correction'
      AND existing.parent_request_id = v_parent.id AND existing.status = 'submitted'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(existing.days) old_day
        JOIN jsonb_array_elements(p_days) new_day
          ON (old_day->>'meal_date')::date = (new_day->>'meal_date')::date
      )
  ) THEN
    RAISE EXCEPTION USING message='এই দিনের একটি সংশোধন অনুরোধ ইতিমধ্যে অপেক্ষমাণ। আগে সেটির সিদ্ধান্তের অপেক্ষা করুন।', errcode='23505';
  END IF;

  RETURN private.create_meal_request_internal(
    v_membership, p_start_date, p_end_date, p_days,
    'correction', false, 'সদস্যের সংশোধন অনুরোধ', 'member', v_parent.id
  );
END
$fn$;

-- 8. Direct edit updates only still-editable future days in the existing approved
-- request, keeps protected historical/finalized days in its history, and updates
-- the actual daily meal records (not just the request JSON).
CREATE OR REPLACE FUNCTION public.edit_my_approved_meal_request(
  p_request_id uuid,
  p_start_date date,
  p_end_date date,
  p_days jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_req public.meal_requests%ROWTYPE;
  v_period public.monthly_periods%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
  v_item jsonb;
  v_date date;
  v_day public.daily_meal_days%ROWTYPE;
  v_preserved_days jsonb := '[]'::jsonb;
  v_effective_days jsonb := '[]'::jsonb;
  v_min_date date;
  v_max_date date;
  v_removed_dates jsonb := '[]'::jsonb;
  v_b numeric;
  v_l numeric;
  v_d numeric;
BEGIN
  PERFORM private.assert_signed_in();
  SELECT * INTO v_req FROM public.meal_requests
  WHERE id = p_request_id AND membership_id = private.my_membership_id()
    AND hostel_id = private.my_hostel_id()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='মিল অনুরোধটি পাওয়া যায়নি বা এটি আপনার নয়।', errcode='42501';
  END IF;
  IF v_req.status <> 'approved' OR v_req.request_type <> 'normal' OR v_req.is_late_request THEN
    RAISE EXCEPTION USING message='শুধু নিজের অনুমোদিত সাধারণ মিল অনুরোধ সম্পাদনা করা যাবে।', errcode='42501';
  END IF;
  SELECT * INTO v_period FROM public.monthly_periods
  WHERE id = v_req.period_id AND hostel_id = v_req.hostel_id AND status = 'running';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='এই মাসটি আর চলমান নেই।', errcode='55000';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date
     OR p_start_date <= v_today OR p_end_date > v_period.end_date THEN
    RAISE EXCEPTION USING message='সরাসরি এডিটের জন্য আগামী দিনের বৈধ তারিখ দিন।', errcode='22023';
  END IF;
  PERFORM private.assert_meal_days(p_days, v_req.period_id, false);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_days) LOOP
    v_date := (v_item->>'meal_date')::date;
    IF v_date <= v_today OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_req.days) old_day
      WHERE (old_day->>'meal_date')::date = v_date
    ) THEN
      RAISE EXCEPTION USING message='শুধু মূল অনুরোধের ভবিষ্যৎ দিনগুলো সরাসরি এডিট করা যাবে।', errcode='22023';
    END IF;
    SELECT * INTO v_day FROM public.daily_meal_days
    WHERE period_id = v_req.period_id AND meal_date = v_date;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING message='এই দিনের মিল-তথ্য পাওয়া যায়নি। আবার সিঙ্ক করুন।', errcode='55000';
    END IF;
    IF v_day.status = 'finalized' OR (v_day.cutoff_at IS NOT NULL AND v_day.cutoff_at <= now()) THEN
      RAISE EXCEPTION USING message='এই দিনের সময়সীমা শেষ হয়েছে; সরাসরি এডিট করা যাবে না।', errcode='55000';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.meal_requests other_request
    CROSS JOIN LATERAL jsonb_array_elements(other_request.days) other_day
    JOIN LATERAL jsonb_array_elements(p_days) new_day
      ON (other_day->>'meal_date')::date = (new_day->>'meal_date')::date
    WHERE other_request.id <> v_req.id AND other_request.hostel_id = v_req.hostel_id
      AND other_request.period_id = v_req.period_id AND other_request.membership_id = v_req.membership_id
      AND other_request.status IN ('submitted','approved')
  ) THEN
    RAISE EXCEPTION USING message='একই দিনের জন্য অন্য একটি সক্রিয় অনুরোধ আছে। আগে সেটি যাচাই করুন।', errcode='23505';
  END IF;

  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'meal_date')::date), '[]'::jsonb)
  INTO v_preserved_days
  FROM (
    SELECT old_day.value AS item
    FROM jsonb_array_elements(v_req.days) old_day(value)
    LEFT JOIN public.daily_meal_days d
      ON d.period_id = v_req.period_id AND d.meal_date = (old_day.value->>'meal_date')::date
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_days) new_day
      WHERE (new_day->>'meal_date')::date = (old_day.value->>'meal_date')::date
    )
    AND (
      (old_day.value->>'meal_date')::date <= v_today
      OR d.id IS NULL OR d.status IN ('finalized','cancelled')
      OR (d.cutoff_at IS NOT NULL AND d.cutoff_at <= now())
    )
  ) protected;

  SELECT COALESCE(jsonb_agg(day ORDER BY (day->>'meal_date')::date), '[]'::jsonb)
  INTO v_effective_days
  FROM (
    SELECT value AS day FROM jsonb_array_elements(p_days)
    UNION ALL
    SELECT value AS day FROM jsonb_array_elements(v_preserved_days)
  ) combined;
  SELECT min((value->>'meal_date')::date), max((value->>'meal_date')::date)
  INTO v_min_date, v_max_date FROM jsonb_array_elements(v_effective_days);

  SELECT COALESCE(jsonb_agg(old_day.value->>'meal_date' ORDER BY (old_day.value->>'meal_date')::date), '[]'::jsonb)
  INTO v_removed_dates
  FROM jsonb_array_elements(v_req.days) old_day(value)
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_effective_days) keep_day
    WHERE (keep_day->>'meal_date')::date = (old_day.value->>'meal_date')::date
  );

  UPDATE public.daily_meal_records r
  SET cancelled = true, updated_by = auth.uid(), updated_at = now()
  FROM public.daily_meal_days d
  WHERE d.id = r.daily_meal_day_id AND d.period_id = v_req.period_id
    AND r.member_id = v_req.membership_id AND NOT r.cancelled
    AND d.status <> 'finalized' AND (d.cutoff_at IS NULL OR d.cutoff_at > now())
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_req.days) old_day
      WHERE (old_day->>'meal_date')::date = d.meal_date
    )
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_effective_days) keep_day
      WHERE (keep_day->>'meal_date')::date = d.meal_date
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.meal_requests other_request
      CROSS JOIN LATERAL jsonb_array_elements(other_request.days) other_day
      WHERE other_request.id <> v_req.id AND other_request.hostel_id = v_req.hostel_id
        AND other_request.period_id = v_req.period_id AND other_request.membership_id = v_req.membership_id
        AND other_request.status IN ('submitted','approved')
        AND (other_day->>'meal_date')::date = d.meal_date
    );

  UPDATE public.meal_requests
  SET start_date = v_min_date, end_date = v_max_date, days = v_effective_days, updated_at = now()
  WHERE id = v_req.id
  RETURNING * INTO v_req;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_days) LOOP
    v_date := (v_item->>'meal_date')::date;
    v_b := COALESCE((v_item->>'breakfast')::numeric, 0);
    v_l := COALESCE((v_item->>'lunch')::numeric, 0);
    v_d := COALESCE((v_item->>'dinner')::numeric, 0);
    SELECT * INTO v_day FROM public.daily_meal_days
    WHERE period_id = v_req.period_id AND meal_date = v_date;
    INSERT INTO public.daily_meal_records(
      hostel_id, period_id, daily_meal_day_id, member_id, member_name_snapshot,
      planned_breakfast, planned_lunch, planned_dinner,
      actual_breakfast, actual_lunch, actual_dinner,
      final_breakfast, final_lunch, final_dinner, updated_by, cancelled
    ) VALUES (
      v_req.hostel_id, v_req.period_id, v_day.id, v_req.membership_id, v_req.member_name_snapshot,
      v_b, v_l, v_d, NULL, NULL, NULL, NULL, NULL, NULL, auth.uid(), false
    )
    ON CONFLICT (daily_meal_day_id, member_id) DO UPDATE SET
      planned_breakfast = EXCLUDED.planned_breakfast,
      planned_lunch = EXCLUDED.planned_lunch,
      planned_dinner = EXCLUDED.planned_dinner,
      actual_breakfast = COALESCE(EXCLUDED.actual_breakfast, public.daily_meal_records.actual_breakfast),
      actual_lunch = COALESCE(EXCLUDED.actual_lunch, public.daily_meal_records.actual_lunch),
      actual_dinner = COALESCE(EXCLUDED.actual_dinner, public.daily_meal_records.actual_dinner),
      final_breakfast = COALESCE(EXCLUDED.final_breakfast, public.daily_meal_records.final_breakfast),
      final_lunch = COALESCE(EXCLUDED.final_lunch, public.daily_meal_records.final_lunch),
      final_dinner = COALESCE(EXCLUDED.final_dinner, public.daily_meal_records.final_dinner),
      updated_by = auth.uid(), cancelled = false, updated_at = now();
  END LOOP;

  INSERT INTO public.archive_period_audit(hostel_id, period_id, actor_user_id, action, summary, details)
  VALUES(v_req.hostel_id, v_req.period_id, auth.uid(), 'update:meal_request',
    'অনুমোদিত মিল অনুরোধ সম্পাদিত হয়েছে',
    jsonb_build_object('request_id', v_req.id, 'changed_days', p_days, 'removed_days', v_removed_dates,
                       'preserved_protected_days', v_preserved_days));
  RETURN private.get_request_json(v_req);
END
$fn$;
-- 9. A correction submitted for an already-cutoff/finalized day must remain
-- approvable. The earlier manager_review_correction rejected finalized dates,
-- even though the member UI correctly offered a correction request for them.
-- Approval is permitted only for this user's parent-approved correction flow,
-- a still-running period, and days that have actually been finalized. The
-- existing apply_request_days helper updates planned/actual/final fields and
-- writes an audit row for finalized corrections.
CREATE OR REPLACE FUNCTION public.manager_review_correction(
  p_request_id uuid,
  p_approve boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_req public.meal_requests%ROWTYPE;
  v_period public.monthly_periods%ROWTYPE;
  v_parent public.meal_requests%ROWTYPE;
  v_item jsonb;
  v_date date;
  v_day public.daily_meal_days%ROWTYPE;
BEGIN
  PERFORM private.assert_signed_in();
  IF p_approve IS NULL THEN
    RAISE EXCEPTION USING message='অনুমোদন বা প্রত্যাখ্যান নির্বাচন করুন।', errcode='22023';
  END IF;

  SELECT * INTO v_req
  FROM public.meal_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='সংশোধন অনুরোধটি পাওয়া যায়নি।', errcode='P0002';
  END IF;
  PERFORM private.assert_hostel_manager(v_req.hostel_id, v_req.period_id, false, true);

  IF v_req.status <> 'submitted' OR v_req.request_type <> 'correction' OR v_req.is_late_request THEN
    RAISE EXCEPTION USING message='এই সংশোধন অনুরোধটি আর অপেক্ষমাণ নেই।', errcode='55000';
  END IF;

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE id = v_req.period_id AND hostel_id = v_req.hostel_id
  FOR UPDATE;
  IF NOT FOUND OR v_period.status <> 'running' THEN
    RAISE EXCEPTION USING message='সংশোধনের মূল মাসটি আর চলমান নেই।', errcode='55000';
  END IF;

  IF v_req.parent_request_id IS NULL THEN
    RAISE EXCEPTION USING message='মূল সাধারণ অনুরোধের তথ্য পাওয়া যায়নি।', errcode='22023';
  END IF;
  SELECT * INTO v_parent
  FROM public.meal_requests
  WHERE id = v_req.parent_request_id
    AND hostel_id = v_req.hostel_id
    AND period_id = v_req.period_id
    AND membership_id = v_req.membership_id
  FOR UPDATE;
  IF NOT FOUND OR v_parent.status <> 'approved'
     OR v_parent.request_type <> 'normal' OR v_parent.is_late_request THEN
    RAISE EXCEPTION USING message='সংশোধনের মূল অনুরোধটি আর বৈধ/অনুমোদিত নেই।', errcode='55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_req.days) correction_day
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_parent.days) parent_day
      WHERE (parent_day->>'meal_date')::date = (correction_day->>'meal_date')::date
    )
  ) THEN
    RAISE EXCEPTION USING message='সংশোধনের তালিকায় মূল অনুরোধে নেই এমন দিন আছে।', errcode='22023';
  END IF;

  IF p_approve THEN
    -- Bring due day states up to date before deciding whether final values may be changed.
    PERFORM private.finalize_due_days(v_req.hostel_id, v_req.period_id);
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_req.days) LOOP
      v_date := (v_item->>'meal_date')::date;
      SELECT * INTO v_day
      FROM public.daily_meal_days
      WHERE period_id = v_req.period_id AND meal_date = v_date
      FOR UPDATE;
      IF NOT FOUND OR v_day.status = 'cancelled' THEN
        RAISE EXCEPTION USING message='সংশোধনের দিনটি পাওয়া যায়নি বা বাতিল হয়েছে।', errcode='55000';
      END IF;
      IF v_day.status <> 'finalized' THEN
        RAISE EXCEPTION USING message='এই দিনের রাত ৯টার চূড়ান্ত হিসাব এখনো সম্পন্ন হয়নি। চূড়ান্ত হওয়ার পরে সংশোধন অনুমোদন করুন।', errcode='55000';
      END IF;
    END LOOP;
  END IF;

  UPDATE public.meal_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      review_reason = NULLIF(btrim(p_reason), ''),
      reviewed_by = auth.uid(), reviewed_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE id = v_req.id
  RETURNING * INTO v_req;

  IF p_approve THEN
    PERFORM private.apply_request_days(v_req.id);
  END IF;

  INSERT INTO public.archive_period_audit(
    hostel_id, period_id, actor_user_id, action, summary, details
  ) VALUES (
    v_req.hostel_id, v_req.period_id, auth.uid(),
    CASE WHEN p_approve THEN 'update:correction_approved' ELSE 'update:correction_rejected' END,
    CASE WHEN p_approve THEN 'মিল সংশোধন অনুমোদিত হয়েছে' ELSE 'মিল সংশোধন প্রত্যাখ্যান হয়েছে' END,
    jsonb_build_object('request_id', v_req.id, 'reason', p_reason, 'parent_request_id', v_req.parent_request_id)
  );
  RETURN private.get_request_json(v_req);
END
$fn$;
REVOKE ALL ON FUNCTION public.manager_review_correction(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_review_correction(uuid,boolean,text) TO authenticated;

REVOKE ALL ON FUNCTION public.create_meal_request(date,date,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_late_meal_request(date,numeric,numeric,numeric,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_meal_correction_request(date,date,jsonb,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_my_approved_meal_request(uuid,date,date,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_meal_request(date,date,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_late_meal_request(date,numeric,numeric,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_meal_correction_request(date,date,jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_my_approved_meal_request(uuid,date,date,jsonb) TO authenticated;

COMMIT;

-- POSTFLIGHT: run separately after this script succeeds.
-- SELECT proname, pg_get_function_result(oid) FROM pg_proc
-- WHERE pronamespace = 'public'::regnamespace AND proname IN
-- ('get_khala_money_history_v2','get_archive_management_items','reopen_archived_period',
--  'delete_my_notification','manager_delete_notification','delete_all_my_notifications',
--  'platform_admin_permanently_delete_hostel','platform_admin_list_expired_archives',
--  'platform_admin_list_saved_summaries','get_manager_meal_requests_v3',
--  'create_meal_request','create_late_meal_request','create_meal_correction_request',
--  'edit_my_approved_meal_request','manager_review_correction') ORDER BY proname;
