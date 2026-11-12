-- Run47 read-only verification: app-managed session IP/browser retention.
-- No data is changed by this verification query.
WITH expected_triggers AS (
  SELECT 'private.hl_login_sessions'::text AS table_name,
         'hl_login_sessions_metadata_retention'::text AS trigger_name
  UNION ALL
  SELECT 'private.hl_user_presence', 'hl_user_presence_metadata_retention'
), trigger_state AS (
  SELECT e.table_name, e.trigger_name,
         EXISTS (
           SELECT 1
           FROM pg_catalog.pg_trigger t
           JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
           JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname || '.' || c.relname=e.table_name
             AND t.tgname=e.trigger_name AND NOT t.tgisinternal
         ) AS installed
  FROM expected_triggers e
), stale_session_rows AS (
  SELECT count(*)::bigint AS count
  FROM private.hl_login_sessions
  WHERE logged_in_at < now()-interval '30 days'
    AND (ip_address IS NOT NULL OR user_agent IS NOT NULL)
), stale_presence_rows AS (
  SELECT count(*)::bigint AS count
  FROM private.hl_user_presence
  WHERE last_login_at < now()-interval '30 days'
    AND (last_login_ip IS NOT NULL OR last_user_agent IS NOT NULL)
)
SELECT 'trigger:' || table_name || '.' || trigger_name AS check_name,
       CASE WHEN installed THEN 'PASS' ELSE 'FAIL' END AS result
FROM trigger_state
UNION ALL
SELECT 'stale_login_session_metadata', CASE WHEN count=0 THEN 'PASS' ELSE 'FAIL: '||count::text END FROM stale_session_rows
UNION ALL
SELECT 'stale_presence_metadata', CASE WHEN count=0 THEN 'PASS' ELSE 'FAIL: '||count::text END FROM stale_presence_rows
UNION ALL
SELECT 'cleanup_function', CASE WHEN to_regprocedure('private.hl_prune_platform_logs()') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END;
