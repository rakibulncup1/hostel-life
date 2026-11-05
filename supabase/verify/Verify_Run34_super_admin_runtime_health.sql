-- Read-only verification for Run34_super_admin_runtime_health_and_audit_readability.sql
-- Safe to run in Supabase SQL Editor after Run34 has been applied.

WITH expected(function_name, identity_arguments) AS (
  VALUES
    ('platform_admin_get_database_runtime_health', ''),
    ('platform_admin_list_audit_logs', 'p_limit integer, p_offset integer, p_action text, p_target_type text, p_search text')
), resolved AS (
  SELECT e.function_name, e.identity_arguments,
         p.oid, p.prosecdef, p.provolatile, p.proconfig, p.proacl, p.proowner,
         n.nspname
  FROM expected e
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='public'
  LEFT JOIN pg_catalog.pg_proc p
    ON p.pronamespace=n.oid
   AND p.proname=e.function_name
   AND pg_catalog.pg_get_function_identity_arguments(p.oid)=e.identity_arguments
)
SELECT
  function_name,
  identity_arguments,
  (oid IS NOT NULL) AS function_exists,
  COALESCE(prosecdef,false) AS security_definer,
  (provolatile='s') AS stable_read_function,
  proconfig AS function_configuration,
  CASE WHEN oid IS NULL THEN false
       ELSE has_function_privilege('authenticated',oid,'EXECUTE') END AS authenticated_can_execute,
  CASE WHEN oid IS NULL THEN false
       ELSE has_function_privilege('anon',oid,'EXECUTE') END AS anon_can_execute,
  CASE WHEN oid IS NULL THEN false
       ELSE EXISTS (
         SELECT 1
         FROM aclexplode(COALESCE(proacl,acldefault('f',proowner))) AS acl
         WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
       ) END AS public_can_execute
FROM resolved
ORDER BY function_name;

-- Expected: both functions exist, are SECURITY DEFINER and STABLE,
-- authenticated can execute, anon and PUBLIC cannot execute.
-- No application data or schema is modified by this verification query.
