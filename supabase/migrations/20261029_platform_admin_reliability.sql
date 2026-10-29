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

  -- These snapshots have a restrictive FK to the hostel; remove them first.
  -- The deletion stays transactional: any later FK failure rolls all changes back.
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

-- Read-only identity roles for Super Admin. No financial data is returned.
CREATE OR REPLACE FUNCTION public.hl_platform_hostel_roles(p_hostel_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_rows jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING message = 'Super Admin only', errcode = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'membership_id', m.id,
    'primary', EXISTS(SELECT 1 FROM public.monthly_periods p
       WHERE p.hostel_id=m.hostel_id AND p.status='running'
         AND p.primary_manager_membership_id=m.id),
    'assistant', EXISTS(SELECT 1 FROM public.period_assistant_managers am
       JOIN public.monthly_periods p ON p.id=am.period_id
       WHERE p.hostel_id=m.hostel_id AND p.status='running'
         AND (to_jsonb(am)->>'membership_id')=m.id::text)
  ) ORDER BY m.id), '[]'::jsonb) INTO v_rows
  FROM public.hostel_memberships m WHERE m.hostel_id=p_hostel_id;
  RETURN v_rows;
END $fn$;
REVOKE ALL ON FUNCTION public.hl_platform_hostel_roles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hl_platform_hostel_roles(uuid) TO authenticated;

COMMIT;
