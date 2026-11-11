-- Run45: isolate automatic authentication limits by (trusted IP + HMAC email identity).
-- No business tables are changed. Existing manual IP blocks remain global by design.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $run45_preflight$
BEGIN
  IF to_regclass('private.hl_security_events') IS NULL
     OR to_regclass('private.hl_security_ip_blocks') IS NULL
     OR to_regclass('private.hl_password_reset_ip_attempts') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='attempt_email')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='identity_fingerprint')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_ip_blocks' AND column_name='scope')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_ip_blocks' AND column_name='ip_address')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_password_reset_ip_attempts' AND column_name='requested_at')
     OR to_regprocedure('public.hl_record_public_security_event_v4(text,text,text,inet,text,text,text,text,text,text,text,text)') IS NULL
     OR to_regprocedure('public.hl_consume_signup_otp_resend(text,text,inet,text,text,text,text,text,text)') IS NULL
     OR to_regprocedure('public.platform_admin_add_security_ip_block(text,text,integer,text)') IS NULL
     OR to_regprocedure('public.platform_admin_list_security_ip_blocks(text,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'Run45 stopped safely: expected Run35–Run44 security objects are missing. No changes committed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.contype='f' AND c.confrelid='private.hl_security_ip_blocks'::regclass
  ) THEN
    RAISE EXCEPTION 'Run45 stopped safely: another table references the IP block primary key; review before changing it.';
  END IF;
END;
$run45_preflight$;

-- HMAC-keyed email identity on block rows; raw email remains in private event history only.
ALTER TABLE private.hl_security_ip_blocks
  ADD COLUMN IF NOT EXISTS email_fingerprint text NOT NULL DEFAULT '';
ALTER TABLE private.hl_security_ip_blocks
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS region_code text;
ALTER TABLE private.hl_password_reset_ip_attempts
  ADD COLUMN IF NOT EXISTS email_fingerprint text NOT NULL DEFAULT '';

DO $run45_constraints$
DECLARE v_pk text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.hl_security_ip_blocks'::regclass AND conname='hl_security_ip_blocks_email_fingerprint_check') THEN
    ALTER TABLE private.hl_security_ip_blocks ADD CONSTRAINT hl_security_ip_blocks_email_fingerprint_check
      CHECK (email_fingerprint='' OR email_fingerprint ~ '^[0-9a-f]{64}$') NOT VALID;
  END IF;
  ALTER TABLE private.hl_security_ip_blocks VALIDATE CONSTRAINT hl_security_ip_blocks_email_fingerprint_check;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.hl_password_reset_ip_attempts'::regclass AND conname='hl_password_reset_ip_attempts_email_fingerprint_check') THEN
    ALTER TABLE private.hl_password_reset_ip_attempts ADD CONSTRAINT hl_password_reset_ip_attempts_email_fingerprint_check
      CHECK (email_fingerprint='' OR email_fingerprint ~ '^[0-9a-f]{64}$') NOT VALID;
  END IF;
  ALTER TABLE private.hl_password_reset_ip_attempts VALIDATE CONSTRAINT hl_password_reset_ip_attempts_email_fingerprint_check;

  SELECT c.conname INTO v_pk FROM pg_constraint c
  WHERE c.conrelid='private.hl_security_ip_blocks'::regclass AND c.contype='p';
  IF v_pk IS NULL THEN
    RAISE EXCEPTION 'Run45 stopped safely: IP block table primary key is missing.';
  END IF;
  IF v_pk <> 'hl_security_ip_blocks_pkey' THEN
    EXECUTE format('ALTER TABLE private.hl_security_ip_blocks DROP CONSTRAINT %I',v_pk);
  ELSE
    ALTER TABLE private.hl_security_ip_blocks DROP CONSTRAINT hl_security_ip_blocks_pkey;
  END IF;
  ALTER TABLE private.hl_security_ip_blocks ADD CONSTRAINT hl_security_ip_blocks_pkey
    PRIMARY KEY(scope,ip_address,email_fingerprint);
END;
$run45_constraints$;

CREATE INDEX IF NOT EXISTS hl_security_ip_blocks_active_pair_idx
  ON private.hl_security_ip_blocks(scope,ip_address,email_fingerprint,blocked_until DESC);
CREATE INDEX IF NOT EXISTS hl_password_reset_ip_attempts_pair_time_idx
  ON private.hl_password_reset_ip_attempts(ip_address,email_fingerprint,requested_at DESC);

-- Old automatic IP-only blocks cannot be safely mapped to one email. Expire those rows;
-- deliberate Super Admin manual blocks (reason starts with 'manual:') remain global.
UPDATE private.hl_security_ip_blocks
SET blocked_until=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
WHERE email_fingerprint=''
  AND ((scope='auth' AND block_reason='more_than_5_failed_auth_attempts_per_minute')
    OR (scope='password_reset' AND block_reason='more_than_2_password_reset_requests_per_hour'))
  AND blocked_until>pg_catalog.clock_timestamp();

CREATE OR REPLACE FUNCTION public.hl_check_auth_ip_block_v2(
  p_request_ip inet,
  p_email_fingerprint text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_block private.hl_security_ip_blocks%ROWTYPE;
BEGIN
  IF p_request_ip IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('blocked',false,'protection_available',false);
  END IF;
  IF p_email_fingerprint IS NOT NULL AND p_email_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING MESSAGE='Identity fingerprint সঠিক নয়।', ERRCODE='22023';
  END IF;
  SELECT * INTO v_block
  FROM private.hl_security_ip_blocks b
  WHERE b.scope='auth' AND b.ip_address=p_request_ip AND b.blocked_until>pg_catalog.now()
    AND (b.email_fingerprint='' OR (p_email_fingerprint IS NOT NULL AND b.email_fingerprint=p_email_fingerprint))
  ORDER BY b.blocked_until DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('blocked',false,'protection_available',true);
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'blocked',true,'protection_available',true,'blocked_until',v_block.blocked_until,
    'retry_after_seconds',GREATEST(1,ceil(extract(epoch FROM (v_block.blocked_until-pg_catalog.now())))::integer),
    'reason',CASE WHEN v_block.email_fingerprint='' THEN 'manual_ip_block' ELSE 'email_ip_pair_rate_limit' END
  );
END;
$function$;

-- Keep the legacy one-argument health/diagnostic signature. It checks only a deliberate global manual block.
CREATE OR REPLACE FUNCTION public.hl_check_auth_ip_block(p_request_ip inet)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT public.hl_check_auth_ip_block_v2(p_request_ip,NULL);
$function$;

CREATE OR REPLACE FUNCTION public.hl_record_public_security_event_v5(
  p_event_type text,
  p_identity_fingerprint text,
  p_ip_fingerprint text,
  p_request_ip inet,
  p_failure_code text,
  p_user_agent text,
  p_request_origin text,
  p_country_code text,
  p_city text,
  p_region text,
  p_region_code text,
  p_attempt_email text
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
  v_country text := upper(nullif(pg_catalog.btrim(coalesce(p_country_code,'')),''));
  v_city text := nullif(pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_city,'')), '[[:cntrl:]]', '', 'g'),100),'');
  v_region text := nullif(pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_region,'')), '[[:cntrl:]]', '', 'g'),100),'');
  v_region_code text := nullif(pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_region_code,'')), '[[:cntrl:]]', '', 'g'),20),'');
  v_attempt_email text := CASE WHEN pg_catalog.length(pg_catalog.btrim(coalesce(p_attempt_email,''))) BETWEEN 5 AND 254 AND pg_catalog.btrim(p_attempt_email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN pg_catalog.lower(pg_catalog.btrim(p_attempt_email)) ELSE NULL END;
BEGIN
  IF p_event_type IS NULL OR p_event_type NOT IN ('login_failed','login_success','signup_failed','signup_submitted','password_reset_failed','password_reset_requested') THEN
    RAISE EXCEPTION USING MESSAGE='অনুমোদিত Security Event নয়।',ERRCODE='22023';
  END IF;
  IF p_identity_fingerprint IS NOT NULL AND p_identity_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING MESSAGE='Identity fingerprint সঠিক নয়।',ERRCODE='22023';
  END IF;
  IF p_ip_fingerprint IS NOT NULL AND p_ip_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING MESSAGE='IP fingerprint সঠিক নয়।',ERRCODE='22023';
  END IF;
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN v_country:=NULL; END IF;

  IF p_request_ip IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hostel-life-security-event:'||pg_catalog.host(p_request_ip),0));
    SELECT count(*)::integer INTO v_ip_count
      FROM private.hl_security_events
      WHERE ip_address=p_request_ip AND created_at>v_now-interval '10 minutes';
    IF p_event_type IN ('login_failed','signup_failed') AND p_identity_fingerprint IS NOT NULL THEN
      SELECT count(*)::integer INTO v_recent_failed_count
        FROM private.hl_security_events
        WHERE ip_address=p_request_ip
          AND identity_fingerprint=p_identity_fingerprint
          AND event_type IN ('login_failed','signup_failed')
          AND created_at>v_now-interval '1 minute';
      IF v_recent_failed_count >= 5 THEN
        v_block_until:=v_now+interval '15 minutes';
        INSERT INTO private.hl_security_ip_blocks(
          scope,ip_address,email_fingerprint,block_reason,country_code,city,region,region_code,
          attempt_count,blocked_at,blocked_until,last_attempt_at,updated_at
        ) VALUES(
          'auth',p_request_ip,p_identity_fingerprint,'more_than_5_failed_auth_attempts_per_minute',v_country,v_city,v_region,v_region_code,
          v_recent_failed_count+1,v_now,v_block_until,v_now,v_now
        )
        ON CONFLICT(scope,ip_address,email_fingerprint) DO UPDATE SET
          block_reason=EXCLUDED.block_reason,
          country_code=coalesce(EXCLUDED.country_code,private.hl_security_ip_blocks.country_code),
          city=coalesce(EXCLUDED.city,private.hl_security_ip_blocks.city),
          region=coalesce(EXCLUDED.region,private.hl_security_ip_blocks.region),
          region_code=coalesce(EXCLUDED.region_code,private.hl_security_ip_blocks.region_code),
          attempt_count=greatest(private.hl_security_ip_blocks.attempt_count,EXCLUDED.attempt_count),
          blocked_until=greatest(private.hl_security_ip_blocks.blocked_until,EXCLUDED.blocked_until),
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
    failure_code,user_agent,request_origin,country_code,city,region,region_code,attempt_email
  ) VALUES(
    p_event_type,p_request_ip,p_ip_fingerprint,p_identity_fingerprint,
    nullif(pg_catalog.left(coalesce(p_failure_code,''),40),''),
    nullif(pg_catalog.left(coalesce(p_user_agent,''),512),''),
    nullif(pg_catalog.left(coalesce(p_request_origin,''),200),''),
    v_country,v_city,v_region,v_region_code,v_attempt_email
  );

  IF p_event_type IN ('login_failed','signup_failed') THEN v_recent_failed_count:=v_recent_failed_count+1; END IF;
  RETURN pg_catalog.jsonb_build_object(
    'accepted',true,
    'blocked',v_block_until IS NOT NULL,
    'blocked_until',v_block_until,
    'attempt_count',CASE WHEN p_event_type IN ('login_failed','signup_failed') THEN v_recent_failed_count ELSE NULL END
  );
END;
$function$;

-- Compatibility for the already-deployed Run44 record-auth-event Edge Function.
-- It keeps its old RPC name but delegates to the same pair-aware writer.
CREATE OR REPLACE FUNCTION public.hl_record_public_security_event_v4(
  p_event_type text,
  p_identity_fingerprint text,
  p_ip_fingerprint text,
  p_request_ip inet,
  p_failure_code text,
  p_user_agent text,
  p_request_origin text,
  p_country_code text,
  p_city text,
  p_region text,
  p_region_code text,
  p_attempt_email text
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT public.hl_record_public_security_event_v5(
    p_event_type,p_identity_fingerprint,p_ip_fingerprint,p_request_ip,p_failure_code,
    p_user_agent,p_request_origin,p_country_code,p_city,p_region,p_region_code,p_attempt_email
  );
$function$;

CREATE OR REPLACE FUNCTION public.hl_consume_password_reset_ip_request_v3(
  p_request_ip inet,
  p_email_fingerprint text,
  p_country_code text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_region_code text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_country text := upper(nullif(pg_catalog.btrim(coalesce(p_country_code,'')),''));
  v_city text := nullif(pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_city,'')), '[[:cntrl:]]', '', 'g'),100),'');
  v_region text := nullif(pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_region,'')), '[[:cntrl:]]', '', 'g'),100),'');
  v_region_code text := nullif(pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_region_code,'')), '[[:cntrl:]]', '', 'g'),20),'');
  v_block private.hl_security_ip_blocks%ROWTYPE;
  v_count integer := 0;
  v_block_until timestamptz;
BEGIN
  IF p_request_ip IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('allowed',true,'protection_available',false,'reason','client_ip_unavailable');
  END IF;
  IF p_email_fingerprint IS NULL OR p_email_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING MESSAGE='Identity fingerprint সঠিক নয়।', ERRCODE='22023';
  END IF;
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN v_country:=NULL; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hostel-life-reset-ip:'||pg_catalog.host(p_request_ip)||':'||p_email_fingerprint,0));

  SELECT * INTO v_block FROM private.hl_security_ip_blocks b
  WHERE b.scope='password_reset' AND b.ip_address=p_request_ip AND b.blocked_until>v_now
    AND (b.email_fingerprint='' OR b.email_fingerprint=p_email_fingerprint)
  ORDER BY b.blocked_until DESC LIMIT 1;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('allowed',false,'protection_available',true,
      'reason','ip_hourly_block','blocked_until',v_block.blocked_until,'retry_at',v_block.blocked_until,
      'retry_after_seconds',GREATEST(1,ceil(extract(epoch FROM (v_block.blocked_until-v_now)))::integer));
  END IF;

  IF pg_catalog.pg_try_advisory_xact_lock(728194650174::bigint) THEN
    DELETE FROM private.hl_password_reset_ip_attempts WHERE requested_at<v_now-interval '48 hours';
  END IF;
  INSERT INTO private.hl_password_reset_ip_attempts(ip_address,email_fingerprint,country_code,city,region,region_code,requested_at)
  VALUES(p_request_ip,p_email_fingerprint,v_country,v_city,v_region,v_region_code,v_now);
  SELECT count(*)::integer INTO v_count FROM private.hl_password_reset_ip_attempts
  WHERE ip_address=p_request_ip AND email_fingerprint=p_email_fingerprint AND requested_at>v_now-interval '1 hour';
  IF v_count>2 THEN
    v_block_until:=v_now+interval '1 hour';
    INSERT INTO private.hl_security_ip_blocks(
      scope,ip_address,email_fingerprint,block_reason,country_code,city,region,region_code,
      attempt_count,blocked_at,blocked_until,last_attempt_at,updated_at
    ) VALUES(
      'password_reset',p_request_ip,p_email_fingerprint,'more_than_2_password_reset_requests_per_hour',v_country,v_city,v_region,v_region_code,
      v_count,v_now,v_block_until,v_now,v_now
    )
    ON CONFLICT(scope,ip_address,email_fingerprint) DO UPDATE SET
      block_reason=EXCLUDED.block_reason,
      country_code=coalesce(EXCLUDED.country_code,private.hl_security_ip_blocks.country_code),
      city=coalesce(EXCLUDED.city,private.hl_security_ip_blocks.city),
      region=coalesce(EXCLUDED.region,private.hl_security_ip_blocks.region),
      region_code=coalesce(EXCLUDED.region_code,private.hl_security_ip_blocks.region_code),
      attempt_count=greatest(private.hl_security_ip_blocks.attempt_count,EXCLUDED.attempt_count),
      blocked_until=greatest(private.hl_security_ip_blocks.blocked_until,EXCLUDED.blocked_until),
      last_attempt_at=EXCLUDED.last_attempt_at,updated_at=EXCLUDED.updated_at;
    RETURN pg_catalog.jsonb_build_object('allowed',false,'protection_available',true,
      'reason','ip_hourly_block','blocked_until',v_block_until,'retry_at',v_block_until,
      'retry_after_seconds',3600,'attempt_count',v_count);
  END IF;
  RETURN pg_catalog.jsonb_build_object('allowed',true,'protection_available',true,
    'remaining',GREATEST(0,2-v_count),'attempt_count',v_count);
END;
$function$;

-- Backward-compatible legacy RPC. Old callers use an isolated legacy bucket, not a global user block.
CREATE OR REPLACE FUNCTION public.hl_consume_password_reset_ip_request_v2(
  p_request_ip inet,p_country_code text DEFAULT NULL,p_city text DEFAULT NULL,p_region text DEFAULT NULL,p_region_code text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT pg_catalog.jsonb_build_object('allowed',true,'protection_available',true,'reason','legacy_rpc_deprecated');
$function$;

CREATE OR REPLACE FUNCTION public.hl_consume_signup_otp_resend(
  p_email_fingerprint text,
  p_attempt_email text,
  p_request_ip inet,
  p_country_code text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_region_code text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_request_origin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz:=pg_catalog.clock_timestamp();
  v_email_count integer:=0;
  v_ip_count integer:=0;
  v_first timestamptz;
  v_retry timestamptz;
  v_local_now timestamp without time zone;
  v_day_start timestamptz;
  v_country text:=upper(nullif(pg_catalog.btrim(COALESCE(p_country_code,'')),''));
  v_city text:=nullif(pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.btrim(COALESCE(p_city,'')),'[[:cntrl:]]','','g'),100),'');
  v_region text:=nullif(pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.btrim(COALESCE(p_region,'')),'[[:cntrl:]]','','g'),100),'');
  v_region_code text:=nullif(pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.btrim(COALESCE(p_region_code,'')),'[[:cntrl:]]','','g'),20),'');
  v_email text:=lower(nullif(pg_catalog.btrim(COALESCE(p_attempt_email,'')),''));
BEGIN
  -- IP is optional: when unavailable, retain the per-email quota and let Supabase Auth limits apply.
  IF p_email_fingerprint IS NULL OR p_email_fingerprint !~ '^[0-9a-f]{64}$' OR v_email IS NULL OR length(v_email)>254 THEN
    RAISE EXCEPTION USING MESSAGE='ইমেইল পরিচয় যাচাই করা যায়নি।',ERRCODE='22023';
  END IF;
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN v_country:=NULL; END IF;

  -- Keep lock order stable (IP first, then email) to avoid quota races.
  IF p_request_ip IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hostel-life-signup-otp-ip:'||pg_catalog.host(p_request_ip)||':'||p_email_fingerprint,0));
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hostel-life-signup-otp-email:'||p_email_fingerprint,0));

  IF p_request_ip IS NOT NULL THEN
    SELECT count(*)::integer,min(created_at) INTO v_ip_count,v_first
    FROM private.hl_security_events
    WHERE event_type='signup_otp_resend' AND ip_address=p_request_ip
      AND identity_fingerprint=p_email_fingerprint
      AND created_at>v_now-interval '1 hour';
  END IF;
  IF p_request_ip IS NOT NULL AND v_ip_count>=2 THEN
    v_retry:=v_first+interval '1 hour';
    RETURN pg_catalog.jsonb_build_object('allowed',false,'reason','ip_hourly_limit','retry_at',v_retry,
      'retry_after_seconds',GREATEST(1,ceil(extract(epoch FROM (v_retry-v_now)))::integer));
  END IF;

  v_local_now:=v_now AT TIME ZONE 'Asia/Dhaka';
  v_day_start:=pg_catalog.date_trunc('day',v_local_now) AT TIME ZONE 'Asia/Dhaka';
  SELECT count(*)::integer INTO v_email_count
  FROM private.hl_security_events
  WHERE event_type='signup_otp_resend' AND identity_fingerprint=p_email_fingerprint
    AND created_at>=v_day_start;
  IF v_email_count>=2 THEN
    v_retry:=(pg_catalog.date_trunc('day',v_local_now)+interval '1 day') AT TIME ZONE 'Asia/Dhaka';
    RETURN pg_catalog.jsonb_build_object('allowed',false,'reason','email_daily_limit','retry_at',v_retry,
      'retry_after_seconds',GREATEST(1,ceil(extract(epoch FROM (v_retry-v_now)))::integer));
  END IF;

  INSERT INTO private.hl_security_events(event_type,ip_address,identity_fingerprint,attempt_email,
    user_agent,request_origin,country_code,city,region,region_code)
  VALUES('signup_otp_resend',p_request_ip,p_email_fingerprint,v_email,
    nullif(pg_catalog.left(COALESCE(p_user_agent,''),512),''),
    nullif(pg_catalog.left(COALESCE(p_request_origin,''),200),''),
    v_country,v_city,v_region,v_region_code);
  RETURN pg_catalog.jsonb_build_object('allowed',true,'email_remaining',GREATEST(0,1-v_email_count),'ip_remaining',GREATEST(0,1-v_ip_count));
END;
$function$;
CREATE OR REPLACE FUNCTION public.platform_admin_add_security_ip_block(
  p_ip_address text,
  p_scope text,
  p_duration_minutes integer,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ip inet;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_until timestamptz;
  v_reason text := nullif(pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_reason,'')), '[[:cntrl:]]', '', 'g'), 180), '');
  v_scopes text[];
  v_scope text;
  v_country text;
  v_city text;
  v_region text;
  v_region_code text;
  v_count integer := 0;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE='IP Block করতে দ্বিস্তর যাচাইকৃত Super Admin হতে হবে।', ERRCODE='42501'; END IF;
  BEGIN
    v_ip := pg_catalog.btrim(coalesce(p_ip_address,''))::inet;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING MESSAGE='সঠিক IPv4 বা IPv6 ঠিকানা দিন।', ERRCODE='22023';
  END;
  IF (pg_catalog.family(v_ip) = 4 AND pg_catalog.masklen(v_ip) <> 32)
     OR (pg_catalog.family(v_ip) = 6 AND pg_catalog.masklen(v_ip) <> 128) THEN
    RAISE EXCEPTION USING MESSAGE='নিরাপত্তার জন্য শুধু একটি নির্দিষ্ট IP ঠিকানা ব্লক করা যাবে; CIDR range নয়।', ERRCODE='22023';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('auth','password_reset','both') THEN
    RAISE EXCEPTION USING MESSAGE='Block scope সঠিক নয়।', ERRCODE='22023';
  END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes NOT IN (15,60,360,1440,10080,43200) THEN
    RAISE EXCEPTION USING MESSAGE='১৫ মিনিট, ১ ঘণ্টা, ৬ ঘণ্টা, ২৪ ঘণ্টা, ৭ দিন অথবা ৩০ দিনের একটি মেয়াদ বেছে নিন।', ERRCODE='22023';
  END IF;
  IF v_reason IS NULL OR pg_catalog.length(v_reason)<3 THEN
    RAISE EXCEPTION USING MESSAGE='IP Block করার কারণ কমপক্ষে ৩ অক্ষরে লিখুন।', ERRCODE='22023';
  END IF;

  v_until := v_now + (p_duration_minutes * interval '1 minute');
  SELECT e.country_code,e.city,e.region,e.region_code
    INTO v_country,v_city,v_region,v_region_code
  FROM private.hl_security_events e
  WHERE e.ip_address=v_ip AND e.created_at>=v_now-interval '30 days'
  ORDER BY e.created_at DESC,e.id DESC LIMIT 1;

  v_scopes := CASE WHEN p_scope='both' THEN ARRAY['auth','password_reset']::text[] ELSE ARRAY[p_scope]::text[] END;
  FOREACH v_scope IN ARRAY v_scopes LOOP
    INSERT INTO private.hl_security_ip_blocks(
      scope,ip_address,email_fingerprint,block_reason,country_code,city,region,region_code,
      attempt_count,blocked_at,blocked_until,last_attempt_at,updated_at
    ) VALUES (
      v_scope,v_ip,'','manual: '||v_reason,v_country,v_city,v_region,v_region_code,
      0,v_now,v_until,v_now,v_now
    )
    ON CONFLICT(scope,ip_address,email_fingerprint) DO UPDATE SET
      block_reason=EXCLUDED.block_reason,
      country_code=coalesce(EXCLUDED.country_code,private.hl_security_ip_blocks.country_code),
      city=coalesce(EXCLUDED.city,private.hl_security_ip_blocks.city),
      region=coalesce(EXCLUDED.region,private.hl_security_ip_blocks.region),
      region_code=coalesce(EXCLUDED.region_code,private.hl_security_ip_blocks.region_code),
      blocked_at=EXCLUDED.blocked_at,
      blocked_until=greatest(private.hl_security_ip_blocks.blocked_until,EXCLUDED.blocked_until),
      last_attempt_at=EXCLUDED.last_attempt_at,
      updated_at=EXCLUDED.updated_at;
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,reason,details)
  VALUES(auth.uid(),'security_ip_block_created','security_ip',pg_catalog.host(v_ip),v_reason,
    pg_catalog.jsonb_build_object('scope',p_scope,'duration_minutes',p_duration_minutes,'blocked_until',v_until));

  RETURN pg_catalog.jsonb_build_object(
    'ok',true,'ip_address',pg_catalog.host(v_ip),'scope',p_scope,
    'duration_minutes',p_duration_minutes,'blocked_until',v_until,'rows_created_or_updated',v_count
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.platform_admin_release_security_ip_block_v2(
  p_ip_address text,
  p_scope text,
  p_attempt_email text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_ip inet;
  v_email text := lower(nullif(pg_catalog.btrim(coalesce(p_attempt_email,'')),''));
  v_email_fingerprint text := '';
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_scopes text[];
  v_scope text;
  v_rows integer := 0;
  v_total integer := 0;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='IP Block তুলতে দ্বিস্তর যাচাইকৃত Super Admin হতে হবে।', ERRCODE='42501';
  END IF;
  BEGIN v_ip := pg_catalog.btrim(coalesce(p_ip_address,''))::inet;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING MESSAGE='সঠিক IPv4 বা IPv6 ঠিকানা দিন।', ERRCODE='22023'; END;
  IF (pg_catalog.family(v_ip) = 4 AND pg_catalog.masklen(v_ip) <> 32)
     OR (pg_catalog.family(v_ip) = 6 AND pg_catalog.masklen(v_ip) <> 128) THEN
    RAISE EXCEPTION USING MESSAGE='শুধু নির্দিষ্ট IP ঠিকানার Block তোলা যাবে।', ERRCODE='22023';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('auth','password_reset','both') THEN
    RAISE EXCEPTION USING MESSAGE='Block Scope সঠিক নয়।', ERRCODE='22023';
  END IF;
  IF v_email IS NOT NULL THEN
    SELECT e.identity_fingerprint INTO v_email_fingerprint
    FROM private.hl_security_events e
    WHERE e.ip_address=v_ip AND e.attempt_email=v_email AND e.identity_fingerprint IS NOT NULL
      AND e.event_type<>'signup_otp_resend'
      AND e.created_at>=v_now-interval '30 days'
    ORDER BY e.created_at DESC,e.id DESC LIMIT 1;
    IF v_email_fingerprint IS NULL THEN
      RAISE EXCEPTION USING MESSAGE='এই IP ও ইমেইলের জন্য সাম্প্রতিক পরিচয়-রেফারেন্স পাওয়া যায়নি। Event তালিকা যাচাই করুন।', ERRCODE='22023';
    END IF;
  END IF;
  v_scopes := CASE WHEN p_scope='both' THEN ARRAY['auth','password_reset']::text[] ELSE ARRAY[p_scope]::text[] END;
  FOREACH v_scope IN ARRAY v_scopes LOOP
    UPDATE private.hl_security_ip_blocks b
    SET blocked_until=greatest(b.blocked_at+interval '1 microsecond',v_now),
        updated_at=v_now,block_reason=left(b.block_reason||' · manually released',180)
    WHERE b.scope=v_scope AND b.ip_address=v_ip AND b.email_fingerprint=coalesce(v_email_fingerprint,'') AND b.blocked_until>v_now;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_total := v_total + v_rows;
  END LOOP;
  INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,details)
  VALUES(auth.uid(),'security_ip_block_released','security_ip',pg_catalog.host(v_ip),
    pg_catalog.jsonb_build_object('scope',p_scope,'released_rows',v_total,'attempt_email',v_email));
  RETURN pg_catalog.jsonb_build_object('ok',true,'ip_address',pg_catalog.host(v_ip),'scope',p_scope,'released_rows',v_total,'attempt_email',v_email);
END;
$function$;

-- Keep the old two-argument Unblock RPC safe for older Frontend builds:
-- it releases only a deliberate global/manual block, never all account-pair blocks.
CREATE OR REPLACE FUNCTION public.platform_admin_release_security_ip_block(
  p_ip_address text,
  p_scope text
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT public.platform_admin_release_security_ip_block_v2(p_ip_address,p_scope,NULL);
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_list_security_ip_blocks(
  p_scope text DEFAULT NULL,p_limit integer DEFAULT 30,p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit,30),1),100);
  v_offset integer := LEAST(GREATEST(COALESCE(p_offset,0),0),1000000);
  v_total bigint;
  v_items jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='শুধু দ্বিস্তর যাচাইকৃত Super Admin IP Block তালিকা দেখতে পারবেন।', ERRCODE='42501';
  END IF;
  IF p_scope IS NOT NULL AND p_scope NOT IN ('auth','password_reset') THEN
    RAISE EXCEPTION USING MESSAGE='Block Scope সঠিক নয়।', ERRCODE='22023';
  END IF;
  SELECT count(*) INTO v_total
  FROM private.hl_security_ip_blocks b
  WHERE b.blocked_until > pg_catalog.now() AND (p_scope IS NULL OR b.scope=p_scope);

  SELECT COALESCE(pg_catalog.jsonb_agg(q.item ORDER BY q.blocked_until DESC),'[]'::jsonb)
  INTO v_items
  FROM (
    SELECT pg_catalog.jsonb_build_object(
      'scope',b.scope,
      'ip_address',pg_catalog.host(b.ip_address),
      'block_type',CASE WHEN b.email_fingerprint='' THEN 'global_manual' ELSE 'account_pair' END,
      'attempt_email',(SELECT e.attempt_email FROM private.hl_security_events e WHERE e.ip_address=b.ip_address AND e.identity_fingerprint=b.email_fingerprint AND b.email_fingerprint<>'' AND e.attempt_email IS NOT NULL AND e.event_type<>'signup_otp_resend' ORDER BY e.created_at DESC,e.id DESC LIMIT 1),
      'block_reason',b.block_reason,
      'attempt_count',b.attempt_count,
      'blocked_at',b.blocked_at,
      'blocked_until',b.blocked_until,
      'country_code',b.country_code,
      'city',b.city,
      'region',b.region,
      'region_code',b.region_code
    ) AS item,
    b.blocked_until
    FROM private.hl_security_ip_blocks b
    WHERE b.blocked_until > pg_catalog.now() AND (p_scope IS NULL OR b.scope=p_scope)
    ORDER BY b.blocked_until DESC
    OFFSET v_offset LIMIT v_limit
  ) q;
  RETURN pg_catalog.jsonb_build_object('items',v_items,'total_count',v_total,'limit',v_limit,'offset',v_offset);
END;
$function$;

REVOKE ALL ON FUNCTION public.hl_check_auth_ip_block_v2(inet,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hl_check_auth_ip_block_v2(inet,text) TO service_role;
REVOKE ALL ON FUNCTION public.hl_check_auth_ip_block(inet) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hl_check_auth_ip_block(inet) TO service_role;
REVOKE ALL ON FUNCTION public.hl_record_public_security_event_v5(text,text,text,inet,text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hl_record_public_security_event_v5(text,text,text,inet,text,text,text,text,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.hl_consume_password_reset_ip_request_v3(inet,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hl_consume_password_reset_ip_request_v3(inet,text,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.hl_consume_password_reset_ip_request_v2(inet,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hl_consume_password_reset_ip_request_v2(inet,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.hl_consume_signup_otp_resend(text,text,inet,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hl_consume_signup_otp_resend(text,text,inet,text,text,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.platform_admin_add_security_ip_block(text,text,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_add_security_ip_block(text,text,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_release_security_ip_block_v2(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_release_security_ip_block_v2(text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_list_security_ip_blocks(text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_security_ip_blocks(text,integer,integer) TO authenticated;

COMMIT;
