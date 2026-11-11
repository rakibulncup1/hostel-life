-- Hostel Life Run44 — Security Review Center, manual IP controls, and mandatory Super Admin TOTP.
-- Safe extension of Run35-Run40: reuses the existing security event/IP block tables and Run37 Cron cleanup.
-- No new event table, no raw OTP/password storage, and no third-party IP lookup writes from the database.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $run44_preflight$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  v_timezone text;
BEGIN
  IF to_regprocedure('private.assert_signed_in()') IS NULL THEN
    v_missing := array_append(v_missing, 'private.assert_signed_in()');
  END IF;
  IF to_regprocedure('private.is_current_auth_session_allowed()') IS NULL THEN
    v_missing := array_append(v_missing, 'private.is_current_auth_session_allowed() (Run30)');
  END IF;
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.platform_audit_log') IS NULL THEN
    v_missing := array_append(v_missing, 'public.profiles / public.platform_audit_log');
  END IF;
  IF to_regclass('private.hl_security_events') IS NULL OR to_regclass('private.hl_security_ip_blocks') IS NULL THEN
    v_missing := array_append(v_missing, 'Run35 private security event/IP block tables');
  END IF;
  IF to_regprocedure('public.platform_admin_list_security_events_v4(text,text,text,text,timestamptz,timestamptz,integer,integer)') IS NULL
     OR to_regprocedure('public.hl_record_public_security_event_v4(text,text,text,inet,text,text,text,text,text,text,text,text)') IS NULL THEN
    v_missing := array_append(v_missing, 'Run39 email-enriched security writer/reader');
  END IF;
  IF to_regprocedure('public.hl_consume_signup_otp_resend(text,text,inet,text,text,text,text,text,text)') IS NULL THEN
    v_missing := array_append(v_missing, 'Run40 signup OTP resend event writer');
  END IF;
  IF to_regprocedure('public.hl_check_auth_ip_block(inet)') IS NULL THEN
    v_missing := array_append(v_missing, 'Run35 server-side auth IP block checker');
  END IF;
  IF to_regprocedure('private.hl_prune_platform_logs()') IS NULL THEN
    v_missing := array_append(v_missing, 'Run37 private.hl_prune_platform_logs()');
  END IF;
  IF to_regclass('cron.job') IS NULL OR to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    v_missing := array_append(v_missing, 'pg_cron / cron.schedule (enable Supabase Cron and apply Run37 first)');
  END IF;

  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'Run44 stopped safely. Missing prerequisites: %. Apply/verify the listed existing migrations first; no changes were committed.', array_to_string(v_missing, ', ');
  END IF;


  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='attempt_email')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='ip_address' AND udt_schema='pg_catalog' AND udt_name='inet')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='created_at' AND data_type='timestamp with time zone')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='city')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='region')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='request_origin')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='country_code')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='region_code') THEN
    RAISE EXCEPTION 'Run44 stopped safely: hl_security_events is missing one or more Run36/Run39 columns. No changes were committed.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_ip_blocks' AND column_name='scope')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_ip_blocks' AND column_name='ip_address' AND udt_schema='pg_catalog' AND udt_name='inet')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_ip_blocks' AND column_name='blocked_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_ip_blocks' AND column_name='blocked_until')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_ip_blocks' AND column_name='city')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_ip_blocks' AND column_name='region')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_ip_blocks' AND column_name='region_code')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_ip_blocks' AND column_name='updated_at') THEN
    RAISE EXCEPTION 'Run44 stopped safely: hl_security_ip_blocks schema is not compatible. No changes were committed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='private.hl_security_events'::regclass
      AND conname='hl_security_events_event_type_run40_check'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'Run44 stopped safely: Run40 event type constraint is missing or not validated. No changes were committed.';
  END IF;

  v_timezone := lower(coalesce(nullif(current_setting('cron.timezone', true), ''), 'GMT'));
  IF v_timezone NOT IN ('utc','gmt','etc/utc','etc/gmt','asia/dhaka','asia/dacca') THEN
    RAISE EXCEPTION 'Run44 stopped safely: cron.timezone (%) is unsupported. Set it to UTC or Asia/Dhaka and review existing jobs first.', v_timezone;
  END IF;
END;
$run44_preflight$;

-- Mandatory AAL2 for every existing Super Admin RPC/RLS policy that uses this central helper.
-- Profile self-read remains available at AAL1, so the UI can show password + TOTP setup.
CREATE OR REPLACE FUNCTION private.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
    AND private.is_current_auth_session_allowed()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin' AND NOT p.is_blocked
    )
$function$;

COMMENT ON FUNCTION private.is_super_admin() IS
  'Run44: Super Admin authorization requires an active application session and Supabase Auth AAL2 (verified second factor).';

CREATE OR REPLACE FUNCTION public.platform_admin_assert_aal2()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='Super Admin-এর জন্য পাসওয়ার্ড ও Authenticator—দুই ধাপের যাচাই প্রয়োজন।', ERRCODE='42501';
  END IF;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_admin_assert_aal2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_assert_aal2() TO authenticated;

-- One read-only 30-day review RPC. It aggregates the existing private event rows on demand;
-- no materialized table or extra write workload is introduced.
CREATE OR REPLACE FUNCTION public.platform_admin_get_security_analytics_30d()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_from timestamptz := pg_catalog.now() - interval '30 days';
  v_today_dhaka date := (pg_catalog.now() AT TIME ZONE 'Asia/Dhaka')::date;
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='৩০ দিনের Security Review শুধু দ্বিস্তর যাচাইকৃত Super Admin দেখতে পারবেন।', ERRCODE='42501';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'window_from', v_from,
    'window_to', v_now,
    'retention_days', 30,
    'retention_job_active', EXISTS (
      SELECT 1 FROM cron.job j
      WHERE j.jobname='hostel-life-platform-log-retention-30d' AND j.active
    ),
    'retention_job_schedule', (
      SELECT j.schedule FROM cron.job j
      WHERE j.jobname='hostel-life-platform-log-retention-30d' AND j.active
      ORDER BY j.jobid DESC LIMIT 1
    ),
    'events_30d', count(*),
    'login_failed_30d', count(*) FILTER (WHERE e.event_type='login_failed'),
    'login_success_30d', count(*) FILTER (WHERE e.event_type='login_success'),
    'signup_failed_30d', count(*) FILTER (WHERE e.event_type='signup_failed'),
    'signup_submitted_30d', count(*) FILTER (WHERE e.event_type='signup_submitted'),
    'signup_verified_30d', count(*) FILTER (WHERE e.event_type='signup_verified'),
    'signup_otp_resend_30d', count(*) FILTER (WHERE e.event_type='signup_otp_resend'),
    'password_reset_failed_30d', count(*) FILTER (WHERE e.event_type='password_reset_failed'),
    'password_reset_requested_30d', count(*) FILTER (WHERE e.event_type='password_reset_requested'),
    'unique_ips_30d', count(DISTINCT e.ip_address),
    'events_with_ip_30d', count(*) FILTER (WHERE e.ip_address IS NOT NULL),
    'events_with_country_30d', count(*) FILTER (WHERE e.country_code IS NOT NULL),
    'events_with_city_region_30d', count(*) FILTER (WHERE e.city IS NOT NULL OR e.region IS NOT NULL),
    'events_without_ip_30d', count(*) FILTER (WHERE e.ip_address IS NULL),
    'events_without_geo_30d', count(*) FILTER (WHERE e.country_code IS NULL AND e.city IS NULL AND e.region IS NULL),
    'active_auth_ip_blocks', (SELECT count(*) FROM private.hl_security_ip_blocks b WHERE b.scope='auth' AND b.blocked_until>v_now),
    'active_reset_ip_blocks', (SELECT count(*) FROM private.hl_security_ip_blocks b WHERE b.scope='password_reset' AND b.blocked_until>v_now),
    'top_ips_30d', (
      SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'ip_address', pg_catalog.host(q.ip_address),
        'events', q.event_count,
        'failed_attempts', q.failed_count,
        'last_seen', q.last_seen,
        'country_code', q.country_code,
        'city', q.city,
        'region', q.region,
        'active_auth_block_until', (SELECT pg_catalog.max(b.blocked_until) FROM private.hl_security_ip_blocks b WHERE b.scope='auth' AND b.ip_address=q.ip_address AND b.blocked_until>v_now),
        'active_reset_block_until', (SELECT pg_catalog.max(b.blocked_until) FROM private.hl_security_ip_blocks b WHERE b.scope='password_reset' AND b.ip_address=q.ip_address AND b.blocked_until>v_now)
      ) ORDER BY q.event_count DESC, q.last_seen DESC), '[]'::jsonb)
      FROM (
        SELECT e2.ip_address,
          count(*) AS event_count,
          count(*) FILTER (WHERE e2.event_type IN ('login_failed','signup_failed','password_reset_failed')) AS failed_count,
          pg_catalog.max(e2.created_at) AS last_seen,
          (pg_catalog.array_agg(e2.country_code ORDER BY e2.created_at DESC) FILTER (WHERE e2.country_code IS NOT NULL))[1] AS country_code,
          (pg_catalog.array_agg(e2.city ORDER BY e2.created_at DESC) FILTER (WHERE e2.city IS NOT NULL))[1] AS city,
          (pg_catalog.array_agg(e2.region ORDER BY e2.created_at DESC) FILTER (WHERE e2.region IS NOT NULL))[1] AS region
        FROM private.hl_security_events e2
        WHERE e2.created_at>=v_from AND e2.created_at<v_now AND e2.ip_address IS NOT NULL
        GROUP BY e2.ip_address
        ORDER BY count(*) DESC, pg_catalog.max(e2.created_at) DESC
        LIMIT 10
      ) q
    ),
    'top_countries_30d', (
      SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('country_code',q.country_code,'events',q.events) ORDER BY q.events DESC), '[]'::jsonb)
      FROM (
        SELECT e2.country_code, count(*) AS events
        FROM private.hl_security_events e2
        WHERE e2.created_at>=v_from AND e2.created_at<v_now AND e2.country_code IS NOT NULL
        GROUP BY e2.country_code ORDER BY count(*) DESC, e2.country_code LIMIT 10
      ) q
    ),
    'top_locations_30d', (
      SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'city',q.city,'region',q.region,'region_code',q.region_code,'country_code',q.country_code,'events',q.events
      ) ORDER BY q.events DESC), '[]'::jsonb)
      FROM (
        SELECT e2.city,e2.region,e2.region_code,e2.country_code,count(*) AS events
        FROM private.hl_security_events e2
        WHERE e2.created_at>=v_from AND e2.created_at<v_now
          AND (e2.city IS NOT NULL OR e2.region IS NOT NULL)
        GROUP BY e2.city,e2.region,e2.region_code,e2.country_code
        ORDER BY count(*) DESC LIMIT 10
      ) q
    ),
    'top_origins_30d', (
      SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('origin',q.request_origin,'events',q.events) ORDER BY q.events DESC), '[]'::jsonb)
      FROM (
        SELECT e2.request_origin,count(*) AS events
        FROM private.hl_security_events e2
        WHERE e2.created_at>=v_from AND e2.created_at<v_now AND e2.request_origin IS NOT NULL
        GROUP BY e2.request_origin ORDER BY count(*) DESC LIMIT 10
      ) q
    ),
    'event_types_30d', (
      SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('event_type',q.event_type,'events',q.events) ORDER BY q.events DESC), '[]'::jsonb)
      FROM (
        SELECT e2.event_type,count(*) AS events
        FROM private.hl_security_events e2
        WHERE e2.created_at>=v_from AND e2.created_at<v_now
        GROUP BY e2.event_type ORDER BY count(*) DESC
      ) q
    ),
    'daily_30d', (
      SELECT coalesce(pg_catalog.jsonb_agg(q.item ORDER BY q.day), '[]'::jsonb)
      FROM (
        SELECT d.day,
          pg_catalog.jsonb_build_object(
            'date', pg_catalog.to_char(d.day,'YYYY-MM-DD'),
            'events', count(e3.id),
            'login_failed', count(e3.id) FILTER (WHERE e3.event_type='login_failed'),
            'login_success', count(e3.id) FILTER (WHERE e3.event_type='login_success'),
            'signup_failed', count(e3.id) FILTER (WHERE e3.event_type='signup_failed'),
            'signup_submitted', count(e3.id) FILTER (WHERE e3.event_type='signup_submitted'),
            'signup_verified', count(e3.id) FILTER (WHERE e3.event_type='signup_verified'),
            'signup_otp_resend', count(e3.id) FILTER (WHERE e3.event_type='signup_otp_resend'),
            'password_reset_failed', count(e3.id) FILTER (WHERE e3.event_type='password_reset_failed'),
            'password_reset_requested', count(e3.id) FILTER (WHERE e3.event_type='password_reset_requested')
          ) AS item
        FROM (
          SELECT (v_today_dhaka - g.n)::date AS day
          FROM pg_catalog.generate_series(29,0,-1) AS g(n)
        ) d
        LEFT JOIN private.hl_security_events e3
          ON e3.created_at >= (d.day::timestamp AT TIME ZONE 'Asia/Dhaka')
         AND e3.created_at < ((d.day + 1)::timestamp AT TIME ZONE 'Asia/Dhaka')
         AND e3.created_at>=v_from AND e3.created_at<v_now
        GROUP BY d.day
      ) q
    )
  ) INTO v_result
  FROM private.hl_security_events e
  WHERE e.created_at>=v_from AND e.created_at<v_now;

  RETURN coalesce(v_result, pg_catalog.jsonb_build_object(
    'window_from',v_from,'window_to',v_now,'retention_days',30,'events_30d',0,
    'login_failed_30d',0,'login_success_30d',0,'signup_failed_30d',0,
    'signup_submitted_30d',0,'signup_verified_30d',0,'signup_otp_resend_30d',0,
    'password_reset_failed_30d',0,'password_reset_requested_30d',0,
    'unique_ips_30d',0,'events_with_ip_30d',0,'events_with_country_30d',0,
    'events_with_city_region_30d',0,'events_without_ip_30d',0,'events_without_geo_30d',0,
    'top_ips_30d','[]'::jsonb,'top_countries_30d','[]'::jsonb,'top_locations_30d','[]'::jsonb,
    'top_origins_30d','[]'::jsonb,'event_types_30d','[]'::jsonb,'daily_30d','[]'::jsonb
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_admin_get_security_analytics_30d() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_security_analytics_30d() TO authenticated;

-- Manual IP deny-list controls reuse the existing automatic block table and its gate checks.
-- Exact host addresses only; CIDR ranges are rejected to avoid accidental shared-network outages.
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
      scope,ip_address,block_reason,country_code,city,region,region_code,
      attempt_count,blocked_at,blocked_until,last_attempt_at,updated_at
    ) VALUES (
      v_scope,v_ip,'manual: '||v_reason,v_country,v_city,v_region,v_region_code,
      0,v_now,v_until,v_now,v_now
    )
    ON CONFLICT(scope,ip_address) DO UPDATE SET
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

CREATE OR REPLACE FUNCTION public.platform_admin_release_security_ip_block(
  p_ip_address text,
  p_scope text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ip inet;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_scopes text[];
  v_scope text;
  v_count integer := 0;
  v_rows integer := 0;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE='IP Block তুলতে দ্বিস্তর যাচাইকৃত Super Admin হতে হবে।', ERRCODE='42501'; END IF;
  BEGIN
    v_ip := pg_catalog.btrim(coalesce(p_ip_address,''))::inet;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING MESSAGE='সঠিক IPv4 বা IPv6 ঠিকানা দিন।', ERRCODE='22023';
  END;
  IF (pg_catalog.family(v_ip) = 4 AND pg_catalog.masklen(v_ip) <> 32)
     OR (pg_catalog.family(v_ip) = 6 AND pg_catalog.masklen(v_ip) <> 128) THEN
    RAISE EXCEPTION USING MESSAGE='শুধু নির্দিষ্ট IP ঠিকানার Block তোলা যাবে।', ERRCODE='22023';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('auth','password_reset','both') THEN
    RAISE EXCEPTION USING MESSAGE='Block scope সঠিক নয়।', ERRCODE='22023';
  END IF;

  v_scopes := CASE WHEN p_scope='both' THEN ARRAY['auth','password_reset']::text[] ELSE ARRAY[p_scope]::text[] END;
  FOREACH v_scope IN ARRAY v_scopes LOOP
    UPDATE private.hl_security_ip_blocks b
    SET blocked_until=greatest(b.blocked_at+interval '1 microsecond',v_now),
        updated_at=v_now,
        block_reason=left(b.block_reason||' · manually released',180)
    WHERE b.scope=v_scope AND b.ip_address=v_ip AND b.blocked_until>v_now;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_count := v_count + v_rows;
  END LOOP;

  INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,details)
  VALUES(auth.uid(),'security_ip_block_released','security_ip',pg_catalog.host(v_ip),
    pg_catalog.jsonb_build_object('scope',p_scope,'released_rows',v_count));

  RETURN pg_catalog.jsonb_build_object('ok',true,'ip_address',pg_catalog.host(v_ip),'scope',p_scope,'released_rows',v_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_admin_add_security_ip_block(text,text,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_add_security_ip_block(text,text,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_release_security_ip_block(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_release_security_ip_block(text,text) TO authenticated;

-- Return coarse location columns to the active-block directory as well.
-- This replaces the existing RPC with the same signature; it creates no table or extra writes.
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
REVOKE ALL ON FUNCTION public.platform_admin_list_security_ip_blocks(text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_security_ip_blocks(text,integer,integer) TO authenticated;

-- Re-apply the known Run37 job under the same name. cron.schedule updates that job instead of duplicating it.
DO $run44_retention_schedule$
DECLARE
  v_timezone text := lower(coalesce(nullif(current_setting('cron.timezone', true), ''), 'GMT'));
  v_schedule text;
BEGIN
  IF v_timezone IN ('utc','gmt','etc/utc','etc/gmt') THEN
    v_schedule := '15 21 * * *';
  ELSIF v_timezone IN ('asia/dhaka','asia/dacca') THEN
    v_schedule := '15 3 * * *';
  ELSE
    RAISE EXCEPTION 'Run44 stopped safely: cron.timezone changed during migration. No changes were committed.';
  END IF;
  PERFORM cron.schedule(
    'hostel-life-platform-log-retention-30d',
    v_schedule,
    'SELECT private.hl_prune_platform_logs();'
  );
END;
$run44_retention_schedule$;



-- Keep IP-block rows for at most 30 days from last update, without deleting active blocks.
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
  WHERE blocked_until <= v_now
    AND updated_at < v_now - interval '30 days';
  GET DIAGNOSTICS v_blocks = ROW_COUNT;

  -- Short-lived IP counters are only rate-limit state, not the Security Monitor timeline.
  DELETE FROM private.hl_password_reset_ip_attempts
  WHERE requested_at < v_now - interval '48 hours';
  GET DIAGNOSTICS v_reset_ip = ROW_COUNT;

  -- Keep HMAC-only quota history long enough for the five-per-calendar-month guard.
  DELETE FROM private.password_reset_request_log
  WHERE requested_at < v_now - interval '35 days';
  GET DIAGNOSTICS v_reset_quota = ROW_COUNT;

  DELETE FROM private.hl_geo_proxy_nonces
  WHERE expires_at < v_now;
  GET DIAGNOSTICS v_geo_nonces = ROW_COUNT;

  -- Canonical platform_audit_log remains a separate administrative audit trail.
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

-- Read-only health for signup OTP telemetry. The actual event writer remains the Run40 RPC.
CREATE OR REPLACE FUNCTION public.hl_signup_otp_writer_health_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'otp_resend_writer_ready', to_regprocedure('public.hl_consume_signup_otp_resend(text,text,inet,text,text,text,text,text,text)') IS NOT NULL,
    'event_table_ready', to_regclass('private.hl_security_events') IS NOT NULL,
    'attempt_email_column_ready', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='attempt_email'
    ),
    'retention_job_active', EXISTS (
      SELECT 1 FROM cron.job WHERE jobname='hostel-life-platform-log-retention-30d' AND active
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.hl_signup_otp_writer_health_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hl_signup_otp_writer_health_v1() TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
