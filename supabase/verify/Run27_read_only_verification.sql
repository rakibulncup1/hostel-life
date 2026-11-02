-- V1.18 Run27: read-only post-migration verification. Safe for production.
SELECT 'presence_table' AS check_name, to_regclass('private.hl_user_presence') IS NOT NULL AS ok
UNION ALL SELECT 'activity_table', to_regclass('private.hl_activity_events') IS NOT NULL
UNION ALL SELECT 'login_sessions_table', to_regclass('private.hl_login_sessions') IS NOT NULL
UNION ALL SELECT 'security_table', to_regclass('private.hl_security_events') IS NOT NULL
UNION ALL SELECT 'presence_rpc', to_regprocedure('public.hl_touch_my_presence()') IS NOT NULL
UNION ALL SELECT 'login_rpc', to_regprocedure('public.hl_record_my_login()') IS NOT NULL
UNION ALL SELECT 'logout_rpc', to_regprocedure('public.hl_record_my_logout()') IS NOT NULL
UNION ALL SELECT 'global_logout_rpc', to_regprocedure('public.hl_record_my_global_logout()') IS NOT NULL
UNION ALL SELECT 'member_activity_rpc', to_regprocedure('public.platform_admin_list_member_activity(uuid,uuid,integer,integer)') IS NOT NULL
UNION ALL SELECT 'member_sessions_rpc', to_regprocedure('public.platform_admin_list_member_sessions(uuid,uuid,integer,integer)') IS NOT NULL
UNION ALL SELECT 'security_list_rpc', to_regprocedure('public.platform_admin_list_security_events(text,text,integer,integer)') IS NOT NULL;

SELECT event_object_table AS table_name, trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema='public' AND trigger_name='hl_activity_capture'
ORDER BY event_object_table,event_manipulation;

SELECT routine_schema,routine_name,privilege_type,grantee
FROM information_schema.routine_privileges
WHERE routine_name='hl_record_public_security_event'
ORDER BY grantee,privilege_type;


-- Existing RLS policies depend on authenticated retaining private schema USAGE.
SELECT 'private_schema_usage_preserved' AS check_name,
       has_schema_privilege('authenticated','private','USAGE') AS ok
UNION ALL
SELECT 'activity_table_not_directly_readable',
       NOT has_table_privilege('authenticated','private.hl_activity_events','SELECT')
UNION ALL
SELECT 'login_sessions_table_not_directly_readable',
       NOT has_table_privilege('authenticated','private.hl_login_sessions','SELECT')
UNION ALL
SELECT 'security_ingest_not_authenticated',
       NOT has_function_privilege('authenticated','public.hl_record_public_security_event(text,text,text,inet,text,text,text)','EXECUTE')
UNION ALL
SELECT 'security_ingest_service_role',
       has_function_privilege('service_role','public.hl_record_public_security_event(text,text,text,inet,text,text,text)','EXECUTE');


-- Profile edits must be captured without logging profile inserts/deletes.
SELECT 'profile_update_trigger_installed' AS check_name,
       EXISTS(SELECT 1 FROM information_schema.triggers
              WHERE trigger_schema='public' AND event_object_table='profiles'
                AND trigger_name='hl_activity_capture' AND event_manipulation='UPDATE') AS ok;


-- Global and local sign-out have distinct authenticated RPCs.
SELECT 'global_logout_rpc_authenticated' AS check_name,
       has_function_privilege('authenticated','public.hl_record_my_global_logout()','EXECUTE') AS ok
UNION ALL
SELECT 'global_logout_rpc_not_anon',
       NOT has_function_privilege('anon','public.hl_record_my_global_logout()','EXECUTE');

-- Confirm every server-side read endpoint exists and direct reads stay private.
SELECT 'global_activity_rpc' AS check_name,
       to_regprocedure('public.platform_admin_list_activity(uuid,text,integer,integer)') IS NOT NULL AS ok
UNION ALL
SELECT 'member_activity_overview_rpc',
       to_regprocedure('public.platform_admin_get_member_activity_overview(uuid,uuid)') IS NOT NULL
UNION ALL
SELECT 'security_overview_rpc',
       to_regprocedure('public.platform_admin_get_security_overview()') IS NOT NULL
UNION ALL
SELECT 'hostel_member_list_rpc_v3',
       to_regprocedure('public.platform_admin_list_hostel_members_v3(uuid)') IS NOT NULL
UNION ALL
SELECT 'service_role_cannot_select_activity_table',
       NOT has_table_privilege('service_role','private.hl_activity_events','SELECT')
UNION ALL
SELECT 'service_role_cannot_select_login_sessions',
       NOT has_table_privilege('service_role','private.hl_login_sessions','SELECT')
UNION ALL
SELECT 'service_role_cannot_select_security_events',
       NOT has_table_privilege('service_role','private.hl_security_events','SELECT')
UNION ALL
SELECT 'anon_cannot_execute_member_activity',
       NOT has_function_privilege('anon','public.platform_admin_list_member_activity(uuid,uuid,integer,integer)','EXECUTE')
UNION ALL
SELECT 'anon_cannot_execute_security_list',
       NOT has_function_privilege('anon','public.platform_admin_list_security_events(text,text,integer,integer)','EXECUTE');

-- Notification Activity is INSERT-only; no message body/title trigger copying.
SELECT 'notification_insert_trigger' AS check_name,
       EXISTS(SELECT 1 FROM information_schema.triggers
              WHERE trigger_schema='public' AND event_object_table='notifications'
                AND trigger_name='hl_activity_capture' AND event_manipulation='INSERT') AS ok;
