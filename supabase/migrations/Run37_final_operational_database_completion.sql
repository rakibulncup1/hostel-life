-- Hostel Life — Run37: deterministic operational-log retention routine.
-- Additive, transactional completion migration. Requires pg_cron enabled in Dashboard first.
-- Run only after Run35 and Run36 have succeeded and a verified backup exists.
-- Canonical public.platform_audit_log is retained separately; its row-level activity mirror makes automatic deletion unsafe here.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $run37_preflight$
DECLARE v_column record;
BEGIN
  IF to_regclass('cron.job') IS NULL
     OR to_regclass('cron.job_run_details') IS NULL
     OR to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Final completion stopped: enable pg_cron in Supabase Dashboard → Integrations → Cron, then rerun this SQL. No changes were committed.';
  END IF;

  IF to_regclass('private.hl_activity_events') IS NULL
     OR to_regclass('private.hl_security_events') IS NULL
     OR to_regclass('private.hl_security_ip_blocks') IS NULL
     OR to_regclass('private.hl_password_reset_ip_attempts') IS NULL
     OR to_regclass('private.password_reset_request_log') IS NULL THEN
    RAISE EXCEPTION 'Run37 stopped: a Run35 retention table is missing. No changes were committed.';
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
BEGIN
  -- A single global transaction lock prevents overlapping trigger and cron cleanup.
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
    'retention_days',30,
    'platform_audit_log_retained_separately',true
  );
END;
$function$;

-- Schedule/update the same two named jobs inside this transaction. Re-running
-- this script updates these names instead of creating duplicate jobs.
DO $run37_schedule$
BEGIN
  PERFORM cron.schedule(
    'hostel-life-platform-log-retention-30d',
    '15 21 * * *',
    'SELECT private.hl_prune_platform_logs();'
  );

  PERFORM cron.schedule(
    'hostel-life-cron-history-retention-7d',
    '45 21 * * *',
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

-- The routine is an internal maintenance function. SQL Editor/cron owner can
-- invoke it; no client role or service_role receives execute permission.
REVOKE ALL ON FUNCTION private.hl_prune_platform_logs() FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Then run supabase/verify/Verify_Final_Database_Clearance.sql (read-only).
-- This migration does not install pg_cron; enable it once in the Dashboard before running this file.
