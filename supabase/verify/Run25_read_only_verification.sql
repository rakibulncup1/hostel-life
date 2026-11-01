-- Run25 read-only verification. This query does not change any data.
SELECT
  to_regprocedure('public.platform_admin_get_hostel_insights(uuid,uuid)') IS NOT NULL
    AS rpc_installed,
  COALESCE((
    SELECT p.prosecdef
    FROM pg_catalog.pg_proc p
    WHERE p.oid=to_regprocedure('public.platform_admin_get_hostel_insights(uuid,uuid)')
  ),false) AS security_definer_enabled,
  COALESCE((
    SELECT p.proconfig @> ARRAY['search_path=""']
    FROM pg_catalog.pg_proc p
    WHERE p.oid=to_regprocedure('public.platform_admin_get_hostel_insights(uuid,uuid)')
  ),false) AS empty_search_path,
  EXISTS (
    SELECT 1 FROM information_schema.routine_privileges rp
    WHERE rp.routine_schema='public'
      AND rp.routine_name='platform_admin_get_hostel_insights'
      AND rp.grantee='authenticated'
      AND rp.privilege_type='EXECUTE'
  ) AS authenticated_execute_granted,
  NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges rp
    WHERE rp.routine_schema='public'
      AND rp.routine_name='platform_admin_get_hostel_insights'
      AND rp.grantee IN ('PUBLIC','anon')
      AND rp.privilege_type='EXECUTE'
  ) AS public_anon_execute_revoked,
  COALESCE((
    SELECT pg_catalog.pg_get_functiondef(p.oid) ILIKE '%private.is_super_admin()%'
    FROM pg_catalog.pg_proc p
    WHERE p.oid=to_regprocedure('public.platform_admin_get_hostel_insights(uuid,uuid)')
  ),false) AS super_admin_guard_present;
