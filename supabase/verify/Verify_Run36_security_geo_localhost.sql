-- Hostel Life — READ-ONLY Run36 verification
-- Run only after Run36_security_geo_location_and_localhost_diagnostics.sql succeeds.
-- No schema, data, grants, functions, or settings are changed by this query.

WITH required_columns(schema_name, table_name, column_name) AS (
  VALUES
    ('private','hl_security_events','city'),
    ('private','hl_security_events','region'),
    ('private','hl_security_events','region_code'),
    ('private','hl_security_ip_blocks','city'),
    ('private','hl_security_ip_blocks','region'),
    ('private','hl_security_ip_blocks','region_code'),
    ('private','hl_password_reset_ip_attempts','city'),
    ('private','hl_password_reset_ip_attempts','region'),
    ('private','hl_password_reset_ip_attempts','region_code')
),
checks AS (
  SELECT 'COLUMN'::text AS section,
    schema_name||'.'||table_name||'.'||column_name AS item,
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema=required_columns.schema_name
        AND c.table_name=required_columns.table_name
        AND c.column_name=required_columns.column_name
    ) THEN 'PASS' ELSE 'FAIL' END AS result
  FROM required_columns
  UNION ALL SELECT 'FUNCTION','Geo-aware event writer',CASE WHEN to_regprocedure('public.hl_record_public_security_event_v3(text,text,text,inet,text,text,text,text,text,text,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 'FUNCTION','Geo-aware reset IP limiter',CASE WHEN to_regprocedure('public.hl_consume_password_reset_ip_request_v2(inet,text,text,text,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 'FUNCTION','Security overview',CASE WHEN to_regprocedure('public.platform_admin_get_security_overview_v2()') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 'FUNCTION','City/region event reader',CASE WHEN to_regprocedure('public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 'FUNCTION','IP block reader',CASE WHEN to_regprocedure('public.platform_admin_list_security_ip_blocks(text,integer,integer)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 'PRIVILEGE','Security overview authenticated-only',CASE WHEN f.oid IS NOT NULL
    AND has_function_privilege('authenticated',f.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',f.oid,'EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END
  FROM (SELECT to_regprocedure('public.platform_admin_get_security_overview_v2()')::oid AS oid) f
  UNION ALL SELECT 'PRIVILEGE','IP block reader authenticated-only',CASE WHEN f.oid IS NOT NULL
    AND has_function_privilege('authenticated',f.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',f.oid,'EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END
  FROM (SELECT to_regprocedure('public.platform_admin_list_security_ip_blocks(text,integer,integer)')::oid AS oid) f
  UNION ALL SELECT 'PRIVILEGE','Event writer service_role only',CASE WHEN f.oid IS NOT NULL
    AND has_function_privilege('service_role',f.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',f.oid,'EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END
  FROM (SELECT to_regprocedure('public.hl_record_public_security_event_v3(text,text,text,inet,text,text,text,text,text,text,text)')::oid AS oid) f
  UNION ALL SELECT 'PRIVILEGE','Reset IP limiter service_role only',CASE WHEN f.oid IS NOT NULL
    AND has_function_privilege('service_role',f.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',f.oid,'EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END
  FROM (SELECT to_regprocedure('public.hl_consume_password_reset_ip_request_v2(inet,text,text,text,text)')::oid AS oid) f
  UNION ALL SELECT 'PRIVILEGE','Security event reader authenticated only',CASE WHEN f.oid IS NOT NULL
    AND has_function_privilege('authenticated',f.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',f.oid,'EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END
  FROM (SELECT to_regprocedure('public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer)')::oid AS oid) f
  UNION ALL SELECT 'HARDENING','Event writer is SECURITY DEFINER',CASE WHEN coalesce((SELECT p.prosecdef FROM pg_proc p WHERE p.oid=to_regprocedure('public.hl_record_public_security_event_v3(text,text,text,inet,text,text,text,text,text,text,text)')::oid),false) THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT 'HARDENING','Reset limiter is SECURITY DEFINER',CASE WHEN coalesce((SELECT p.prosecdef FROM pg_proc p WHERE p.oid=to_regprocedure('public.hl_consume_password_reset_ip_request_v2(inet,text,text,text,text)')::oid),false) THEN 'PASS' ELSE 'FAIL' END
)
SELECT section,item,result FROM checks
UNION ALL
SELECT 'SUMMARY',
  count(*) FILTER (WHERE result='PASS')::text||' checks passed; '||count(*) FILTER (WHERE result='FAIL')::text||' failed',
  CASE WHEN count(*) FILTER (WHERE result='FAIL')=0 THEN 'PASS' ELSE 'FAIL' END
FROM checks
ORDER BY section,item;
