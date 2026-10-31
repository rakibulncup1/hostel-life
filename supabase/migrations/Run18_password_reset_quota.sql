-- Hostel Life — Password Reset Request Quota
-- Additive migration only. Does not alter auth.users, profiles, passwords,
-- existing Auth triggers, existing business tables, or existing RPC definitions.
--
-- Policy (Asia/Dhaka calendar): maximum 1 accepted reset request per day and
-- maximum 3 accepted reset requests per calendar month, per normalized email.
-- Only a keyed HMAC fingerprint is stored; raw email/password are never stored.
-- The service-role-only RPC is intended to be called by the request-password-reset
-- Edge Function. Do not call it from the browser.
--
-- Apply once after the existing Hostel Life migrations. Back up the database first.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.password_reset_request_log (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  email_fingerprint text NOT NULL
    CHECK (email_fingerprint ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

COMMENT ON TABLE private.password_reset_request_log IS
  'Short-retention, HMAC-only log for app-mediated Hostel Life password recovery quota. No raw email or password is stored.';

CREATE INDEX IF NOT EXISTS password_reset_request_log_email_time_idx
  ON private.password_reset_request_log (email_fingerprint, requested_at DESC);

CREATE INDEX IF NOT EXISTS password_reset_request_log_time_idx
  ON private.password_reset_request_log (requested_at);

ALTER TABLE private.password_reset_request_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.password_reset_request_log FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_password_reset_quota(
  p_email_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_local_now timestamp without time zone;
  v_day_start timestamptz;
  v_month_start timestamptz;
  v_next_day timestamptz;
  v_next_month timestamptz;
  v_daily_used integer := 0;
  v_monthly_used integer := 0;
  v_request_id uuid;
BEGIN
  IF p_email_fingerprint IS NULL
     OR p_email_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Invalid password reset fingerprint.';
  END IF;

  -- Serialize requests for the same email fingerprint. This prevents two
  -- simultaneous requests from both passing the same daily/monthly quota.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hostel-life-password-reset:' || p_email_fingerprint, 0)
  );

  -- Opportunistic global cleanup. It is transaction-scoped and non-blocking;
  -- expired rows older than 35 days do not affect current calendar quotas.
  IF pg_catalog.pg_try_advisory_xact_lock(20261031, 771001) THEN
    DELETE FROM private.password_reset_request_log
    WHERE requested_at < v_now - INTERVAL '35 days';
  END IF;

  v_local_now := v_now AT TIME ZONE 'Asia/Dhaka';
  v_day_start := pg_catalog.date_trunc('day', v_local_now) AT TIME ZONE 'Asia/Dhaka';
  v_month_start := pg_catalog.date_trunc('month', v_local_now) AT TIME ZONE 'Asia/Dhaka';
  v_next_day := (pg_catalog.date_trunc('day', v_local_now) + INTERVAL '1 day') AT TIME ZONE 'Asia/Dhaka';
  v_next_month := (pg_catalog.date_trunc('month', v_local_now) + INTERVAL '1 month') AT TIME ZONE 'Asia/Dhaka';

  SELECT
    pg_catalog.count(*) FILTER (WHERE requested_at >= v_day_start)::integer,
    pg_catalog.count(*)::integer
  INTO v_daily_used, v_monthly_used
  FROM private.password_reset_request_log
  WHERE email_fingerprint = p_email_fingerprint
    AND requested_at >= v_month_start;

  IF v_monthly_used >= 3 THEN
    RETURN pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'monthly_limit',
      'daily_limit', 1,
      'monthly_limit', 3,
      'daily_used', v_daily_used,
      'monthly_used', v_monthly_used,
      'daily_remaining', 0,
      'monthly_remaining', 0,
      'retry_at', v_next_month
    );
  END IF;

  IF v_daily_used >= 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'daily_limit',
      'daily_limit', 1,
      'monthly_limit', 3,
      'daily_used', v_daily_used,
      'monthly_used', v_monthly_used,
      'daily_remaining', 0,
      'monthly_remaining', GREATEST(0, 3 - v_monthly_used),
      'retry_at', v_next_day
    );
  END IF;

  INSERT INTO private.password_reset_request_log (email_fingerprint, requested_at)
  VALUES (p_email_fingerprint, v_now)
  RETURNING id INTO v_request_id;

  RETURN pg_catalog.jsonb_build_object(
    'allowed', true,
    'request_id', v_request_id,
    'daily_limit', 1,
    'monthly_limit', 3,
    'daily_used', v_daily_used + 1,
    'monthly_used', v_monthly_used + 1,
    'daily_remaining', 0,
    'monthly_remaining', GREATEST(0, 2 - v_monthly_used)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_password_reset_quota(
  p_request_id uuid,
  p_email_fingerprint text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF p_request_id IS NULL
     OR p_email_fingerprint IS NULL
     OR p_email_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;

  DELETE FROM private.password_reset_request_log
  WHERE id = p_request_id
    AND email_fingerprint = p_email_fingerprint
    AND requested_at >= pg_catalog.clock_timestamp() - INTERVAL '10 minutes';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_password_reset_quota(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_password_reset_quota(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_password_reset_quota(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_password_reset_quota(uuid, text) TO service_role;

-- Read-only verification after applying this migration:
-- SELECT to_regclass('private.password_reset_request_log') AS quota_table,
--        has_function_privilege('anon', 'public.consume_password_reset_quota(text)', 'EXECUTE') AS anon_can_consume,
--        has_function_privilege('authenticated', 'public.consume_password_reset_quota(text)', 'EXECUTE') AS user_can_consume,
--        has_function_privilege('service_role', 'public.consume_password_reset_quota(text)', 'EXECUTE') AS service_role_can_consume;
-- Expected: table present, anon=false, authenticated=false, service_role=true.
