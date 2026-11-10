-- HOSTEL LIFE — Run43: only the member who closed a month may edit that closed month.
-- This tightens Archive Correction, History edits, and closed-period Khala edits.
-- All other members and managers retain read access through the existing read RPCs.
-- Run once in Supabase SQL Editor after Run39 and Run42 have been applied.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $run43_preflight$
DECLARE
  v_get_def text;
  v_apply_def text;
  v_closed_def text;
  v_closed_normalized text;
  v_owner_get oid;
  v_owner_apply oid;
  v_owner_reopen oid;
  v_reopen_def text;
BEGIN
  IF to_regclass('public.monthly_periods') IS NULL
     OR to_regclass('public.archive_edit_permissions') IS NULL
     OR to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Run43 preflight failed: expected archive/month membership tables are missing. No changes made.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='monthly_periods' AND column_name='closed_by')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='monthly_periods' AND column_name='status')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='archive_edit_permissions' AND column_name='revoked_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='archive_edit_permissions' AND column_name='period_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='archive_edit_permissions' AND column_name='membership_id') THEN
    RAISE EXCEPTION 'Run43 preflight failed: archive closer/permission columns do not match the expected schema. No changes made.';
  END IF;

  IF to_regprocedure('private.can_manage_closed_period(uuid,uuid)') IS NULL
     OR to_regprocedure('private.can_manage_hostel(uuid,uuid,boolean,boolean)') IS NULL
     OR to_regprocedure('private.can_manage_khala_period(uuid,uuid)') IS NULL
     OR to_regprocedure('public.get_my_archive_editable_periods()') IS NULL
     OR to_regprocedure('public.get_khala_entry_periods_v2()') IS NULL
     OR to_regprocedure('public.grant_archive_edit_permission(uuid,uuid,timestamptz,text)') IS NULL
     OR to_regprocedure('public.hlc_get_archive_correction_bundle(uuid)') IS NULL
     OR to_regprocedure('public.hlc_apply_archive_correction(uuid,text,uuid,jsonb,text)') IS NULL
     OR to_regprocedure('public.reopen_archived_period(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Run43 preflight failed: expected Run39/Run42 archive and Khala RPC signatures are missing. No changes made.';
  END IF;

  SELECT pg_get_functiondef('private.can_manage_closed_period(uuid,uuid)'::regprocedure)
    INTO v_closed_def;
  v_closed_normalized := lower(regexp_replace(v_closed_def, '\s+', '', 'g'));
  IF position('mp.closed_by=auth.uid()' IN v_closed_normalized)=0
     OR position('mp.statusin(''closed'',''archived'')' IN v_closed_normalized)=0
     OR position('m.status=''active''' IN v_closed_normalized)=0
     OR position('notcoalesce(p.is_blocked,false)' IN v_closed_normalized)=0
     OR position('mp.hostel_id=p_hostel_id' IN v_closed_normalized)=0 THEN
    RAISE EXCEPTION 'Run43 preflight failed: the canonical closed-by helper is not the exact active, unblocked, same-hostel closer check. No changes made.';
  END IF;

  SELECT pg_get_functiondef('public.hlc_get_archive_correction_bundle(uuid)'::regprocedure)
    INTO v_get_def;
  SELECT pg_get_functiondef('public.hlc_apply_archive_correction(uuid,text,uuid,jsonb,text)'::regprocedure)
    INTO v_apply_def;
  SELECT p.proowner INTO v_owner_get
    FROM pg_proc p WHERE p.oid='public.hlc_get_archive_correction_bundle(uuid)'::regprocedure;
  SELECT p.proowner INTO v_owner_apply
    FROM pg_proc p WHERE p.oid='public.hlc_apply_archive_correction(uuid,text,uuid,jsonb,text)'::regprocedure;
  SELECT p.proowner INTO v_owner_reopen
    FROM pg_proc p WHERE p.oid='public.reopen_archived_period(uuid)'::regprocedure;
  SELECT pg_get_functiondef('public.reopen_archived_period(uuid)'::regprocedure)
    INTO v_reopen_def;

  IF position('private.is_primary_manager' IN v_get_def)=0
     OR position('private.can_manage_closed_period' IN v_get_def)=0
     OR position('private.is_primary_manager' IN v_apply_def)=0
     OR position('private.can_manage_closed_period' IN v_apply_def)=0 THEN
    RAISE EXCEPTION 'Run43 preflight failed: HLC RPC definitions differ from the known Run39 implementation. No changes made.';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.hlc_get_archive_correction_bundle(uuid)'::regprocedure)
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.hlc_apply_archive_correction(uuid,text,uuid,jsonb,text)'::regprocedure)
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.reopen_archived_period(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'Run43 preflight failed: HLC correction RPCs are not SECURITY DEFINER. No changes made.';
  END IF;

  IF v_owner_get <> v_owner_apply OR v_owner_get <> v_owner_reopen THEN
    RAISE EXCEPTION 'Run43 preflight failed: archive correction/reopen RPC owners differ. No changes made.';
  END IF;
  IF position('private.assert_hostel_manager' IN v_reopen_def)=0
     OR position('status = ''closed''' IN v_reopen_def)=0 THEN
    RAISE EXCEPTION 'Run43 preflight failed: reopen RPC differs from the known Run10 guarded implementation. No changes made.';
  END IF;
  IF NOT has_schema_privilege(current_user,'private','USAGE')
     OR NOT has_function_privilege(current_user,'private.can_manage_closed_period(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege(current_user,'private.my_hostel_id()','EXECUTE')
     OR NOT has_function_privilege(current_user,'private.assert_signed_in()','EXECUTE') THEN
    RAISE EXCEPTION 'Run43 must be applied by the database migration owner (normally postgres) with access to the private security helpers. No changes made.';
  END IF;

  IF to_regprocedure('private.hlc_get_archive_correction_bundle_legacy_run39(uuid)') IS NOT NULL
     OR to_regprocedure('private.hlc_apply_archive_correction_legacy_run39(uuid,text,uuid,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Run43 preflight failed: legacy HLC wrapper targets already exist; this migration may have been partially applied. Stop and inspect before retrying.';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid='private.can_manage_hostel(uuid,uuid,boolean,boolean)'::regprocedure)
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid='private.can_manage_khala_period(uuid,uuid)'::regprocedure)
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.get_my_archive_editable_periods()'::regprocedure) THEN
    RAISE EXCEPTION 'Run43 preflight failed: a permission RPC/helper security-definer setting differs from the expected baseline. No changes made.';
  END IF;
END;
$run43_preflight$;

-- The generic manager helper keeps its original running-month rules. For a closed
-- or archived period it now returns true only for the active, unblocked member
-- identified by monthly_periods.closed_by. Legacy archive grants and Super Admin
-- status cannot override the closed-period editor identity.
CREATE OR REPLACE FUNCTION private.can_manage_hostel(
  p_hostel_id uuid,
  p_period_id uuid DEFAULT NULL,
  p_primary_only boolean DEFAULT false,
  p_allow_archive boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $run43$
  SELECT private.is_current_auth_session_allowed()
    AND p_hostel_id IS NOT NULL
    AND CASE
      WHEN p_period_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.monthly_periods mp
        WHERE mp.id=p_period_id AND mp.hostel_id=p_hostel_id
          AND mp.status IN ('closed','archived')
      ) THEN private.can_manage_closed_period(p_hostel_id,p_period_id)

      WHEN p_period_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.monthly_periods mp
        WHERE mp.id=p_period_id AND mp.hostel_id=p_hostel_id AND mp.status='running'
      ) THEN (
        private.is_super_admin()
        OR EXISTS (
          SELECT 1 FROM public.monthly_periods mp
          JOIN public.hostel_memberships m ON m.id=mp.primary_manager_membership_id
          JOIN public.profiles p ON p.id=m.user_id
          WHERE mp.id=p_period_id AND mp.hostel_id=p_hostel_id AND mp.status='running'
            AND m.user_id=auth.uid() AND m.status='active' AND NOT COALESCE(p.is_blocked,false)
        )
        OR (NOT p_primary_only AND EXISTS (
          SELECT 1 FROM public.period_assistant_managers a
          JOIN public.hostel_memberships m ON m.id=a.membership_id
          JOIN public.profiles p ON p.id=m.user_id
          WHERE a.period_id=p_period_id AND m.hostel_id=p_hostel_id
            AND m.user_id=auth.uid() AND m.status='active' AND NOT COALESCE(p.is_blocked,false)
        ))
      )

      WHEN p_period_id IS NOT NULL THEN false

      ELSE (
        private.is_super_admin()
        OR EXISTS (
          SELECT 1 FROM public.monthly_periods mp
          JOIN public.hostel_memberships m ON m.id=mp.primary_manager_membership_id
          JOIN public.profiles p ON p.id=m.user_id
          WHERE mp.hostel_id=p_hostel_id AND mp.status='running'
            AND m.user_id=auth.uid() AND m.status='active' AND NOT COALESCE(p.is_blocked,false)
        )
        OR (NOT p_primary_only AND EXISTS (
          SELECT 1 FROM public.monthly_periods mp
          JOIN public.period_assistant_managers a ON a.period_id=mp.id
          JOIN public.hostel_memberships m ON m.id=a.membership_id
          JOIN public.profiles p ON p.id=m.user_id
          WHERE mp.hostel_id=p_hostel_id AND mp.status='running'
            AND m.user_id=auth.uid() AND m.status='active' AND NOT COALESCE(p.is_blocked,false)
        ))
        OR (
          NOT EXISTS (SELECT 1 FROM public.monthly_periods mp WHERE mp.hostel_id=p_hostel_id AND mp.status='running')
          AND EXISTS (
            SELECT 1 FROM public.hostel_memberships m
            JOIN public.profiles p ON p.id=m.user_id
            WHERE m.hostel_id=p_hostel_id AND m.user_id=auth.uid() AND m.role='manager'
              AND m.status='active' AND NOT COALESCE(p.is_blocked,false)
          )
        )
      )
    END;
$run43$;
REVOKE ALL ON FUNCTION private.can_manage_hostel(uuid,uuid,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.can_manage_hostel(uuid,uuid,boolean,boolean) TO authenticated;

-- Closed-period Khala add/edit/void operations use the same closer-only rule.
-- Running-period manager/assistant permissions remain unchanged.
CREATE OR REPLACE FUNCTION private.can_manage_khala_period(p_hostel_id uuid,p_period_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $run43$
  SELECT private.is_current_auth_session_allowed()
    AND CASE
      WHEN EXISTS (
        SELECT 1 FROM public.monthly_periods mp
        WHERE mp.id=p_period_id AND mp.hostel_id=p_hostel_id AND mp.status IN ('closed','archived')
      ) THEN private.can_manage_closed_period(p_hostel_id,p_period_id)
      WHEN EXISTS (
        SELECT 1 FROM public.monthly_periods mp
        WHERE mp.id=p_period_id AND mp.hostel_id=p_hostel_id AND mp.status='running'
      ) THEN private.is_super_admin() OR private.can_manage_hostel(p_hostel_id,p_period_id,false,false)
      ELSE false
    END;
$run43$;
REVOKE ALL ON FUNCTION private.can_manage_khala_period(uuid,uuid) FROM PUBLIC,anon,authenticated;

-- A caller sees an editable period only when they themselves closed it.
CREATE OR REPLACE FUNCTION public.get_my_archive_editable_periods()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $run43$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'period_id',mp.id,
        'id',mp.id,
        'label',mp.label,
        'start_date',mp.start_date,
        'end_date',mp.end_date,
        'status',mp.status,
        'permission_id',NULL,
        'reason','আপনি এই মাসটি বন্ধ করেছেন',
        'expires_at',NULL,
        'access_kind','closed_by',
        'manager_at_close_name',NULLIF(btrim(closer.full_name),'')
      ) ORDER BY mp.start_date DESC
    ), '[]'::jsonb
  ) INTO v_result
  FROM public.monthly_periods mp
  LEFT JOIN public.profiles closer ON closer.id=mp.closed_by
  WHERE mp.hostel_id=v_hostel
    AND mp.status IN ('closed','archived')
    AND private.can_manage_closed_period(mp.hostel_id,mp.id);
  RETURN v_result;
END;
$run43$;
REVOKE ALL ON FUNCTION public.get_my_archive_editable_periods() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_archive_editable_periods() TO authenticated;

-- Keep old permission records for audit, but revoke their active state. They no
-- longer grant edit access to any user, including the current Primary Manager.
UPDATE public.archive_edit_permissions
SET revoked_at=COALESCE(revoked_at,clock_timestamp())
WHERE revoked_at IS NULL;

-- Defense in depth: clients may read the old audit rows, but must not write
-- permission records directly. SECURITY DEFINER helpers retain owner access.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.archive_edit_permissions
  FROM PUBLIC, anon, authenticated;

-- Disallow issuing new per-month overrides. The month closer has access directly
-- through closed_by; no other user can be granted archive edit access.
CREATE OR REPLACE FUNCTION public.grant_archive_edit_permission(
  p_period_id uuid,
  p_membership_id uuid,
  p_expires_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $run43$
BEGIN
  PERFORM private.assert_signed_in();
  RAISE EXCEPTION USING
    MESSAGE='বন্ধ মাসে আলাদা সম্পাদনা-অনুমতি দেওয়া যায় না। শুধু যিনি মাসটি বন্ধ করেছেন তিনিই সংশোধন করতে পারবেন।',
    ERRCODE='42501';
  RETURN '{}'::jsonb;
END;
$run43$;
REVOKE ALL ON FUNCTION public.grant_archive_edit_permission(uuid,uuid,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.grant_archive_edit_permission(uuid,uuid,timestamptz,text) TO authenticated;

-- Hide the old, broader HLC implementation in the private schema and expose a
-- small SECURITY DEFINER gate. The unchanged legacy functions still perform
-- all of the original period validation, audit logging and writes after the gate.
ALTER FUNCTION public.hlc_get_archive_correction_bundle(uuid) SET SCHEMA private;
ALTER FUNCTION private.hlc_get_archive_correction_bundle(uuid) RENAME TO hlc_get_archive_correction_bundle_legacy_run39;
ALTER FUNCTION public.hlc_apply_archive_correction(uuid,text,uuid,jsonb,text) SET SCHEMA private;
ALTER FUNCTION private.hlc_apply_archive_correction(uuid,text,uuid,jsonb,text) RENAME TO hlc_apply_archive_correction_legacy_run39;
ALTER FUNCTION public.reopen_archived_period(uuid) SET SCHEMA private;
ALTER FUNCTION private.reopen_archived_period(uuid) RENAME TO reopen_archived_period_legacy_run10;
REVOKE ALL ON FUNCTION private.hlc_get_archive_correction_bundle_legacy_run39(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.hlc_apply_archive_correction_legacy_run39(uuid,text,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.reopen_archived_period_legacy_run10(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.hlc_get_archive_correction_bundle_legacy_run39(uuid) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION private.hlc_apply_archive_correction_legacy_run39(uuid,text,uuid,jsonb,text) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION private.reopen_archived_period_legacy_run10(uuid) TO CURRENT_USER;

CREATE FUNCTION public.hlc_get_archive_correction_bundle(p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $run43$
DECLARE v_hostel uuid := private.my_hostel_id();
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.can_manage_closed_period(v_hostel,p_period_id) THEN
    RAISE EXCEPTION USING MESSAGE='এই মাসটি আপনি বন্ধ করেননি; তাই সংশোধনের অনুমতি নেই।', ERRCODE='42501';
  END IF;
  RETURN private.hlc_get_archive_correction_bundle_legacy_run39(p_period_id);
END;
$run43$;
REVOKE ALL ON FUNCTION public.hlc_get_archive_correction_bundle(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hlc_get_archive_correction_bundle(uuid) TO authenticated;

CREATE FUNCTION public.hlc_apply_archive_correction(p_period_id uuid,p_kind text,p_target_id uuid,p_changes jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $run43$
DECLARE v_hostel uuid := private.my_hostel_id();
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.can_manage_closed_period(v_hostel,p_period_id) THEN
    RAISE EXCEPTION USING MESSAGE='এই মাসটি আপনি বন্ধ করেননি; তাই সংশোধনের অনুমতি নেই।', ERRCODE='42501';
  END IF;
  RETURN private.hlc_apply_archive_correction_legacy_run39(p_period_id,p_kind,p_target_id,p_changes,p_reason);
END;
$run43$;
REVOKE ALL ON FUNCTION public.hlc_apply_archive_correction(uuid,text,uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hlc_apply_archive_correction(uuid,text,uuid,jsonb,text) TO authenticated;

-- Reopening a closed month would clear closed_by and otherwise become a route
-- around the archive edit lock. Keep the original month-reopen business rules,
-- but require its recorded closer before the legacy reopen routine can run.
CREATE FUNCTION public.reopen_archived_period(p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $run43$
DECLARE v_hostel uuid := private.my_hostel_id();
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.can_manage_closed_period(v_hostel,p_period_id) THEN
    RAISE EXCEPTION USING MESSAGE='এই মাসটি আপনি বন্ধ করেননি; তাই পুনরায় চালু করার অনুমতি নেই।', ERRCODE='42501';
  END IF;
  RETURN private.reopen_archived_period_legacy_run10(p_period_id);
END;
$run43$;
REVOKE ALL ON FUNCTION public.reopen_archived_period(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reopen_archived_period(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
