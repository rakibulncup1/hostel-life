-- READ ONLY — Hostel Life final database clearance: Run34 + Run35 + Run36 + Run37 security hardening.
-- Run only AFTER Run37_final_operational_database_completion.sql succeeds.
-- No DDL, DML, GRANT/REVOKE, extension changes, job changes, or data updates.
WITH checks(section, item, passed, detail) AS (
  -- Run34
  SELECT 'Run34','database runtime health RPC exists',
         to_regprocedure('public.platform_admin_get_database_runtime_health()') IS NOT NULL,
         'public.platform_admin_get_database_runtime_health()'
  UNION ALL SELECT 'Run34','audit list RPC exists',
         to_regprocedure('public.platform_admin_list_audit_logs(integer,integer,text,text,text)') IS NOT NULL,
         'original signature preserved'
  UNION ALL SELECT 'Run34','runtime health SECURITY DEFINER + STABLE',
         COALESCE((SELECT prosecdef AND provolatile='s' FROM pg_proc WHERE oid=to_regprocedure('public.platform_admin_get_database_runtime_health()')::oid),false),
         'read-only Super Admin RPC'
  UNION ALL SELECT 'Run34','runtime health authenticated-only',
         COALESCE((SELECT has_function_privilege('authenticated',oid,'EXECUTE')
                    AND NOT has_function_privilege('anon',oid,'EXECUTE')
                    AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
                   FROM pg_proc WHERE oid=to_regprocedure('public.platform_admin_get_database_runtime_health()')::oid),false),
         'authenticated can execute; anon/PUBLIC cannot'
  UNION ALL SELECT 'Run34','audit list authenticated-only',
         COALESCE((SELECT has_function_privilege('authenticated',oid,'EXECUTE')
                    AND NOT has_function_privilege('anon',oid,'EXECUTE')
                    AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
                   FROM pg_proc WHERE oid=to_regprocedure('public.platform_admin_list_audit_logs(integer,integer,text,text,text)')::oid),false),
         'authenticated can execute; anon/PUBLIC cannot'

  -- Run35 private tables, core RPCs and retention triggers
  UNION ALL SELECT 'Run35','security events table RLS',
         COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('private.hl_security_events')),false),'RLS enabled'
  UNION ALL SELECT 'Run35','activity events table RLS',
         COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('private.hl_activity_events')),false),'RLS enabled'
  UNION ALL SELECT 'Run35','security IP blocks table RLS',
         COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('private.hl_security_ip_blocks')),false),'RLS enabled'
  UNION ALL SELECT 'Run35','password reset IP attempts table RLS',
         COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('private.hl_password_reset_ip_attempts')),false),'RLS enabled'
  UNION ALL SELECT 'Run35','password reset quota log table RLS',
         COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('private.password_reset_request_log')),false),'RLS enabled'
  UNION ALL SELECT 'Run35','auth.sessions.not_after exists',
         EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='sessions' AND column_name='not_after' AND data_type='timestamp with time zone'),
         'needed for targeted session revoke'
  UNION ALL SELECT 'Run35','service-role security event writer v2 exists',
         to_regprocedure('public.hl_record_public_security_event_v2(text,text,text,inet,text,text,text,text)') IS NOT NULL,'server-side ingestion RPC'
  UNION ALL SELECT 'Run35','Activity Timeline RPC exists',
         to_regprocedure('public.platform_admin_list_activity_v2(uuid,text,timestamptz,timestamptz,integer,integer)') IS NOT NULL,'authenticated Super Admin reader'
  UNION ALL SELECT 'Run35','Security overview RPC exists',
         to_regprocedure('public.platform_admin_get_security_overview_v2()') IS NOT NULL,'authenticated Super Admin reader'
  UNION ALL SELECT 'Run35','Security event reader v2 exists',
         to_regprocedure('public.platform_admin_list_security_events_v2(text,text,text,timestamptz,timestamptz,integer,integer)') IS NOT NULL,'legacy reader retained for compatibility'
  UNION ALL SELECT 'Run35','Telegram directory + disconnect RPCs exist',
         to_regprocedure('public.platform_admin_list_telegram_connections(text,integer,integer)') IS NOT NULL
         AND to_regprocedure('public.platform_admin_disconnect_telegram_user(uuid,text)') IS NOT NULL,
         'Super Admin management functions'
  UNION ALL SELECT 'Run35','active session list + revoke RPCs exist',
         to_regprocedure('public.platform_admin_list_active_sessions(text,integer,integer)') IS NOT NULL
         AND to_regprocedure('public.platform_admin_revoke_active_session(uuid,text,text)') IS NOT NULL,
         'session inventory and targeted revoke'
  UNION ALL SELECT 'Run35/37','per-insert cleanup triggers removed after scheduling',
         NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('hl_activity_log_retention_30d','hl_security_log_retention_30d'))
         AND to_regprocedure('private.hl_prune_platform_logs_on_insert()') IS NULL,
         'daily Cron now performs cleanup; event writes no longer launch full-table DELETE sweeps'

  -- Run36 geo columns and RPCs
  UNION ALL SELECT 'Run36','City/Region columns on all three tables',
         (SELECT count(*)=9 FROM information_schema.columns WHERE
           (table_schema='private' AND table_name='hl_security_events' AND column_name IN ('city','region','region_code')) OR
           (table_schema='private' AND table_name='hl_security_ip_blocks' AND column_name IN ('city','region','region_code')) OR
           (table_schema='private' AND table_name='hl_password_reset_ip_attempts' AND column_name IN ('city','region','region_code'))),
         'nine nullable text columns'
  UNION ALL SELECT 'Run36','geo-aware security event writer exists',
         to_regprocedure('public.hl_record_public_security_event_v3(text,text,text,inet,text,text,text,text,text,text,text)') IS NOT NULL,
         'service_role-only writer'
  UNION ALL SELECT 'Run36','geo-aware password reset IP limiter exists',
         to_regprocedure('public.hl_consume_password_reset_ip_request_v2(inet,text,text,text,text)') IS NOT NULL,
         'service_role-only limiter'
  UNION ALL SELECT 'Run36','geo-aware Security Monitor reader exists',
         to_regprocedure('public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer)') IS NOT NULL,
         'authenticated Super Admin reader'
  UNION ALL SELECT 'Run36','geo writer service_role-only',
         COALESCE((SELECT has_function_privilege('service_role',oid,'EXECUTE')
                    AND NOT has_function_privilege('authenticated',oid,'EXECUTE')
                    AND NOT has_function_privilege('anon',oid,'EXECUTE')
                    AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
                   FROM pg_proc WHERE oid=to_regprocedure('public.hl_record_public_security_event_v3(text,text,text,inet,text,text,text,text,text,text,text)')::oid),false),
         'service_role only; anon/authenticated/PUBLIC denied'
  UNION ALL SELECT 'Run36','geo reader authenticated-only',
         COALESCE((SELECT has_function_privilege('authenticated',oid,'EXECUTE')
                    AND NOT has_function_privilege('anon',oid,'EXECUTE')
                    AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
                   FROM pg_proc WHERE oid=to_regprocedure('public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer)')::oid),false),
         'authenticated only; anon/PUBLIC denied'

  -- Run37 operational retention and Cron scheduling
  UNION ALL SELECT 'Run37','maintenance cleanup function exists and SECURITY DEFINER',
         COALESCE((SELECT prosecdef FROM pg_proc WHERE oid=to_regprocedure('private.hl_prune_platform_logs()')::oid),false),
         'private maintenance function'
  UNION ALL SELECT 'Run37','cleanup function has empty search_path',
         COALESCE((SELECT coalesce(proconfig,ARRAY[]::text[]) @> ARRAY['search_path=""']::text[]
                   FROM pg_proc WHERE oid=to_regprocedure('private.hl_prune_platform_logs()')::oid),false),
         'search_path is pinned empty'
  UNION ALL SELECT 'Run37','daily 30-day operational cleanup job active',
         EXISTS(SELECT 1 FROM cron.job WHERE jobname='hostel-life-platform-log-retention-30d' AND active
           AND schedule=CASE WHEN lower(coalesce(nullif(current_setting('cron.timezone',true),''),'GMT')) IN ('utc','gmt','etc/utc','etc/gmt') THEN '15 21 * * *'
                             WHEN lower(coalesce(nullif(current_setting('cron.timezone',true),''),'GMT')) IN ('asia/dhaka','asia/dacca') THEN '15 3 * * *' ELSE '' END),
         '03:15 Asia/Dhaka daily; checks the active cron.timezone'
  UNION ALL SELECT 'Run37','daily 7-day Cron history cleanup job active',
         EXISTS(SELECT 1 FROM cron.job WHERE jobname='hostel-life-cron-history-retention-7d' AND active
           AND schedule=CASE WHEN lower(coalesce(nullif(current_setting('cron.timezone',true),''),'GMT')) IN ('utc','gmt','etc/utc','etc/gmt') THEN '45 21 * * *'
                             WHEN lower(coalesce(nullif(current_setting('cron.timezone',true),''),'GMT')) IN ('asia/dhaka','asia/dacca') THEN '45 3 * * *' ELSE '' END),
         '03:45 Asia/Dhaka daily; checks the active cron.timezone'
  UNION ALL SELECT 'Run37','cleanup function uses one global advisory lock',
         COALESCE((SELECT position('728194650175' in pg_get_functiondef(oid))>0 FROM pg_proc WHERE oid=to_regprocedure('private.hl_prune_platform_logs()')::oid),false),
         'prevents overlapping scheduled maintenance runs'
  UNION ALL SELECT 'Run37','expired signed-Worker nonces are pruned',
         COALESCE((SELECT position('hl_geo_proxy_nonces' in pg_get_functiondef(oid))>0 FROM pg_proc WHERE oid=to_regprocedure('private.hl_prune_platform_logs()')::oid),false),
         'daily cleanup deletes expired replay-protection nonces'
  UNION ALL SELECT 'Run37','geo nonce table exists with RLS and no client grants',
         to_regclass('private.hl_geo_proxy_nonces') IS NOT NULL
         AND COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('private.hl_geo_proxy_nonces')),false)
         AND NOT has_table_privilege('anon','private.hl_geo_proxy_nonces','SELECT')
         AND NOT has_table_privilege('authenticated','private.hl_geo_proxy_nonces','SELECT')
         AND NOT has_table_privilege('service_role','private.hl_geo_proxy_nonces','SELECT'),
         'private nonce storage is inaccessible to API roles'
  UNION ALL SELECT 'Run37','geo nonce RPC is service-role-only',
         COALESCE((SELECT prosecdef AND has_function_privilege('service_role',oid,'EXECUTE')
                    AND NOT has_function_privilege('authenticated',oid,'EXECUTE')
                    AND NOT has_function_privilege('anon',oid,'EXECUTE')
                    AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
                   FROM pg_proc WHERE oid=to_regprocedure('public.hl_consume_geo_proxy_nonce(uuid,timestamptz)')::oid),false),
         'atomic single-use nonce insert; service role only'
  UNION ALL SELECT 'Run37','active Auth session validator is service-role-only',
         COALESCE((SELECT prosecdef AND has_function_privilege('service_role',oid,'EXECUTE')
                    AND NOT has_function_privilege('authenticated',oid,'EXECUTE')
                    AND NOT has_function_privilege('anon',oid,'EXECUTE')
                    AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
                   FROM pg_proc WHERE oid=to_regprocedure('public.hl_is_auth_session_active_for_security_event(uuid,uuid)')::oid),false),
         'verified login_success telemetry checks auth.sessions id/user/not_after'
  UNION ALL SELECT 'Run37','cleanup function cannot execute from client roles',
         COALESCE((SELECT NOT has_function_privilege('anon',oid,'EXECUTE')
                    AND NOT has_function_privilege('authenticated',oid,'EXECUTE')
                    AND NOT has_function_privilege('service_role',oid,'EXECUTE')
                    AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
                   FROM pg_proc WHERE oid=to_regprocedure('private.hl_prune_platform_logs()')::oid),false),
         'owner/Cron scheduler only'
), result_rows AS (
  SELECT section,item,CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS status,detail
  FROM checks
  UNION ALL
  SELECT 'SUMMARY',
         count(*) FILTER (WHERE passed)::text||' passed / '||count(*) FILTER (WHERE NOT passed)::text||' failed',
         CASE WHEN count(*) FILTER (WHERE NOT passed)=0 THEN 'PASS' ELSE 'CHECK REQUIRED' END,
         'Read-only only. No database objects or records changed. Review each failure before release.'
  FROM checks
)
SELECT * FROM result_rows ORDER BY section,item;
