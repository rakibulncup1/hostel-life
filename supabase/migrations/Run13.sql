-- IMPORTANT: BACK UP BEFORE USE. Migration is transactional.
-- Replaces only the platform-admin hostel delete RPC; does not change foreign keys.
-- CAUTION: Take a database backup. Review the schema before applying.
BEGIN;
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

  -- Delete period trees WHILE the hostel still exists. Child triggers that
  -- regenerate daily_meal_snapshots then have a valid hostel parent.
  DELETE FROM public.monthly_periods WHERE hostel_id = p_hostel_id;
  -- In databases with snapshot-recalculation triggers, remove regenerated
  -- snapshots only after deleting the meal-related period tree.
  IF to_regclass('public.daily_meal_snapshots') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.daily_meal_snapshots WHERE hostel_id = $1' USING p_hostel_id;
  END IF;
  -- Delete remaining direct dependents ahead of the parent to prevent cascading
  -- DELETE triggers from trying to reinsert rows after the hostel is gone.
  DELETE FROM public.hostel_memberships WHERE hostel_id = p_hostel_id;
  DELETE FROM public.notifications WHERE hostel_id = p_hostel_id;
  DELETE FROM public.archive_period_audit WHERE hostel_id = p_hostel_id;
  DELETE FROM public.archive_edit_permissions WHERE hostel_id = p_hostel_id;
  DELETE FROM public.period_assistant_managers WHERE hostel_id = p_hostel_id;
  DELETE FROM public.meal_late_overrides WHERE hostel_id = p_hostel_id;
  DELETE FROM public.meal_requests WHERE hostel_id = p_hostel_id;
  DELETE FROM public.daily_meal_records WHERE hostel_id = p_hostel_id;
  DELETE FROM public.daily_meal_days WHERE hostel_id = p_hostel_id;
  DELETE FROM public.market_entries WHERE hostel_id = p_hostel_id;
  DELETE FROM public.ledger_transactions WHERE hostel_id = p_hostel_id;
  DELETE FROM public.khala_money_entries WHERE hostel_id = p_hostel_id;
  IF to_regclass('public.daily_meal_snapshots') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.daily_meal_snapshots WHERE hostel_id = $1' USING p_hostel_id;
  END IF;
  DELETE FROM public.hostels WHERE id = p_hostel_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN RAISE EXCEPTION USING message = 'মেসের রেকর্ড স্থায়ীভাবে সরানো যায়নি।', errcode = '55000'; END IF;

  -- Write the audit record before optionally deleting now-unshared auth accounts.
  INSERT INTO public.platform_audit_log(actor_user_id, action, target_type, target_id, reason, details)
  VALUES(auth.uid(), 'hostel_permanently_deleted', 'hostel', p_hostel_id::text, 'Super Delete',
    jsonb_build_object('name', v_name, 'member_accounts_deleted', 0,
                       'summary_snapshots_removed', true));

  -- Auth accounts are intentionally preserved; remove only through the verified Edge Function.

  RETURN jsonb_build_object('status','deleted','hostel_id',p_hostel_id,
    'hostel_name',v_name,'member_accounts_deleted',0,'auth_cleanup_separate',true);
END
$fn$;

-- Read-only closed period directory. Visibility != deletion eligibility.
CREATE OR REPLACE FUNCTION public.platform_admin_list_closed_periods()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $catalog$
DECLARE v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING message = 'Super Admin only', errcode = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'hostel_id', q.hostel_id, 'hostel_name', q.hostel_name,
    'period_id', q.period_id, 'period_label', q.period_label,
    'start_date', q.start_date, 'end_date', q.end_date,
    'detail_until', q.detail_until, 'delete_eligible_after', q.delete_eligible_after
  ) ORDER BY q.end_date DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT mp.hostel_id, h.name AS hostel_name, mp.id AS period_id,
      mp.label AS period_label, mp.start_date, mp.end_date,
      (mp.end_date + make_interval(months => rp.detail_months))::date AS detail_until,
      (mp.end_date + make_interval(months => rp.detail_months+rp.summary_months))::date AS delete_eligible_after
    FROM public.monthly_periods mp
    JOIN public.hostels h ON h.id=mp.hostel_id
    CROSS JOIN public.platform_retention_policy rp
    WHERE rp.singleton=true AND mp.status IN ('closed','archived')
    ORDER BY mp.end_date DESC, mp.created_at DESC LIMIT 300
  ) q;
  RETURN v_result;
END
$catalog$;
REVOKE ALL ON FUNCTION public.platform_admin_list_closed_periods() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_closed_periods() TO authenticated;

REVOKE ALL ON FUNCTION public.platform_admin_permanently_delete_hostel(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_permanently_delete_hostel(uuid,boolean,text) TO authenticated;

COMMIT;
