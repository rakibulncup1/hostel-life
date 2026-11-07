-- Hostel Life — Run37: final operational cleanup + signed Worker replay protection.
-- Transactional, repeatable completion migration. Requires pg_cron enabled in Dashboard first.
-- Run only after Run35 and Run36 have succeeded and a verified backup exists.
-- Canonical public.platform_audit_log is retained separately; its row-level
-- Activity mirror makes automatic deletion unsafe here.
-- This migration also removes the old Run35 per-INSERT cleanup triggers only
-- after both daily Cron jobs have been scheduled successfully.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $run37_preflight$
DECLARE
  v_column record;
  v_cron_timezone text;
BEGIN
  IF to_regclass('cron.job') IS NULL
     OR to_regclass('cron.job_run_details') IS NULL
     OR to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Run37 stopped: enable pg_cron in Supabase Dashboard → Integrations → Cron, then rerun this SQL. No changes were committed.';
  END IF;

  v_cron_timezone := lower(coalesce(nullif(current_setting('cron.timezone', true), ''), 'GMT'));
  IF v_cron_timezone NOT IN ('utc','gmt','etc/utc','etc/gmt','asia/dhaka','asia/dacca') THEN
    RAISE EXCEPTION 'Run37 stopped: unsupported cron.timezone (%). Set pg_cron timezone to UTC or Asia/Dhaka, then review existing Cron jobs before retrying. No changes were committed.', v_cron_timezone;
  END IF;

  IF to_regclass('private.hl_activity_events') IS NULL
     OR to_regclass('private.hl_security_events') IS NULL
     OR to_regclass('private.hl_security_ip_blocks') IS NULL
     OR to_regclass('private.hl_password_reset_ip_attempts') IS NULL
     OR to_regclass('private.password_reset_request_log') IS NULL
     OR to_regclass('auth.sessions') IS NULL THEN
    RAISE EXCEPTION 'Run37 stopped: a Run35 retention/Auth session table is missing. No changes were committed.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='sessions' AND column_name='id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='sessions' AND column_name='user_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='sessions' AND column_name='not_after' AND data_type='timestamp with time zone') THEN
    RAISE EXCEPTION 'Run37 stopped: auth.sessions id/user_id/not_after schema is not compatible. No changes were committed.';
  END IF;

  -- The Run35 cleanup trigger may only be removed if it is attached to the two
  -- known operational log tables. Do not remove any unrelated custom trigger.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
    WHERE NOT t.tgisinternal
      AND p.proname='hl_prune_platform_logs_on_insert'
      AND NOT ((n.nspname='private' AND c.relname='hl_activity_events' AND t.tgname='hl_activity_log_retention_30d')
           OR (n.nspname='private' AND c.relname='hl_security_events' AND t.tgname='hl_security_log_retention_30d'))
  ) THEN
    RAISE EXCEPTION 'Run37 stopped: the Run35 cleanup trigger function is attached to an unexpected table. No changes were committed.';
  END IF;

  FOR v_column IN
    SELECT * FROM (VALUES
      ('private','hl_activity_events','created_at'),
      ('private','hl_security_events','created_at'),
      ('private','hl_security_ip_blocks','blocked_until'),
      ('private','hl_password_reset_ip_attempts','requested_at'),
      ('private','password_reset_request_log','requested_at')
    ) AS required(schema_name,table_name,column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema=v_column.schema_name
        AND c.table_name=v_column.table_name
        AND c.column_name=v_column.column_name
        AND c.data_type='timestamp with time zone'
    ) THEN
      RAISE EXCEPTION 'Run37 stopped: required timestamp column %.%.% is missing or has an unexpected type. No changes were committed.',
        v_column.schema_name,v_column.table_name,v_column.column_name;
    END IF;
  END LOOP;
END;
$run37_preflight$;

-- One-time nonce storage makes a valid Cloudflare HMAC request single-use.
-- The Worker timestamp window is short; the daily job prunes expired nonce rows.
CREATE TABLE IF NOT EXISTS private.hl_geo_proxy_nonces (
  nonce uuid PRIMARY KEY,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT hl_geo_proxy_nonces_expiry_check CHECK (expires_at > issued_at)
);
CREATE INDEX IF NOT EXISTS hl_geo_proxy_nonces_expiry_idx
  ON private.hl_geo_proxy_nonces(expires_at);
ALTER TABLE private.hl_geo_proxy_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.hl_geo_proxy_nonces FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.hl_consume_geo_proxy_nonce(
  p_nonce uuid,
  p_issued_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_inserted integer := 0;
BEGIN
  IF p_nonce IS NULL OR p_issued_at IS NULL
     OR p_issued_at < v_now - interval '2 minutes'
     OR p_issued_at > v_now + interval '2 minutes' THEN
    RETURN false;
  END IF;
  INSERT INTO private.hl_geo_proxy_nonces(nonce,issued_at,expires_at)
  VALUES(p_nonce,p_issued_at,p_issued_at+interval '5 minutes')
  ON CONFLICT(nonce) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted=1;
END;
$function$;
REVOKE ALL ON FUNCTION public.hl_consume_geo_proxy_nonce(uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hl_consume_geo_proxy_nonce(uuid,timestamptz) TO service_role;

-- Only a verified user JWT can be used by the telemetry Edge Function to
-- record login_success. The function checks that its signed session_id still
-- exists and has not been revoked/expired in Supabase Auth.
CREATE OR REPLACE FUNCTION public.hl_is_auth_session_active_for_security_event(
  p_user_id uuid,
  p_session_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT NULL AND p_session_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM auth.sessions s
    WHERE s.id=p_session_id
      AND s.user_id=p_user_id
      AND (s.not_after IS NULL OR s.not_after>pg_catalog.statement_timestamp())
  );
$function$;
REVOKE ALL ON FUNCTION public.hl_is_auth_session_active_for_security_event(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hl_is_auth_session_active_for_security_event(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.hl_prune_platform_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_activity bigint := 0;
  v_security bigint := 0;
  v_blocks bigint := 0;
  v_reset_ip bigint := 0;
  v_reset_quota bigint := 0;
  v_geo_nonces bigint := 0;
BEGIN
  -- A single global transaction lock prevents overlapping maintenance runs.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(728194650175::bigint) THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok',true,'skipped',true,'reason','cleanup_already_running','ran_at',v_now,
      'activity_deleted',0,'security_deleted',0,'expired_blocks_deleted',0,
      'password_reset_ip_attempts_deleted',0,'password_reset_quota_rows_deleted',0
    );
  END IF;

  DELETE FROM private.hl_activity_events
  WHERE created_at < v_now - interval '30 days';
  GET DIAGNOSTICS v_activity = ROW_COUNT;

  DELETE FROM private.hl_security_events
  WHERE created_at < v_now - interval '30 days';
  GET DIAGNOSTICS v_security = ROW_COUNT;

  DELETE FROM private.hl_security_ip_blocks
  WHERE blocked_until < v_now - interval '30 days';
  GET DIAGNOSTICS v_blocks = ROW_COUNT;

  DELETE FROM private.hl_password_reset_ip_attempts
  WHERE requested_at < v_now - interval '48 hours';
  GET DIAGNOSTICS v_reset_ip = ROW_COUNT;

  -- Preserve enough HMAC-only quota history to enforce the 5-per-calendar-month rule.
  DELETE FROM private.password_reset_request_log
  WHERE requested_at < v_now - interval '35 days';
  GET DIAGNOSTICS v_reset_quota = ROW_COUNT;

  DELETE FROM private.hl_geo_proxy_nonces
  WHERE expires_at < v_now;
  GET DIAGNOSTICS v_geo_nonces = ROW_COUNT;

  -- The canonical public.platform_audit_log is not pruned here: Run27 mirrors
  -- row-level DELETEs back into Activity events. Keep this critical audit trail
  -- separately until an archival design can preserve that linkage safely.

  RETURN pg_catalog.jsonb_build_object(
    'ok',true,'skipped',false,'ran_at',v_now,
    'activity_deleted',v_activity,
    'security_deleted',v_security,
    'expired_blocks_deleted',v_blocks,
    'password_reset_ip_attempts_deleted',v_reset_ip,
    'password_reset_quota_rows_deleted',v_reset_quota,
    'expired_geo_proxy_nonces_deleted',v_geo_nonces,
    'retention_days',30,
    'platform_audit_log_retained_separately',true
  );
END;
$function$;

-- Schedule/update the same two named jobs inside this transaction. The local
-- clock values are selected from cron.timezone; no global timezone is changed.
-- Re-running this script updates these names instead of creating duplicates.
DO $run37_schedule$
DECLARE
  v_cron_timezone text := lower(coalesce(nullif(current_setting('cron.timezone', true), ''), 'GMT'));
  v_log_schedule text;
  v_history_schedule text;
BEGIN
  IF v_cron_timezone IN ('utc','gmt','etc/utc','etc/gmt') THEN
    v_log_schedule := '15 21 * * *';       -- 03:15 Asia/Dhaka
    v_history_schedule := '45 21 * * *';   -- 03:45 Asia/Dhaka
  ELSIF v_cron_timezone IN ('asia/dhaka','asia/dacca') THEN
    v_log_schedule := '15 3 * * *';        -- 03:15 Asia/Dhaka
    v_history_schedule := '45 3 * * *';    -- 03:45 Asia/Dhaka
  ELSE
    RAISE EXCEPTION 'Run37 stopped: cron.timezone changed after preflight. No changes were committed.';
  END IF;

  PERFORM cron.schedule(
    'hostel-life-platform-log-retention-30d',
    v_log_schedule,
    'SELECT private.hl_prune_platform_logs();'
  );

  PERFORM cron.schedule(
    'hostel-life-cron-history-retention-7d',
    v_history_schedule,
    $command$DELETE FROM cron.job_run_details
      WHERE jobid IN (
        SELECT jobid FROM cron.job
        WHERE jobname IN (
          'hostel-life-platform-log-retention-30d',
          'hostel-life-cron-history-retention-7d'
        )
      )
      AND end_time < now() - interval '7 days';$command$
  );
END;
$run37_schedule$;

-- Scheduled cleanup now replaces the expensive per-event full-table sweeps
-- installed by Run35. Drop only those two exact triggers, then their now-unused
-- trigger function. This happens after both jobs are accepted by pg_cron.
DROP TRIGGER IF EXISTS hl_activity_log_retention_30d ON private.hl_activity_events;
DROP TRIGGER IF EXISTS hl_security_log_retention_30d ON private.hl_security_events;
DROP FUNCTION IF EXISTS private.hl_prune_platform_logs_on_insert();

-- The routine is an internal maintenance function. SQL Editor/cron owner can
-- invoke it; no client role or service_role receives execute permission.
REVOKE ALL ON FUNCTION private.hl_prune_platform_logs() FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Then run supabase/verify/Verify_Final_Database_Clearance.sql (read-only).
-- This migration does not install pg_cron; enable it once in the Dashboard before running this file.
-- The direct-to-Supabase Worker fallback stores Country only. City/Region are
-- stored only when the Cloudflare Worker HMAC is verified and its nonce is unused.
