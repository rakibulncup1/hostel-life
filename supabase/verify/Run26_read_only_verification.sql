-- Read-only verification for Run26. Safe to execute repeatedly.
WITH expected(signature) AS (
  VALUES
    ('public.platform_admin_get_system_health(integer)'),
    ('public.platform_admin_list_notice_monitoring(integer,integer,text)'),
    ('public.platform_admin_get_platform_report(date,date)')
), checks AS (
  SELECT e.signature,
    to_regprocedure(e.signature) IS NOT NULL AS function_exists,
    COALESCE(p.prosecdef,false) AS security_definer,
    COALESCE(array_to_string(p.proconfig,',') ILIKE '%search_path=%',false) AS explicit_search_path,
    CASE WHEN p.oid IS NULL THEN false ELSE has_function_privilege('authenticated',p.oid,'EXECUTE') END AS authenticated_can_execute,
    CASE WHEN p.oid IS NULL THEN true ELSE NOT has_function_privilege('anon',p.oid,'EXECUTE') END AS anon_cannot_execute,
    CASE WHEN p.oid IS NULL THEN true ELSE NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
      WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
    ) END AS public_cannot_execute
  FROM expected e
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
)
SELECT signature,
  function_exists,
  security_definer,
  explicit_search_path,
  authenticated_can_execute,
  anon_cannot_execute,
  public_cannot_execute,
  (function_exists AND security_definer AND explicit_search_path
    AND authenticated_can_execute AND anon_cannot_execute AND public_cannot_execute) AS all_checks_pass
FROM checks
ORDER BY signature;
