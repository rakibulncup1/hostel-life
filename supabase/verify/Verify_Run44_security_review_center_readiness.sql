-- Read-only verification for Run44 Security Review Center.
-- Does not expose raw email addresses or full IP values and performs no writes.

WITH function_checks AS (
  SELECT 'AAL2 Super Admin guard' AS check_name,
    CASE WHEN to_regprocedure('private.is_super_admin()') IS NOT NULL
      AND position('aal2' in lower(pg_get_functiondef(to_regprocedure('private.is_super_admin()')))) > 0
      THEN 'PASS' ELSE 'FAIL' END AS status,
    'private.is_super_admin() must require JWT aal2' AS details
  UNION ALL SELECT '30-day Security Analytics RPC',
    CASE WHEN to_regprocedure('public.platform_admin_get_security_analytics_30d()') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'Super Admin review endpoint'
  UNION ALL SELECT 'Manual IP Block RPC',
    CASE WHEN to_regprocedure('public.platform_admin_add_security_ip_block(text,text,integer,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'Single-host IPv4/IPv6 temporary deny-list'
  UNION ALL SELECT 'IP Unblock RPC',
    CASE WHEN to_regprocedure('public.platform_admin_release_security_ip_block(text,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'Manual unblocking endpoint'
  UNION ALL SELECT 'IP Block directory RPC',
    CASE WHEN to_regprocedure('public.platform_admin_list_security_ip_blocks(text,integer,integer)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'Returns coarse country/city/region and active block status'
  UNION ALL SELECT 'Run39 Email capture column',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='attempt_email') THEN 'PASS' ELSE 'FAIL' END,
    'Attempt Email is stored only in the private security event table'
  UNION ALL SELECT '30-day cleanup function',
    CASE WHEN to_regprocedure('private.hl_prune_platform_logs()') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'Run37 retention cleanup function'
  UNION ALL SELECT 'Auth IP block checker',
    CASE WHEN to_regprocedure('public.hl_check_auth_ip_block(inet)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'Server-side auth gate checker'
)
SELECT check_name,status,details FROM function_checks ORDER BY check_name;

SELECT
  'hostel-life-platform-log-retention-30d' AS job_name,
  CASE WHEN EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname='hostel-life-platform-log-retention-30d' AND j.active)
    THEN 'PASS' ELSE 'FAIL' END AS status,
  (SELECT j.schedule FROM cron.job j WHERE j.jobname='hostel-life-platform-log-retention-30d' AND j.active ORDER BY j.jobid DESC LIMIT 1) AS schedule;

SELECT
  count(*) FILTER (WHERE created_at >= now()-interval '30 days') AS security_events_last_30d,
  count(*) FILTER (WHERE created_at >= now()-interval '30 days' AND attempt_email IS NOT NULL) AS events_with_attempt_email,
  count(*) FILTER (WHERE created_at >= now()-interval '30 days' AND ip_address IS NOT NULL) AS events_with_ip,
  count(*) FILTER (WHERE created_at >= now()-interval '30 days' AND country_code IS NOT NULL) AS events_with_country,
  count(*) FILTER (WHERE created_at >= now()-interval '30 days' AND (city IS NOT NULL OR region IS NOT NULL)) AS events_with_city_or_region,
  count(*) FILTER (WHERE created_at >= now()-interval '30 days' AND ip_address IS NULL) AS events_without_ip,
  count(*) FILTER (WHERE created_at >= now()-interval '30 days' AND attempt_email IS NULL) AS events_without_attempt_email,
  min(created_at) FILTER (WHERE created_at >= now()-interval '30 days') AS oldest_event_in_window,
  max(created_at) FILTER (WHERE created_at >= now()-interval '30 days') AS newest_event_in_window
FROM private.hl_security_events;

SELECT
  scope,
  count(*) FILTER (WHERE blocked_until > now()) AS active_blocks,
  count(*) FILTER (WHERE blocked_until <= now() AND blocked_until >= now()-interval '30 days') AS expired_blocks_within_retention
FROM private.hl_security_ip_blocks
GROUP BY scope
ORDER BY scope;

-- Data safety note: this check intentionally returns only counts, never raw emails or IP addresses.


-- Signup OTP telemetry readiness (no data writes).
SELECT
  to_regprocedure('public.hl_consume_signup_otp_resend(text,text,inet,text,text,text,text,text,text)') IS NOT NULL AS signup_otp_writer_ready,
  to_regprocedure('public.hl_signup_otp_writer_health_v1()') IS NOT NULL AS signup_otp_health_rpc_ready,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='attempt_email') AS attempt_email_column_ready,
  EXISTS (SELECT 1 FROM cron.job WHERE jobname='hostel-life-platform-log-retention-30d' AND active) AS retention_job_active;


SELECT
  CASE WHEN position('updated_at < v_now - interval' in pg_get_functiondef('private.hl_prune_platform_logs()'::regprocedure)) > 0
         AND position('blocked_until <= v_now' in pg_get_functiondef('private.hl_prune_platform_logs()'::regprocedure)) > 0
    THEN 'PASS' ELSE 'FAIL' END AS ip_block_retention_policy;

SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_ip_blocks' AND column_name='city') AS ip_block_city_ready,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_ip_blocks' AND column_name='region') AS ip_block_region_ready,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_ip_blocks' AND column_name='region_code') AS ip_block_region_code_ready,
  to_regprocedure('public.platform_admin_list_security_ip_blocks(text,integer,integer)') IS NOT NULL AS ip_block_list_rpc_ready;

-- Read-only check that both manual IP RPCs contain the corrected host-only mask validation.
WITH expected(function_name, signature) AS (
  VALUES
    ('platform_admin_add_security_ip_block', 'public.platform_admin_add_security_ip_block(text,text,integer,text)'::regprocedure),
    ('platform_admin_release_security_ip_block', 'public.platform_admin_release_security_ip_block(text,text)'::regprocedure)
), defs AS (
  SELECT function_name, pg_get_functiondef(signature::oid) AS definition
  FROM expected
)
SELECT function_name,
  CASE WHEN position('family(v_ip) = 4' IN definition) > 0
          AND position('masklen(v_ip) <> 32' IN definition) > 0
          AND position('family(v_ip) = 6' IN definition) > 0
          AND position('masklen(v_ip) <> 128' IN definition) > 0
       THEN 'PASS' ELSE 'FAIL' END AS status,
  'IPv4 /32 and IPv6 /128 host-only validation is installed' AS details
FROM defs
ORDER BY function_name;
