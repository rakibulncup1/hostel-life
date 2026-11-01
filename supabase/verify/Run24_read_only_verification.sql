-- Read-only verification for Run24_super_admin_observability.sql.
-- Run in Supabase SQL Editor after Run24; does not modify data.
SELECT 'platform_admin_get_overview exists' AS check_name,
       to_regprocedure('public.platform_admin_get_overview()') IS NOT NULL AS passed
UNION ALL
SELECT 'platform_admin_list_audit_logs exists',
       to_regprocedure('public.platform_admin_list_audit_logs(integer,integer,text,text,text)') IS NOT NULL
UNION ALL
SELECT 'platform_admin_list_access_code_history exists',
       to_regprocedure('public.platform_admin_list_access_code_history(integer,integer,text)') IS NOT NULL
UNION ALL
SELECT 'hostel flag audit function exists',
       to_regprocedure('public.platform_admin_set_hostel_flag(uuid,text,boolean)') IS NOT NULL
UNION ALL
SELECT 'user flag audit function exists',
       to_regprocedure('public.platform_admin_set_user_flag(uuid,text,boolean)') IS NOT NULL
UNION ALL
SELECT 'archive summary audit functions exist',
       to_regprocedure('public.platform_admin_finalize_archive_summary(uuid)') IS NOT NULL
       AND to_regprocedure('public.platform_admin_verify_archive_summary(uuid,text)') IS NOT NULL;

SELECT 'Audit RPC denied to anon' AS check_name,
       NOT has_function_privilege('anon', 'public.platform_admin_list_audit_logs(integer,integer,text,text,text)', 'EXECUTE') AS passed
UNION ALL
SELECT 'Audit RPC available to authenticated',
       has_function_privilege('authenticated', 'public.platform_admin_list_audit_logs(integer,integer,text,text,text)', 'EXECUTE')
UNION ALL
SELECT 'Code-history RPC denied to anon',
       NOT has_function_privilege('anon', 'public.platform_admin_list_access_code_history(integer,integer,text)', 'EXECUTE')
UNION ALL
SELECT 'Code-history RPC available to authenticated',
       has_function_privilege('authenticated', 'public.platform_admin_list_access_code_history(integer,integer,text)', 'EXECUTE');

SELECT 'Code history RPC does not reference code_hash' AS check_name,
       position('code_hash' IN pg_get_functiondef(
         'public.platform_admin_list_access_code_history(integer,integer,text)'::regprocedure
       )) = 0 AS passed;

SELECT 'Required indexes exist' AS check_name,
       to_regclass('public.platform_audit_log_action_created_idx') IS NOT NULL
       AND to_regclass('public.platform_access_codes_history_idx') IS NOT NULL AS passed;
