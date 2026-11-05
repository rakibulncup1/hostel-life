-- Hostel Life — Run35: Super Admin security controls, log retention,
-- Telegram connection administration and active device-session management.
-- Additive migration. Historical migrations remain unchanged.
-- Does not read, write, or modify any public file/bucket object.
-- Apply only after a verified database backup and the preflight below.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $run35_preflight$
DECLARE v_column record;
BEGIN
  IF to_regclass('private.hl_security_events') IS NULL
     OR to_regclass('private.hl_activity_events') IS NULL
     OR to_regclass('private.password_reset_request_log') IS NULL
     OR to_regclass('public.user_notification_channels') IS NULL
     OR to_regclass('public.notification_link_tokens') IS NULL
     OR to_regclass('public.platform_audit_log') IS NULL
     OR to_regclass('public.hl_auth_sessions') IS NULL
     OR to_regclass('private.hl_login_sessions') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.hostels') IS NULL
     OR to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('public.market_entries') IS NULL
     OR to_regclass('public.monthly_periods') IS NULL
     OR to_regclass('auth.users') IS NULL
     OR to_regclass('auth.sessions') IS NULL THEN
    RAISE EXCEPTION 'Run35 stopped: required Hostel Life security, audit, Telegram, or session tables are missing. No changes were committed.';
  END IF;
  IF to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.is_super_admin()') IS NULL
     OR to_regprocedure('public.consume_password_reset_quota(text)') IS NULL
     OR to_regprocedure('public.hl_record_public_security_event(text,text,text,inet,text,text,text)') IS NULL
     OR to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'Run35 stopped: required authorization, legacy RPC, or pgcrypto digest function is missing. No changes were committed.';
  END IF;

  -- Check every column the new RPCs read or write before changing anything.
  FOR v_column IN
    SELECT * FROM (VALUES
      ('private','hl_security_events','event_type'),('private','hl_security_events','ip_address'),
      ('private','hl_security_events','ip_fingerprint'),('private','hl_security_events','identity_fingerprint'),
      ('private','hl_security_events','failure_code'),('private','hl_security_events','user_agent'),
      ('private','hl_security_events','request_origin'),('private','hl_security_events','created_at'),
      ('private','hl_activity_events','id'),('private','hl_activity_events','hostel_id'),
      ('private','hl_activity_events','actor_user_id'),('private','hl_activity_events','subject_user_id'),
      ('private','hl_activity_events','event_type'),('private','hl_activity_events','source_table'),
      ('private','hl_activity_events','target_id'),('private','hl_activity_events','ip_address'),
      ('private','hl_activity_events','metadata'),('private','hl_activity_events','created_at'),
      ('private','password_reset_request_log','id'),('private','password_reset_request_log','email_fingerprint'),
      ('private','password_reset_request_log','requested_at'),
      ('public','user_notification_channels','user_id'),('public','user_notification_channels','provider'),
      ('public','user_notification_channels','enabled'),('public','user_notification_channels','provider_user_id'),
      ('public','user_notification_channels','provider_username'),('public','user_notification_channels','connected_at'),
      ('public','notification_link_tokens','user_id'),
      ('public','platform_audit_log','actor_user_id'),('public','platform_audit_log','action'),
      ('public','platform_audit_log','target_type'),('public','platform_audit_log','target_id'),
      ('public','platform_audit_log','reason'),('public','platform_audit_log','details'),
      ('public','hl_auth_sessions','user_id'),('public','hl_auth_sessions','session_id'),
      ('public','hl_auth_sessions','registered_at'),('public','hl_auth_sessions','last_seen_at'),
      ('public','hl_auth_sessions','expires_at'),('public','hl_auth_sessions','revoked_at'),
      ('public','hl_auth_sessions','revoke_reason'),('public','hl_auth_sessions','updated_at'),
      ('private','hl_login_sessions','session_id'),('private','hl_login_sessions','user_id'),
      ('private','hl_login_sessions','last_seen_at'),('private','hl_login_sessions','last_logout_at'),
      ('private','hl_login_sessions','ip_address'),('private','hl_login_sessions','user_agent'),
      ('public','profiles','id'),('public','profiles','full_name'),('public','profiles','phone'),
      ('public','hostels','id'),('public','hostels','name'),
      ('public','hostel_memberships','id'),('public','hostel_memberships','user_id'),
      ('public','hostel_memberships','hostel_id'),('public','hostel_memberships','status'),
      ('public','market_entries','id'),('public','market_entries','entry_date'),
      ('public','monthly_periods','id'),('public','monthly_periods','label'),
      ('auth','users','id'),('auth','users','email'),
      ('auth','sessions','id'),('auth','sessions','user_id'),('auth','sessions','not_after')
    ) AS required(schema_name,table_name,column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema=v_column.schema_name
        AND c.table_name=v_column.table_name
        AND c.column_name=v_column.column_name
    ) THEN
      RAISE EXCEPTION 'Run35 stopped: required column %.%.% is missing. No changes were committed.',
        v_column.schema_name,v_column.table_name,v_column.column_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='auth' AND table_name='sessions' AND column_name='not_after'
      AND data_type='timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'Run35 stopped: auth.sessions.not_after is not timestamptz as expected.';
  END IF;
END;
$run35_preflight$;

-- ---------------------------------------------------------------------------
-- 1. Security metadata and short-lived IP request/block records.
-- ---------------------------------------------------------------------------
ALTER TABLE private.hl_security_events
  ADD COLUMN IF NOT EXISTS country_code varchar(2);

DO $run35_event_constraint$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.hl_security_events'::regclass AND conname='hl_security_events_event_type_check') THEN
    ALTER TABLE private.hl_security_events DROP CONSTRAINT hl_security_events_event_type_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.hl_security_events'::regclass AND conname='hl_security_events_event_type_run35_check') THEN
    ALTER TABLE private.hl_security_events ADD CONSTRAINT hl_security_events_event_type_run35_check
      CHECK (event_type IN ('login_failed','login_success','signup_failed','signup_submitted','password_reset_failed','password_reset_requested')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.hl_security_events'::regclass AND conname='hl_security_events_country_code_run35_check') THEN
    ALTER TABLE private.hl_security_events ADD CONSTRAINT hl_security_events_country_code_run35_check
      CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$') NOT VALID;
  END IF;
END;
$run35_event_constraint$;
ALTER TABLE private.hl_security_events VALIDATE CONSTRAINT hl_security_events_event_type_run35_check;
ALTER TABLE private.hl_security_events VALIDATE CONSTRAINT hl_security_events_country_code_run35_check;
CREATE INDEX IF NOT EXISTS hl_security_events_country_created_idx
  ON private.hl_security_events(country_code,created_at DESC) WHERE country_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS private.hl_security_ip_blocks (
  scope text NOT NULL CHECK (scope IN ('auth','password_reset')),
  ip_address inet NOT NULL,
  block_reason text NOT NULL,
  country_code varchar(2),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  blocked_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz NOT NULL,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(scope,ip_address),
  CHECK (blocked_until > blocked_at)
);
ALTER TABLE private.hl_security_ip_blocks ADD COLUMN IF NOT EXISTS country_code varchar(2);
DO $run35_ip_block_country_constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.hl_security_ip_blocks'::regclass AND conname='hl_security_ip_blocks_country_code_run35_check') THEN
    ALTER TABLE private.hl_security_ip_blocks ADD CONSTRAINT hl_security_ip_blocks_country_code_run35_check
      CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$') NOT VALID;
  END IF;
END;
$run35_ip_block_country_constraint$;
ALTER TABLE private.hl_security_ip_blocks VALIDATE CONSTRAINT hl_security_ip_blocks_country_code_run35_check;
CREATE INDEX IF NOT EXISTS hl_security_ip_blocks_active_idx
  ON private.hl_security_ip_blocks(scope,blocked_until DESC);
ALTER TABLE private.hl_security_ip_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.hl_security_ip_blocks FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS private.hl_password_reset_ip_attempts (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  ip_address inet NOT NULL,
  country_code varchar(2),
  requested_at timestamptz NOT NULL DEFAULT now(),
  CHECK(country_code IS NULL OR country_code ~ '^[A-Z]{2}$')
);
CREATE INDEX IF NOT EXISTS hl_password_reset_ip_attempts_time_idx
  ON private.hl_password_reset_ip_attempts(ip_address,requested_at DESC);
ALTER TABLE private.hl_password_reset_ip_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.hl_password_reset_ip_attempts FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 2. Service-role-only event ingestion. The legacy seven-argument RPC remains
--    available for the existing health check and older deployed callers.
--    Application-flow threshold: the 6th failed login/signup in a rolling
--    minute blocks that IP from app-mediated login/signup for 15 minutes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hl_record_public_security_event_v2(
  p_event_type text,
  p_identity_fingerprint text DEFAULT NULL,
  p_ip_fingerprint text DEFAULT NULL,
  p_request_ip inet DEFAULT NULL,
  p_failure_code text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_request_origin text DEFAULT NULL,
  p_country_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ip_count integer := 0;
  v_recent_failed_count integer := 0;
  v_global_count integer := 0;
  v_block_until timestamptz;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_country text := upper(nullif(btrim(coalesce(p_country_code,'')),''));
BEGIN
  IF p_event_type NOT IN ('login_failed','login_success','signup_failed','signup_submitted','password_reset_failed','password_reset_requested') THEN
    RAISE EXCEPTION USING MESSAGE='অনুমোদিত Security Event নয়।',ERRCODE='22023';
  END IF;
  IF p_identity_fingerprint IS NOT NULL AND p_identity_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING MESSAGE='Identity fingerprint সঠিক নয়।',ERRCODE='22023';
  END IF;
  IF p_ip_fingerprint IS NOT NULL AND p_ip_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING MESSAGE='IP fingerprint সঠিক নয়।',ERRCODE='22023';
  END IF;
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN
    v_country := NULL;
  END IF;

  -- Serialize each IP before counting. Evaluate the sixth failed attempt
  -- BEFORE telemetry caps, so a full analytics budget cannot disable the
  -- requested short auth block. The 10-minute/global caps still bound storage.
  IF p_request_ip IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hostel-life-security-event:'||pg_catalog.host(p_request_ip),0));
    SELECT count(*)::integer INTO v_ip_count
    FROM private.hl_security_events
    WHERE ip_address=p_request_ip AND created_at>v_now-interval '10 minutes';
    IF p_event_type IN ('login_failed','signup_failed') THEN
      SELECT count(*)::integer INTO v_recent_failed_count
      FROM private.hl_security_events
      WHERE ip_address=p_request_ip
        AND event_type IN ('login_failed','signup_failed')
        AND created_at>v_now-interval '1 minute';
      IF v_recent_failed_count >= 5 THEN
        v_block_until:=v_now+interval '15 minutes';
        INSERT INTO private.hl_security_ip_blocks(scope,ip_address,block_reason,country_code,attempt_count,blocked_at,blocked_until,last_attempt_at,updated_at)
        VALUES('auth',p_request_ip,'more_than_5_failed_auth_attempts_per_minute',v_country,v_recent_failed_count+1,v_now,v_block_until,v_now,v_now)
        ON CONFLICT(scope,ip_address) DO UPDATE SET
          block_reason=EXCLUDED.block_reason,
          country_code=COALESCE(EXCLUDED.country_code,private.hl_security_ip_blocks.country_code),
          attempt_count=GREATEST(private.hl_security_ip_blocks.attempt_count,EXCLUDED.attempt_count),
          blocked_until=GREATEST(private.hl_security_ip_blocks.blocked_until,EXCLUDED.blocked_until),
          last_attempt_at=EXCLUDED.last_attempt_at,
          updated_at=EXCLUDED.updated_at;
      END IF;
    END IF;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(728194650173::bigint);
  SELECT count(*)::integer INTO v_global_count
  FROM private.hl_security_events WHERE created_at>v_now-interval '10 minutes';
  IF v_global_count >= 1000 THEN
    RETURN pg_catalog.jsonb_build_object('accepted',false,'blocked',v_block_until IS NOT NULL,
      'blocked_until',v_block_until,'attempt_count',CASE WHEN p_event_type IN ('login_failed','signup_failed') THEN v_recent_failed_count+1 ELSE NULL END,
      'reason','global_telemetry_rate_limited');
  END IF;
  IF p_request_ip IS NOT NULL AND v_ip_count >= 60 THEN
    RETURN pg_catalog.jsonb_build_object('accepted',false,'blocked',v_block_until IS NOT NULL,
      'blocked_until',v_block_until,'attempt_count',CASE WHEN p_event_type IN ('login_failed','signup_failed') THEN v_recent_failed_count+1 ELSE NULL END,
      'reason','telemetry_rate_limited');
  END IF;

  INSERT INTO private.hl_security_events(
    event_type,ip_address,ip_fingerprint,identity_fingerprint,
    failure_code,user_agent,request_origin,country_code
  ) VALUES(
    p_event_type,p_request_ip,p_ip_fingerprint,p_identity_fingerprint,
    nullif(pg_catalog.left(coalesce(p_failure_code,''),40),''),
    nullif(pg_catalog.left(coalesce(p_user_agent,''),512),''),
    nullif(pg_catalog.left(coalesce(p_request_origin,''),200),''),
    v_country
  );

  IF p_event_type IN ('login_failed','signup_failed') THEN
    v_recent_failed_count:=v_recent_failed_count+1;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'accepted',true,
    'blocked',v_block_until IS NOT NULL,
    'blocked_until',v_block_until,
    'attempt_count',CASE WHEN p_event_type IN ('login_failed','signup_failed') THEN v_recent_failed_count ELSE NULL END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.hl_record_public_security_event(
  p_event_type text,
  p_identity_fingerprint text DEFAULT NULL,
  p_ip_fingerprint text DEFAULT NULL,
  p_request_ip inet DEFAULT NULL,
  p_failure_code text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_request_origin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.hl_record_public_security_event_v2(
    p_event_type,p_identity_fingerprint,p_ip_fingerprint,p_request_ip,
    p_failure_code,p_user_agent,p_request_origin,NULL
  );
$function$;

CREATE OR REPLACE FUNCTION public.hl_check_auth_ip_block(p_request_ip inet)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_block private.hl_security_ip_blocks%ROWTYPE;
BEGIN
  IF p_request_ip IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('blocked',false,'protection_available',false);
  END IF;
  SELECT * INTO v_block FROM private.hl_security_ip_blocks
  WHERE scope='auth' AND ip_address=p_request_ip AND blocked_until>pg_catalog.now();
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('blocked',false,'protection_available',true);
  END IF;
  RETURN pg_catalog.jsonb_build_object('blocked',true,'protection_available',true,
    'blocked_until',v_block.blocked_until,'retry_after_seconds',GREATEST(1,ceil(extract(epoch FROM (v_block.blocked_until-pg_catalog.now())))::integer),
    'reason','too_many_failed_attempts');
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Password reset IP limiter. Two requests/hour are accepted; the third
--    request creates a one-hour block. Email quota remains separate (2/day,
--    5/month, Asia/Dhaka calendar) and uses only HMAC fingerprints.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hl_consume_password_reset_ip_request(
  p_request_ip inet,
  p_country_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_country text := upper(nullif(btrim(coalesce(p_country_code,'')),''));
  v_block private.hl_security_ip_blocks%ROWTYPE;
  v_count integer := 0;
  v_block_until timestamptz;
BEGIN
  IF p_request_ip IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('allowed',false,'protection_available',false,'reason','client_ip_unavailable');
  END IF;
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN v_country:=NULL; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hostel-life-reset-ip:'||pg_catalog.host(p_request_ip),0));
  SELECT * INTO v_block FROM private.hl_security_ip_blocks
  WHERE scope='password_reset' AND ip_address=p_request_ip AND blocked_until>v_now;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('allowed',false,'protection_available',true,
      'reason','ip_hourly_block','blocked_until',v_block.blocked_until,
      'retry_at',v_block.blocked_until,
      'retry_after_seconds',GREATEST(1,ceil(extract(epoch FROM (v_block.blocked_until-v_now)))::integer));
  END IF;

  IF pg_catalog.pg_try_advisory_xact_lock(728194650174::bigint) THEN
    DELETE FROM private.hl_password_reset_ip_attempts WHERE requested_at<v_now-interval '48 hours';
  END IF;
  INSERT INTO private.hl_password_reset_ip_attempts(ip_address,country_code,requested_at)
  VALUES(p_request_ip,v_country,v_now);
  SELECT count(*)::integer INTO v_count FROM private.hl_password_reset_ip_attempts
  WHERE ip_address=p_request_ip AND requested_at>v_now-interval '1 hour';
  IF v_count>2 THEN
    v_block_until:=v_now+interval '1 hour';
    INSERT INTO private.hl_security_ip_blocks(scope,ip_address,block_reason,country_code,attempt_count,blocked_at,blocked_until,last_attempt_at,updated_at)
    VALUES('password_reset',p_request_ip,'more_than_2_password_reset_requests_per_hour',v_country,v_count,v_now,v_block_until,v_now,v_now)
    ON CONFLICT(scope,ip_address) DO UPDATE SET
      block_reason=EXCLUDED.block_reason,
      country_code=COALESCE(EXCLUDED.country_code,private.hl_security_ip_blocks.country_code),
      attempt_count=GREATEST(private.hl_security_ip_blocks.attempt_count,EXCLUDED.attempt_count),
      blocked_until=GREATEST(private.hl_security_ip_blocks.blocked_until,EXCLUDED.blocked_until),
      last_attempt_at=EXCLUDED.last_attempt_at,
      updated_at=EXCLUDED.updated_at;
    RETURN pg_catalog.jsonb_build_object('allowed',false,'protection_available',true,
      'reason','ip_hourly_block','blocked_until',v_block_until,'retry_at',v_block_until,
      'retry_after_seconds',3600,'attempt_count',v_count);
  END IF;
  RETURN pg_catalog.jsonb_build_object('allowed',true,'protection_available',true,
    'remaining',GREATEST(0,2-v_count),'attempt_count',v_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_password_reset_quota(p_email_fingerprint text)
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
  IF p_email_fingerprint IS NULL OR p_email_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid password reset fingerprint.';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hostel-life-password-reset:'||p_email_fingerprint,0));
  IF pg_catalog.pg_try_advisory_xact_lock(20261031,771001) THEN
    DELETE FROM private.password_reset_request_log WHERE requested_at<v_now-interval '35 days';
  END IF;
  v_local_now:=v_now AT TIME ZONE 'Asia/Dhaka';
  v_day_start:=pg_catalog.date_trunc('day',v_local_now) AT TIME ZONE 'Asia/Dhaka';
  v_month_start:=pg_catalog.date_trunc('month',v_local_now) AT TIME ZONE 'Asia/Dhaka';
  v_next_day:=(pg_catalog.date_trunc('day',v_local_now)+interval '1 day') AT TIME ZONE 'Asia/Dhaka';
  v_next_month:=(pg_catalog.date_trunc('month',v_local_now)+interval '1 month') AT TIME ZONE 'Asia/Dhaka';
  SELECT count(*) FILTER(WHERE requested_at>=v_day_start)::integer,count(*)::integer
    INTO v_daily_used,v_monthly_used
  FROM private.password_reset_request_log
  WHERE email_fingerprint=p_email_fingerprint AND requested_at>=v_month_start;
  IF v_monthly_used>=5 THEN
    RETURN pg_catalog.jsonb_build_object('allowed',false,'reason','monthly_limit','daily_limit',2,'monthly_limit',5,
      'daily_used',v_daily_used,'monthly_used',v_monthly_used,'daily_remaining',GREATEST(0,2-v_daily_used),
      'monthly_remaining',0,'retry_at',v_next_month);
  END IF;
  IF v_daily_used>=2 THEN
    RETURN pg_catalog.jsonb_build_object('allowed',false,'reason','daily_limit','daily_limit',2,'monthly_limit',5,
      'daily_used',v_daily_used,'monthly_used',v_monthly_used,'daily_remaining',0,
      'monthly_remaining',GREATEST(0,5-v_monthly_used),'retry_at',v_next_day);
  END IF;
  INSERT INTO private.password_reset_request_log(email_fingerprint,requested_at)
  VALUES(p_email_fingerprint,v_now) RETURNING id INTO v_request_id;
  RETURN pg_catalog.jsonb_build_object('allowed',true,'request_id',v_request_id,'daily_limit',2,'monthly_limit',5,
    'daily_used',v_daily_used+1,'monthly_used',v_monthly_used+1,
    'daily_remaining',GREATEST(0,1-v_daily_used),'monthly_remaining',GREATEST(0,4-v_monthly_used));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Super Admin filtered Activity/Security RPCs. All outputs are bounded.
-- p_to is an exclusive upper bound; UI passes midnight after the selected Dhaka end date.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_admin_list_activity_v2(
  p_hostel_id uuid DEFAULT NULL,
  p_event_type text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_limit integer:=LEAST(GREATEST(COALESCE(p_limit,30),1),100);
  v_offset integer:=LEAST(GREATEST(COALESCE(p_offset,0),0),1000000);
  v_type text:=NULLIF(left(btrim(COALESCE(p_event_type,'')),100),'');
  v_total bigint; v_items jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE='শুধু Super Admin Activity Log দেখতে পারবেন।',ERRCODE='42501'; END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND (p_to<p_from OR p_to-p_from>interval '366 days') THEN
    RAISE EXCEPTION USING MESSAGE='Activity Log-এর তারিখসীমা সঠিক নয় (সর্বোচ্চ ৩৬৬ দিন)।',ERRCODE='22023';
  END IF;
  SELECT count(*) INTO v_total FROM private.hl_activity_events e
  WHERE (p_hostel_id IS NULL OR e.hostel_id=p_hostel_id)
    AND (v_type IS NULL OR e.event_type=v_type)
    AND (p_from IS NULL OR e.created_at>=p_from)
    AND (p_to IS NULL OR e.created_at<p_to);
  SELECT COALESCE(jsonb_agg(q.item ORDER BY q.created_at DESC,q.id DESC),'[]'::jsonb) INTO v_items
  FROM (
    SELECT e.id,e.created_at,jsonb_build_object(
      'id',e.id,'hostel_id',e.hostel_id,'hostel_name',h.name,'event_type',e.event_type,
      'source_table',e.source_table,'target_id',e.target_id,
      'target_label',CASE e.source_table
        WHEN 'hostels' THEN (SELECT x.name FROM public.hostels x WHERE x.id::text=e.target_id)
        WHEN 'profiles' THEN (SELECT x.full_name FROM public.profiles x WHERE x.id::text=e.target_id)
        WHEN 'hostel_memberships' THEN (SELECT COALESCE(p.full_name,'সদস্য') FROM public.hostel_memberships m LEFT JOIN public.profiles p ON p.id=m.user_id WHERE m.id::text=e.target_id)
        WHEN 'market_entries' THEN (SELECT 'বাজার · '||x.entry_date::text FROM public.market_entries x WHERE x.id::text=e.target_id)
        WHEN 'monthly_periods' THEN (SELECT x.label FROM public.monthly_periods x WHERE x.id::text=e.target_id)
        ELSE NULLIF(left(COALESCE(e.target_id,''),12),'') END,
      'ip_address',CASE WHEN e.event_type IN ('auth.login','auth.logout') THEN pg_catalog.host(e.ip_address) END,
      'actor_user_id',e.actor_user_id,'actor_name',COALESCE(NULLIF(ap.full_name,''),'সিস্টেম/অজানা'),
      'subject_user_id',e.subject_user_id,'subject_name',COALESCE(NULLIF(sp.full_name,''),'—'),
      'metadata',e.metadata,'created_at',e.created_at
    ) AS item
    FROM private.hl_activity_events e
    LEFT JOIN public.hostels h ON h.id=e.hostel_id
    LEFT JOIN public.profiles ap ON ap.id=e.actor_user_id
    LEFT JOIN public.profiles sp ON sp.id=e.subject_user_id
    WHERE (p_hostel_id IS NULL OR e.hostel_id=p_hostel_id)
      AND (v_type IS NULL OR e.event_type=v_type)
      AND (p_from IS NULL OR e.created_at>=p_from)
      AND (p_to IS NULL OR e.created_at<p_to)
    ORDER BY e.created_at DESC,e.id DESC OFFSET v_offset LIMIT v_limit
  ) q;
  RETURN pg_catalog.jsonb_build_object('items',v_items,'total_count',v_total,'limit',v_limit,'offset',v_offset,
    'has_more',(v_offset+pg_catalog.jsonb_array_length(v_items))<v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_get_security_overview_v2()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE='শুধু Super Admin Security Monitoring দেখতে পারবেন।',ERRCODE='42501'; END IF;
  SELECT pg_catalog.jsonb_build_object(
    'events_24h',count(*) FILTER (WHERE created_at>=pg_catalog.now()-interval '24 hours'),
    'events_7d',count(*) FILTER (WHERE created_at>=pg_catalog.now()-interval '7 days'),
    'failed_logins_24h',count(*) FILTER (WHERE event_type='login_failed' AND created_at>=pg_catalog.now()-interval '24 hours'),
    'successful_logins_24h',count(*) FILTER (WHERE event_type='login_success' AND created_at>=pg_catalog.now()-interval '24 hours'),
    'failed_signups_24h',count(*) FILTER (WHERE event_type='signup_failed' AND created_at>=pg_catalog.now()-interval '24 hours'),
    'signup_submitted_24h',count(*) FILTER (WHERE event_type='signup_submitted' AND created_at>=pg_catalog.now()-interval '24 hours'),
    'password_reset_failed_24h',count(*) FILTER (WHERE event_type='password_reset_failed' AND created_at>=pg_catalog.now()-interval '24 hours'),
    'password_reset_requested_24h',count(*) FILTER (WHERE event_type='password_reset_requested' AND created_at>=pg_catalog.now()-interval '24 hours'),
    'repeat_failure_ips_24h',(SELECT count(*) FROM (SELECT ip_address FROM private.hl_security_events s WHERE s.event_type IN ('login_failed','signup_failed') AND s.created_at>=pg_catalog.now()-interval '24 hours' AND s.ip_address IS NOT NULL GROUP BY ip_address HAVING count(*)>=5) repeated),
    'unique_ips_24h',count(DISTINCT ip_address) FILTER (WHERE created_at>=pg_catalog.now()-interval '24 hours' AND ip_address IS NOT NULL),
    'active_auth_ip_blocks',(SELECT count(*) FROM private.hl_security_ip_blocks b WHERE b.scope='auth' AND b.blocked_until>pg_catalog.now()),
    'active_reset_ip_blocks',(SELECT count(*) FROM private.hl_security_ip_blocks b WHERE b.scope='password_reset' AND b.blocked_until>pg_catalog.now()),
    'top_countries',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('country_code',c.country_code,'events',c.total) ORDER BY c.total DESC),'[]'::jsonb) FROM (SELECT country_code,count(*) AS total FROM private.hl_security_events WHERE created_at>=pg_catalog.now()-interval '24 hours' AND country_code IS NOT NULL GROUP BY country_code ORDER BY total DESC LIMIT 10) c),
    'last_event_at',max(created_at)
  ) INTO v FROM private.hl_security_events;
  RETURN COALESCE(v,'{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_list_security_events_v2(
  p_event_type text DEFAULT NULL,
  p_ip_search text DEFAULT NULL,
  p_country_code text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_limit integer:=LEAST(GREATEST(COALESCE(p_limit,30),1),100);
  v_offset integer:=LEAST(GREATEST(COALESCE(p_offset,0),0),1000000);
  v_type text:=NULLIF(left(btrim(COALESCE(p_event_type,'')),40),'');
  v_ip text:=NULLIF(left(btrim(COALESCE(p_ip_search,'')),80),'');
  v_country text:=NULLIF(upper(left(btrim(COALESCE(p_country_code,'')),2)),'');
  v_total bigint; v_items jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE='শুধু Super Admin Security Monitoring দেখতে পারবেন।',ERRCODE='42501'; END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND (p_to<p_from OR p_to-p_from>interval '366 days') THEN
    RAISE EXCEPTION USING MESSAGE='Security Log-এর তারিখসীমা সঠিক নয় (সর্বোচ্চ ৩৬৬ দিন)।',ERRCODE='22023';
  END IF;
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION USING MESSAGE='Country Code সঠিক নয়।',ERRCODE='22023'; END IF;
  SELECT count(*) INTO v_total FROM private.hl_security_events e
  WHERE (v_type IS NULL OR e.event_type=v_type)
    AND (v_ip IS NULL OR pg_catalog.host(e.ip_address) ILIKE '%'||v_ip||'%')
    AND (v_country IS NULL OR e.country_code=v_country)
    AND (p_from IS NULL OR e.created_at>=p_from)
    AND (p_to IS NULL OR e.created_at<p_to);
  SELECT COALESCE(pg_catalog.jsonb_agg(q.item ORDER BY q.created_at DESC,q.id DESC),'[]'::jsonb) INTO v_items
  FROM (
    SELECT e.id,e.created_at,pg_catalog.jsonb_build_object(
      'id',e.id,'event_type',e.event_type,'ip_address',pg_catalog.host(e.ip_address),
      'ip_fingerprint',e.ip_fingerprint,'identity_ref',CASE WHEN e.identity_fingerprint IS NULL THEN NULL ELSE left(e.identity_fingerprint,12) END,
      'failure_code',e.failure_code,'user_agent',e.user_agent,'request_origin',e.request_origin,
      'country_code',e.country_code,'created_at',e.created_at,
      'ip_attempts_1m',CASE WHEN e.ip_address IS NULL THEN 0 ELSE (SELECT count(*) FROM private.hl_security_events x WHERE x.ip_address=e.ip_address AND x.event_type IN ('login_failed','signup_failed') AND x.created_at>pg_catalog.now()-interval '1 minute') END,
      'ip_attempts_15m',CASE WHEN e.ip_address IS NULL THEN 0 ELSE (SELECT count(*) FROM private.hl_security_events x WHERE x.ip_address=e.ip_address AND x.event_type IN ('login_failed','signup_failed') AND x.created_at>pg_catalog.now()-interval '15 minutes') END,
      'identity_attempts_15m',CASE WHEN e.identity_fingerprint IS NULL THEN 0 ELSE (SELECT count(*) FROM private.hl_security_events x WHERE x.identity_fingerprint=e.identity_fingerprint AND x.event_type IN ('login_failed','signup_failed') AND x.created_at>pg_catalog.now()-interval '15 minutes') END,
      'active_block_until',(SELECT b.blocked_until FROM private.hl_security_ip_blocks b WHERE b.scope='auth' AND b.ip_address=e.ip_address AND b.blocked_until>pg_catalog.now()),
      'risk_level',CASE
        WHEN (e.ip_address IS NOT NULL AND (SELECT count(*) FROM private.hl_security_events x WHERE x.ip_address=e.ip_address AND x.event_type IN ('login_failed','signup_failed') AND x.created_at>pg_catalog.now()-interval '15 minutes')>=10)
          OR (e.identity_fingerprint IS NOT NULL AND (SELECT count(*) FROM private.hl_security_events x WHERE x.identity_fingerprint=e.identity_fingerprint AND x.event_type IN ('login_failed','signup_failed') AND x.created_at>pg_catalog.now()-interval '15 minutes')>=5) THEN 'high'
        WHEN (e.ip_address IS NOT NULL AND (SELECT count(*) FROM private.hl_security_events x WHERE x.ip_address=e.ip_address AND x.event_type IN ('login_failed','signup_failed') AND x.created_at>pg_catalog.now()-interval '15 minutes')>=5)
          OR (e.identity_fingerprint IS NOT NULL AND (SELECT count(*) FROM private.hl_security_events x WHERE x.identity_fingerprint=e.identity_fingerprint AND x.event_type IN ('login_failed','signup_failed') AND x.created_at>pg_catalog.now()-interval '15 minutes')>=3) THEN 'review'
        ELSE 'normal' END
    ) AS item
    FROM private.hl_security_events e
    WHERE (v_type IS NULL OR e.event_type=v_type)
      AND (v_ip IS NULL OR pg_catalog.host(e.ip_address) ILIKE '%'||v_ip||'%')
      AND (v_country IS NULL OR e.country_code=v_country)
      AND (p_from IS NULL OR e.created_at>=p_from)
      AND (p_to IS NULL OR e.created_at<p_to)
    ORDER BY e.created_at DESC,e.id DESC OFFSET v_offset LIMIT v_limit
  ) q;
  RETURN pg_catalog.jsonb_build_object('items',v_items,'total_count',v_total,'limit',v_limit,'offset',v_offset,
    'has_more',(v_offset+pg_catalog.jsonb_array_length(v_items))<v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_list_security_ip_blocks(
  p_scope text DEFAULT NULL,p_limit integer DEFAULT 30,p_offset integer DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_limit integer:=LEAST(GREATEST(COALESCE(p_limit,30),1),100); v_offset integer:=GREATEST(COALESCE(p_offset,0),0); v_total bigint; v_items jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE='শুধু Super Admin IP Block তালিকা দেখতে পারবেন।',ERRCODE='42501'; END IF;
  IF p_scope IS NOT NULL AND p_scope NOT IN ('auth','password_reset') THEN RAISE EXCEPTION USING MESSAGE='Block Scope সঠিক নয়।',ERRCODE='22023'; END IF;
  SELECT count(*) INTO v_total FROM private.hl_security_ip_blocks b WHERE b.blocked_until>pg_catalog.now() AND (p_scope IS NULL OR b.scope=p_scope);
  SELECT COALESCE(pg_catalog.jsonb_agg(q.item ORDER BY q.blocked_until DESC),'[]'::jsonb) INTO v_items FROM (
    SELECT pg_catalog.jsonb_build_object('scope',b.scope,'ip_address',pg_catalog.host(b.ip_address),'block_reason',b.block_reason,
      'attempt_count',b.attempt_count,'blocked_at',b.blocked_at,'blocked_until',b.blocked_until,
      'country_code',b.country_code) AS item,
      b.blocked_until
    FROM private.hl_security_ip_blocks b WHERE b.blocked_until>pg_catalog.now() AND (p_scope IS NULL OR b.scope=p_scope)
    ORDER BY b.blocked_until DESC OFFSET v_offset LIMIT v_limit
  ) q;
  RETURN pg_catalog.jsonb_build_object('items',v_items,'total_count',v_total,'limit',v_limit,'offset',v_offset);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Human-readable Telegram connection directory and controlled disconnect.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_admin_list_telegram_connections(
  p_search text DEFAULT NULL,p_limit integer DEFAULT 25,p_offset integer DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_limit integer:=LEAST(GREATEST(COALESCE(p_limit,25),1),100); v_offset integer:=GREATEST(COALESCE(p_offset,0),0); v_search text:=NULLIF(left(btrim(COALESCE(p_search,'')),120),''); v_total bigint; v_items jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE='শুধু Super Admin Telegram সংযোগ তালিকা দেখতে পারবেন।',ERRCODE='42501'; END IF;
  SELECT count(*) INTO v_total
  FROM public.user_notification_channels c
  JOIN public.profiles p ON p.id=c.user_id
  LEFT JOIN auth.users u ON u.id=c.user_id
  WHERE c.provider='telegram' AND c.enabled=true
    AND (v_search IS NULL OR p.full_name ILIKE '%'||v_search||'%' OR COALESCE(u.email,'') ILIKE '%'||v_search||'%' OR COALESCE(c.provider_user_id,'') ILIKE '%'||v_search||'%' OR COALESCE(c.provider_username,'') ILIKE '%'||v_search||'%');
  SELECT COALESCE(pg_catalog.jsonb_agg(q.item ORDER BY q.connected_at DESC),'[]'::jsonb) INTO v_items FROM (
    SELECT c.connected_at,pg_catalog.jsonb_build_object(
      'user_id',c.user_id,'full_name',COALESCE(NULLIF(p.full_name,''),'নাম নেই'),'email',u.email,'phone',p.phone,
      'telegram_user_id',c.provider_user_id,'telegram_username',c.provider_username,'connected_at',c.connected_at,
      'hostel_names',COALESCE((SELECT pg_catalog.string_agg(DISTINCT h.name,', ' ORDER BY h.name) FROM public.hostel_memberships m JOIN public.hostels h ON h.id=m.hostel_id WHERE m.user_id=c.user_id AND m.status='active'),'—')
    ) AS item
    FROM public.user_notification_channels c
    JOIN public.profiles p ON p.id=c.user_id
    LEFT JOIN auth.users u ON u.id=c.user_id
    WHERE c.provider='telegram' AND c.enabled=true
      AND (v_search IS NULL OR p.full_name ILIKE '%'||v_search||'%' OR COALESCE(u.email,'') ILIKE '%'||v_search||'%' OR COALESCE(c.provider_user_id,'') ILIKE '%'||v_search||'%' OR COALESCE(c.provider_username,'') ILIKE '%'||v_search||'%')
    ORDER BY c.connected_at DESC OFFSET v_offset LIMIT v_limit
  ) q;
  RETURN pg_catalog.jsonb_build_object('items',v_items,'total_count',v_total,'limit',v_limit,'offset',v_offset);
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_disconnect_telegram_user(p_user_id uuid,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_deleted integer:=0; v_tokens integer:=0; v_name text;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE='শুধু Super Admin Telegram সংযোগ বিচ্ছিন্ন করতে পারবেন।',ERRCODE='42501'; END IF;
  IF p_user_id IS NULL OR p_user_id=auth.uid() THEN RAISE EXCEPTION USING MESSAGE='নিজের বর্তমান Admin অ্যাকাউন্টের সংযোগ এই তালিকা থেকে বিচ্ছিন্ন করা যাবে না।',ERRCODE='22023'; END IF;
  SELECT full_name INTO v_name FROM public.profiles WHERE id=p_user_id;
  DELETE FROM public.user_notification_channels WHERE user_id=p_user_id AND provider='telegram';
  GET DIAGNOSTICS v_deleted=ROW_COUNT;
  DELETE FROM public.notification_link_tokens WHERE user_id=p_user_id;
  GET DIAGNOSTICS v_tokens=ROW_COUNT;
  INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,reason,details)
  VALUES(auth.uid(),'admin_telegram_unlinked','user',p_user_id::text,left(nullif(btrim(COALESCE(p_reason,'')),''),500),
    pg_catalog.jsonb_build_object('source','super_admin_telegram_connections','channel_rows_removed',v_deleted,'pending_tokens_invalidated',v_tokens,'target_name',v_name));
  RETURN pg_catalog.jsonb_build_object('disconnected',v_deleted>0,'pending_tokens_invalidated',v_tokens,'user_id',p_user_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Active device/session list and precise administrator revocation.
--    The UI receives a SHA-256 reference, never the actual Auth session UUID.
-- ---------------------------------------------------------------------------
DO $run35_session_reason_constraint$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.hl_auth_sessions'::regclass AND conname='hl_auth_sessions_revoke_reason_check') THEN
    ALTER TABLE public.hl_auth_sessions DROP CONSTRAINT hl_auth_sessions_revoke_reason_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.hl_auth_sessions'::regclass AND conname='hl_auth_sessions_revoke_reason_run35_check') THEN
    ALTER TABLE public.hl_auth_sessions ADD CONSTRAINT hl_auth_sessions_revoke_reason_run35_check
      CHECK (revoke_reason IS NULL OR revoke_reason IN ('device_limit','session_timeout','manual_policy_update','auth_session_missing','admin_revoked')) NOT VALID;
  END IF;
END;
$run35_session_reason_constraint$;
ALTER TABLE public.hl_auth_sessions VALIDATE CONSTRAINT hl_auth_sessions_revoke_reason_run35_check;

CREATE OR REPLACE FUNCTION public.platform_admin_list_active_sessions(
  p_search text DEFAULT NULL,p_limit integer DEFAULT 50,p_offset integer DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_limit integer:=LEAST(GREATEST(COALESCE(p_limit,50),1),100); v_offset integer:=GREATEST(COALESCE(p_offset,0),0); v_search text:=NULLIF(left(btrim(COALESCE(p_search,'')),120),''); v_total bigint; v_items jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE='শুধু Super Admin সক্রিয় Session তালিকা দেখতে পারবেন।',ERRCODE='42501'; END IF;
  SELECT count(*) INTO v_total FROM public.hl_auth_sessions s
  JOIN auth.sessions a ON a.id=s.session_id AND a.user_id=s.user_id
  LEFT JOIN public.profiles p ON p.id=s.user_id LEFT JOIN auth.users u ON u.id=s.user_id
  WHERE s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>pg_catalog.now()) AND (a.not_after IS NULL OR a.not_after>pg_catalog.now())
    AND (v_search IS NULL OR COALESCE(p.full_name,'') ILIKE '%'||v_search||'%' OR COALESCE(u.email,'') ILIKE '%'||v_search||'%');
  SELECT COALESCE(pg_catalog.jsonb_agg(q.item ORDER BY q.last_seen_at DESC),'[]'::jsonb) INTO v_items FROM (
    SELECT s.last_seen_at,pg_catalog.jsonb_build_object(
      'user_id',s.user_id,'full_name',COALESCE(NULLIF(p.full_name,''),'নাম নেই'),'email',u.email,
      'hostel_names',COALESCE((SELECT pg_catalog.string_agg(DISTINCT h.name,', ' ORDER BY h.name) FROM public.hostel_memberships m JOIN public.hostels h ON h.id=m.hostel_id WHERE m.user_id=s.user_id AND m.status='active'),'—'),
      'registered_at',s.registered_at,'last_seen_at',s.last_seen_at,'expires_at',s.expires_at,
      'session_ref',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(s.session_id::text,'UTF8'),'sha256'),'hex'),
      'ip_address',(SELECT pg_catalog.host(ls.ip_address) FROM private.hl_login_sessions ls WHERE ls.session_id=s.session_id ORDER BY ls.last_seen_at DESC LIMIT 1),
      'user_agent',(SELECT ls.user_agent FROM private.hl_login_sessions ls WHERE ls.session_id=s.session_id ORDER BY ls.last_seen_at DESC LIMIT 1)
    ) AS item
    FROM public.hl_auth_sessions s
    JOIN auth.sessions a ON a.id=s.session_id AND a.user_id=s.user_id
    LEFT JOIN public.profiles p ON p.id=s.user_id LEFT JOIN auth.users u ON u.id=s.user_id
    WHERE s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>pg_catalog.now()) AND (a.not_after IS NULL OR a.not_after>pg_catalog.now())
      AND (v_search IS NULL OR COALESCE(p.full_name,'') ILIKE '%'||v_search||'%' OR COALESCE(u.email,'') ILIKE '%'||v_search||'%')
    ORDER BY s.last_seen_at DESC OFFSET v_offset LIMIT v_limit
  ) q;
  RETURN pg_catalog.jsonb_build_object('items',v_items,'total_count',v_total,'limit',v_limit,'offset',v_offset);
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_revoke_active_session(
  p_user_id uuid,p_session_ref text,p_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_session_id uuid; v_name text; v_email text;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE='শুধু Super Admin নির্দিষ্ট Session বন্ধ করতে পারবেন।',ERRCODE='42501'; END IF;
  IF p_user_id IS NULL OR p_session_ref IS NULL OR p_session_ref !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING MESSAGE='Session reference সঠিক নয়।',ERRCODE='22023';
  END IF;
  SELECT s.session_id,p.full_name,u.email INTO v_session_id,v_name,v_email
  FROM public.hl_auth_sessions s
  LEFT JOIN public.profiles p ON p.id=s.user_id LEFT JOIN auth.users u ON u.id=s.user_id
  WHERE s.user_id=p_user_id
    AND pg_catalog.encode(extensions.digest(pg_catalog.convert_to(s.session_id::text,'UTF8'),'sha256'),'hex')=p_session_ref
    AND s.revoked_at IS NULL
  FOR UPDATE OF s;
  IF v_session_id IS NULL THEN RAISE EXCEPTION USING MESSAGE='Session আর সক্রিয় নেই অথবা পাওয়া যায়নি। তালিকা রিফ্রেশ করুন।',ERRCODE='P0002'; END IF;
  IF p_user_id=auth.uid() THEN
    IF COALESCE(auth.jwt()->>'session_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION USING MESSAGE='নিজের Admin Session নিরাপদে শনাক্ত করা যায়নি; কোনো Session বন্ধ করা হয়নি। নতুন করে Login করে আবার চেষ্টা করুন।',ERRCODE='22023';
    END IF;
    IF v_session_id=(auth.jwt()->>'session_id')::uuid THEN
      RAISE EXCEPTION USING MESSAGE='নিজের বর্তমান Admin Session এই বোতাম থেকে বন্ধ করা যাবে না।',ERRCODE='22023';
    END IF;
  END IF;
  UPDATE public.hl_auth_sessions SET revoked_at=pg_catalog.now(),revoke_reason='admin_revoked',updated_at=pg_catalog.now()
  WHERE user_id=p_user_id AND session_id=v_session_id AND revoked_at IS NULL;
  UPDATE auth.sessions SET not_after=LEAST(COALESCE(not_after,'infinity'::timestamptz),pg_catalog.now())
  WHERE id=v_session_id AND user_id=p_user_id;
  UPDATE private.hl_login_sessions SET last_logout_at=COALESCE(last_logout_at,pg_catalog.now()),last_seen_at=pg_catalog.now()
  WHERE session_id=v_session_id AND user_id=p_user_id;
  INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,reason,details)
  VALUES(auth.uid(),'admin_session_revoked','user',p_user_id::text,left(nullif(btrim(COALESCE(p_reason,'')),''),500),
    pg_catalog.jsonb_build_object('source','super_admin_active_sessions','session_ref_prefix',left(p_session_ref,12),'target_name',v_name,'target_email',v_email));
  RETURN pg_catalog.jsonb_build_object('revoked',true,'user_id',p_user_id,'session_ref',p_session_ref);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Opportunistic 30-day retention for Activity + Security Logs. No scheduler
--    is assumed: cleanup runs on an inserted log event, with one transaction
--    lock to prevent every event from initiating the same cleanup.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.hl_prune_platform_logs_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF pg_catalog.pg_try_advisory_xact_lock(728194650175::bigint) THEN
    DELETE FROM private.hl_activity_events WHERE created_at<pg_catalog.now()-interval '30 days';
    DELETE FROM private.hl_security_events WHERE created_at<pg_catalog.now()-interval '30 days';
    DELETE FROM private.hl_security_ip_blocks WHERE blocked_until<pg_catalog.now()-interval '30 days';
    DELETE FROM private.hl_password_reset_ip_attempts WHERE requested_at<pg_catalog.now()-interval '48 hours';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.hl_prune_platform_logs_on_insert() FROM PUBLIC,anon,authenticated,service_role;

DO $run35_triggers$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='private.hl_activity_events'::regclass AND tgname='hl_activity_log_retention_30d') THEN
    CREATE TRIGGER hl_activity_log_retention_30d AFTER INSERT ON private.hl_activity_events
      FOR EACH ROW EXECUTE FUNCTION private.hl_prune_platform_logs_on_insert();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='private.hl_security_events'::regclass AND tgname='hl_security_log_retention_30d') THEN
    CREATE TRIGGER hl_security_log_retention_30d AFTER INSERT ON private.hl_security_events
      FOR EACH ROW EXECUTE FUNCTION private.hl_prune_platform_logs_on_insert();
  END IF;
END;
$run35_triggers$;

-- ---------------------------------------------------------------------------
-- 8. Function grants. Public ingestion/gates/quota limiter are service-role
--    only; every directory/read/revoke function is authenticated + Super Admin.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.hl_record_public_security_event_v2(text,text,text,inet,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hl_record_public_security_event(text,text,text,inet,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hl_check_auth_ip_block(inet) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hl_consume_password_reset_ip_request(inet,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.consume_password_reset_quota(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hl_record_public_security_event_v2(text,text,text,inet,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hl_record_public_security_event(text,text,text,inet,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hl_check_auth_ip_block(inet) TO service_role;
GRANT EXECUTE ON FUNCTION public.hl_consume_password_reset_ip_request(inet,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_password_reset_quota(text) TO service_role;

REVOKE ALL ON FUNCTION public.platform_admin_list_activity_v2(uuid,text,timestamptz,timestamptz,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_get_security_overview_v2() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_security_events_v2(text,text,text,timestamptz,timestamptz,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_security_ip_blocks(text,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_telegram_connections(text,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_disconnect_telegram_user(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_active_sessions(text,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_revoke_active_session(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_activity_v2(uuid,text,timestamptz,timestamptz,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_security_overview_v2() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_security_events_v2(text,text,text,timestamptz,timestamptz,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_security_ip_blocks(text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_telegram_connections(text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_disconnect_telegram_user(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_active_sessions(text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_revoke_active_session(uuid,text,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;

-- After successful application, run supabase/verify/Verify_Run35_super_admin_completion.sql.
-- No existing Activity capture trigger is reinstalled or duplicated. No business
-- or financial row is purged by this migration; only logs older than 30 days
-- are removed opportunistically on a new Activity/Security event.
