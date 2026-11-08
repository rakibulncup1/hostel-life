-- READ ONLY: Verify the additive Security Monitor account-identity enhancement.
WITH checks AS (
  SELECT 'COLUMN'::text AS category, 'actor_user_id exists on private.hl_security_events'::text AS item,
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='actor_user_id'
         ) AS passed
  UNION ALL
  SELECT 'CONSTRAINT', 'actor_user_id references auth.users with ON DELETE SET NULL',
         EXISTS (
           SELECT 1 FROM pg_constraint c
           WHERE c.conrelid='private.hl_security_events'::regclass
             AND c.conname='hl_security_events_actor_user_id_fkey'
             AND c.contype='f' AND c.confdeltype='n' AND c.convalidated
         )
  UNION ALL
  SELECT 'INDEX', 'actor_user_id + created_at index exists',
         to_regclass('private.hl_security_events_actor_created_idx') IS NOT NULL
  UNION ALL
  SELECT 'FUNCTION', 'authenticated login event writer exists',
         to_regprocedure('public.hl_record_authenticated_login_v1(uuid,text,text,inet,text,text,text,text,text,text)') IS NOT NULL
  UNION ALL
  SELECT 'FUNCTION', 'read-only Security Monitor writer health function exists',
         to_regprocedure('public.hl_security_monitor_writer_health_v1()') IS NOT NULL
  UNION ALL
  SELECT 'FUNCTION', 'Security Monitor reader exists with unchanged signature',
         to_regprocedure('public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer)') IS NOT NULL
  UNION ALL
  SELECT 'PRIVILEGE', 'writer health function is executable by service_role',
         has_function_privilege('service_role','public.hl_security_monitor_writer_health_v1()','EXECUTE')
  UNION ALL
  SELECT 'PRIVILEGE', 'writer health function is not executable by authenticated',
         NOT has_function_privilege('authenticated','public.hl_security_monitor_writer_health_v1()','EXECUTE')
  UNION ALL
  SELECT 'PRIVILEGE', 'login writer is executable by service_role',
         has_function_privilege('service_role','public.hl_record_authenticated_login_v1(uuid,text,text,inet,text,text,text,text,text,text)','EXECUTE')
  UNION ALL
  SELECT 'PRIVILEGE', 'login writer is not executable by authenticated',
         NOT has_function_privilege('authenticated','public.hl_record_authenticated_login_v1(uuid,text,text,inet,text,text,text,text,text,text)','EXECUTE')
  UNION ALL
  SELECT 'PRIVILEGE', 'login writer is not executable by anon',
         NOT has_function_privilege('anon','public.hl_record_authenticated_login_v1(uuid,text,text,inet,text,text,text,text,text,text)','EXECUTE')
  UNION ALL
  SELECT 'PRIVILEGE', 'Security Monitor reader is executable by authenticated',
         has_function_privilege('authenticated','public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer)','EXECUTE')
  UNION ALL
  SELECT 'PRIVILEGE', 'Security Monitor reader is not executable by anon',
         NOT has_function_privilege('anon','public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer)','EXECUTE')
)
SELECT category, item, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS status
FROM checks
ORDER BY category, item;

SELECT count(*) FILTER (WHERE NOT passed) AS failures,
       CASE WHEN count(*) FILTER (WHERE NOT passed)=0 THEN 'PASS' ELSE 'CHECK REQUIRED' END AS overall_status
FROM (
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='actor_user_id'
  ) AS passed
  UNION ALL SELECT EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conrelid='private.hl_security_events'::regclass
      AND c.conname='hl_security_events_actor_user_id_fkey' AND c.contype='f' AND c.confdeltype='n' AND c.convalidated
  )
  UNION ALL SELECT to_regclass('private.hl_security_events_actor_created_idx') IS NOT NULL
  UNION ALL SELECT to_regprocedure('public.hl_record_authenticated_login_v1(uuid,text,text,inet,text,text,text,text,text,text)') IS NOT NULL
  UNION ALL SELECT to_regprocedure('public.hl_security_monitor_writer_health_v1()') IS NOT NULL
  UNION ALL SELECT to_regprocedure('public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer)') IS NOT NULL
  UNION ALL SELECT has_function_privilege('service_role','public.hl_security_monitor_writer_health_v1()','EXECUTE')
  UNION ALL SELECT NOT has_function_privilege('authenticated','public.hl_security_monitor_writer_health_v1()','EXECUTE')
  UNION ALL SELECT has_function_privilege('service_role','public.hl_record_authenticated_login_v1(uuid,text,text,inet,text,text,text,text,text,text)','EXECUTE')
  UNION ALL SELECT NOT has_function_privilege('authenticated','public.hl_record_authenticated_login_v1(uuid,text,text,inet,text,text,text,text,text,text)','EXECUTE')
  UNION ALL SELECT NOT has_function_privilege('anon','public.hl_record_authenticated_login_v1(uuid,text,text,inet,text,text,text,text,text,text)','EXECUTE')
  UNION ALL SELECT has_function_privilege('authenticated','public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer)','EXECUTE')
  UNION ALL SELECT NOT has_function_privilege('anon','public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer)','EXECUTE')
) summary;
