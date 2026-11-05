-- Hostel Life Run35 — READ-ONLY verification
-- Run only after applying Run35. Every statement is SELECT-only.

-- 1) Required relations and private RLS boundaries.
WITH expected(schema_name, table_name) AS (
  VALUES
    ('private','hl_security_events'),
    ('private','hl_activity_events'),
    ('private','hl_security_ip_blocks'),
    ('private','hl_password_reset_ip_attempts'),
    ('private','password_reset_request_log'),
    ('public','user_notification_channels'),
    ('public','notification_link_tokens'),
    ('public','hl_auth_sessions')
)
SELECT e.schema_name, e.table_name,
       (c.oid IS NOT NULL) AS exists,
       COALESCE(c.relrowsecurity,false) AS rls_enabled,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('anon',c.oid,'SELECT') END AS anon_can_select,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('authenticated',c.oid,'SELECT') END AS authenticated_can_select,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('service_role',c.oid,'SELECT') END AS service_role_can_select
FROM expected e
LEFT JOIN pg_namespace n ON n.nspname=e.schema_name
LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=e.table_name
ORDER BY e.schema_name,e.table_name;

-- 2) Run35 columns and constraints.
SELECT table_schema,table_name,column_name,data_type
FROM information_schema.columns
WHERE (table_schema='private' AND table_name IN ('hl_security_events','hl_security_ip_blocks','hl_password_reset_ip_attempts') AND column_name='country_code')
   OR (table_schema='auth' AND table_name='sessions' AND column_name='not_after')
ORDER BY table_schema,table_name,column_name;

SELECT n.nspname AS schema_name,c.relname AS table_name,con.conname,con.contype,con.convalidated,pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid=con.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE (n.nspname='private' AND c.relname IN ('hl_security_events','hl_security_ip_blocks') AND con.conname LIKE '%run35%')
   OR (n.nspname='public' AND c.relname='hl_auth_sessions' AND con.conname='hl_auth_sessions_revoke_reason_run35_check')
ORDER BY n.nspname,c.relname,con.conname;

-- 3) Function presence, SECURITY DEFINER, hardened search_path and grants.
WITH expected(function_name, signature, access_role) AS (
  VALUES
    ('event ingestion v2','public.hl_record_public_security_event_v2(text,text,text,inet,text,text,text,text)'::text,'service_role'),
    ('auth IP block lookup','public.hl_check_auth_ip_block(inet)'::text,'service_role'),
    ('password reset IP limiter','public.hl_consume_password_reset_ip_request(inet,text)'::text,'service_role'),
    ('password reset email quota','public.consume_password_reset_quota(text)'::text,'service_role'),
    ('Activity Timeline v2','public.platform_admin_list_activity_v2(uuid,text,timestamptz,timestamptz,integer,integer)'::text,'authenticated'),
    ('Security overview v2','public.platform_admin_get_security_overview_v2()'::text,'authenticated'),
    ('Security event list v2','public.platform_admin_list_security_events_v2(text,text,text,timestamptz,timestamptz,integer,integer)'::text,'authenticated'),
    ('Active IP blocks','public.platform_admin_list_security_ip_blocks(text,integer,integer)'::text,'authenticated'),
    ('Telegram directory','public.platform_admin_list_telegram_connections(text,integer,integer)'::text,'authenticated'),
    ('Telegram disconnect','public.platform_admin_disconnect_telegram_user(uuid,text)'::text,'authenticated'),
    ('Active session directory','public.platform_admin_list_active_sessions(text,integer,integer)'::text,'authenticated'),
    ('Session revoke','public.platform_admin_revoke_active_session(uuid,text,text)'::text,'authenticated')
), resolved AS (
  SELECT e.*,to_regprocedure(e.signature) AS proc_oid FROM expected e
)
SELECT r.function_name,r.signature,
       (p.oid IS NOT NULL) AS exists,
       COALESCE(p.prosecdef,false) AS security_definer,
       p.provolatile AS volatility,
       p.proconfig AS function_settings,
       CASE WHEN p.oid IS NULL THEN NULL ELSE has_function_privilege(r.access_role,p.oid,'EXECUTE') END AS intended_role_can_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE has_function_privilege('anon',p.oid,'EXECUTE') END AS anon_can_execute
FROM resolved r
LEFT JOIN pg_proc p ON p.oid=r.proc_oid
ORDER BY r.function_name;

-- 4) Retention triggers and private trigger-function grants.
SELECT t.tgname,n.nspname AS schema_name,c.relname AS table_name,t.tgenabled,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE NOT t.tgisinternal
  AND t.tgname IN ('hl_activity_log_retention_30d','hl_security_log_retention_30d')
ORDER BY t.tgname;

SELECT p.oid::regprocedure AS trigger_function,
       p.prosecdef AS security_definer,
       has_function_privilege('anon',p.oid,'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') AS service_role_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='private' AND p.proname='hl_prune_platform_logs_on_insert';

-- 5) Final pass/fail counters. A zero count means no missing object was found.
WITH checks AS (
  SELECT 'required private/public relations missing' AS check_name,
         count(*) AS failures
  FROM (VALUES
    ('private','hl_security_events'),('private','hl_activity_events'),('private','hl_security_ip_blocks'),
    ('private','hl_password_reset_ip_attempts'),('private','password_reset_request_log'),
    ('public','user_notification_channels'),('public','notification_link_tokens'),('public','hl_auth_sessions')
  ) v(schema_name,table_name)
  WHERE to_regclass(format('%I.%I',schema_name,table_name)) IS NULL
  UNION ALL
  SELECT 'Run35 RPC missing',count(*)
  FROM (VALUES
    ('public.hl_record_public_security_event_v2(text,text,text,inet,text,text,text,text)'),
    ('public.hl_check_auth_ip_block(inet)'),
    ('public.hl_consume_password_reset_ip_request(inet,text)'),
    ('public.platform_admin_list_activity_v2(uuid,text,timestamptz,timestamptz,integer,integer)'),
    ('public.platform_admin_get_security_overview_v2()'),
    ('public.platform_admin_list_security_events_v2(text,text,text,timestamptz,timestamptz,integer,integer)'),
    ('public.platform_admin_list_security_ip_blocks(text,integer,integer)'),
    ('public.platform_admin_list_telegram_connections(text,integer,integer)'),
    ('public.platform_admin_disconnect_telegram_user(uuid,text)'),
    ('public.platform_admin_list_active_sessions(text,integer,integer)'),
    ('public.platform_admin_revoke_active_session(uuid,text,text)')
  ) v(signature)
  WHERE to_regprocedure(signature) IS NULL
  UNION ALL
  SELECT '30-day retention trigger missing',2-count(*)
  FROM pg_trigger
  WHERE NOT tgisinternal AND tgname IN ('hl_activity_log_retention_30d','hl_security_log_retention_30d') AND tgenabled<>'D'
)
SELECT check_name,failures,CASE WHEN failures=0 THEN 'PASS' ELSE 'CHECK REQUIRED' END AS status
FROM checks
ORDER BY check_name;
