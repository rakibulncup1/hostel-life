-- Hostel Life — Run36: optional IP-derived city/region metadata for Auth monitoring.
-- Additive only. Keeps Run35 RPCs available for older deployments.
-- Stores optional city/region request metadata when headers are present. These labels are
-- display-only and must not be used for access control; no GPS coordinates,
-- postal codes, or browser-supplied location fields are collected.
-- Apply only after a verified backup and Run35 verification.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $run36_preflight$
BEGIN
  IF to_regclass('private.hl_security_events') IS NULL
     OR to_regclass('private.hl_security_ip_blocks') IS NULL
     OR to_regclass('private.hl_password_reset_ip_attempts') IS NULL THEN
    RAISE EXCEPTION 'Run36 stopped: Run35 security tables are missing. No changes were committed.';
  END IF;
  IF to_regprocedure('public.hl_record_public_security_event_v2(text,text,text,inet,text,text,text,text)') IS NULL
     OR to_regprocedure('public.hl_consume_password_reset_ip_request(inet,text)') IS NULL
     OR to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'Run36 stopped: Run35 RPC/authorization dependencies are missing. No changes were committed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('private','hl_security_events','id'),
      ('private','hl_security_events','event_type'),
      ('private','hl_security_events','ip_address'),
      ('private','hl_security_events','ip_fingerprint'),
      ('private','hl_security_events','identity_fingerprint'),
      ('private','hl_security_events','failure_code'),
      ('private','hl_security_events','user_agent'),
      ('private','hl_security_events','request_origin'),
      ('private','hl_security_events','country_code'),
      ('private','hl_security_events','created_at'),
      ('private','hl_security_ip_blocks','scope'),
      ('private','hl_security_ip_blocks','ip_address'),
      ('private','hl_security_ip_blocks','block_reason'),
      ('private','hl_security_ip_blocks','country_code'),
      ('private','hl_security_ip_blocks','attempt_count'),
      ('private','hl_security_ip_blocks','blocked_at'),
      ('private','hl_security_ip_blocks','blocked_until'),
      ('private','hl_security_ip_blocks','last_attempt_at'),
      ('private','hl_security_ip_blocks','updated_at'),
      ('private','hl_password_reset_ip_attempts','ip_address'),
      ('private','hl_password_reset_ip_attempts','requested_at')
    ) AS required(schema_name,table_name,column_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema=required.schema_name
        AND c.table_name=required.table_name
        AND c.column_name=required.column_name
    )
  ) THEN
    RAISE EXCEPTION 'Run36 stopped: one or more Run35 security columns are missing. No changes were committed.';
  END IF;
END;
$run36_preflight$;

-- 1. Add nullable geo fields. Existing rows remain unchanged and are not backfilled.
ALTER TABLE private.hl_security_events
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS region_code text;

ALTER TABLE private.hl_security_ip_blocks
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS region_code text;

ALTER TABLE private.hl_password_reset_ip_attempts
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS region_code text;

CREATE INDEX IF NOT EXISTS hl_security_events_city_created_idx
  ON private.hl_security_events(city, created_at DESC) WHERE city IS NOT NULL;
CREATE INDEX IF NOT EXISTS hl_security_events_region_created_idx
  ON private.hl_security_events(region, created_at DESC) WHERE region IS NOT NULL;

-- 2. Geo-aware Auth event writer. It preserves the Run35 locking, threshold and
--    telemetry caps, while storing optional Cloudflare visitor-location headers.
CREATE OR REPLACE FUNCTION public.hl_record_public_security_event_v3(
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
  p_region_code text
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
    IF p_event_type IN ('login_failed','signup_failed') THEN
      SELECT count(*)::integer INTO v_recent_failed_count
        FROM private.hl_security_events
        WHERE ip_address=p_request_ip
          AND event_type IN ('login_failed','signup_failed')
          AND created_at>v_now-interval '1 minute';
      IF v_recent_failed_count >= 5 THEN
        v_block_until:=v_now+interval '15 minutes';
        INSERT INTO private.hl_security_ip_blocks(
          scope,ip_address,block_reason,country_code,city,region,region_code,
          attempt_count,blocked_at,blocked_until,last_attempt_at,updated_at
        ) VALUES(
          'auth',p_request_ip,'more_than_5_failed_auth_attempts_per_minute',v_country,v_city,v_region,v_region_code,
          v_recent_failed_count+1,v_now,v_block_until,v_now,v_now
        )
        ON CONFLICT(scope,ip_address) DO UPDATE SET
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
    failure_code,user_agent,request_origin,country_code,city,region,region_code
  ) VALUES(
    p_event_type,p_request_ip,p_ip_fingerprint,p_identity_fingerprint,
    nullif(pg_catalog.left(coalesce(p_failure_code,''),40),''),
    nullif(pg_catalog.left(coalesce(p_user_agent,''),512),''),
    nullif(pg_catalog.left(coalesce(p_request_origin,''),200),''),
    v_country,v_city,v_region,v_region_code
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

-- 3. Geo-aware Password Reset IP counter. Existing v1 remains callable by older code.
CREATE OR REPLACE FUNCTION public.hl_consume_password_reset_ip_request_v2(
  p_request_ip inet,
  p_country_code text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_region_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
    RETURN pg_catalog.jsonb_build_object('allowed',false,'protection_available',false,'reason','client_ip_unavailable');
  END IF;
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN v_country:=NULL; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hostel-life-reset-ip:'||pg_catalog.host(p_request_ip),0));

  SELECT * INTO v_block FROM private.hl_security_ip_blocks
    WHERE scope='password_reset' AND ip_address=p_request_ip AND blocked_until>v_now;
  IF FOUND THEN
    UPDATE private.hl_security_ip_blocks SET
      country_code=coalesce(v_country,country_code), city=coalesce(v_city,city),
      region=coalesce(v_region,region), region_code=coalesce(v_region_code,region_code),
      last_attempt_at=v_now, updated_at=v_now
    WHERE scope='password_reset' AND ip_address=p_request_ip;
    RETURN pg_catalog.jsonb_build_object('allowed',false,'protection_available',true,
      'reason','ip_hourly_block','blocked_until',v_block.blocked_until,
      'retry_at',v_block.blocked_until,
      'retry_after_seconds',greatest(1,ceil(extract(epoch FROM (v_block.blocked_until-v_now)))::integer));
  END IF;

  IF pg_catalog.pg_try_advisory_xact_lock(728194650174::bigint) THEN
    DELETE FROM private.hl_password_reset_ip_attempts WHERE requested_at<v_now-interval '48 hours';
  END IF;
  INSERT INTO private.hl_password_reset_ip_attempts(ip_address,country_code,city,region,region_code,requested_at)
    VALUES(p_request_ip,v_country,v_city,v_region,v_region_code,v_now);
  SELECT count(*)::integer INTO v_count FROM private.hl_password_reset_ip_attempts
    WHERE ip_address=p_request_ip AND requested_at>v_now-interval '1 hour';
  IF v_count>2 THEN
    v_block_until:=v_now+interval '1 hour';
    INSERT INTO private.hl_security_ip_blocks(
      scope,ip_address,block_reason,country_code,city,region,region_code,
      attempt_count,blocked_at,blocked_until,last_attempt_at,updated_at
    ) VALUES(
      'password_reset',p_request_ip,'more_than_2_password_reset_requests_per_hour',v_country,v_city,v_region,v_region_code,
      v_count,v_now,v_block_until,v_now,v_now
    )
    ON CONFLICT(scope,ip_address) DO UPDATE SET
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
    'remaining',greatest(0,2-v_count),'attempt_count',v_count);
END;
$function$;

-- 4. Overview adds top city/region and request-origin breakdowns.
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
    'top_countries',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('country_code',c.country_code,'events',c.total) ORDER BY c.total DESC),'[]'::jsonb) FROM (SELECT country_code,count(*) AS total FROM private.hl_security_events WHERE created_at>=pg_catalog.now()-interval '24 hours' AND country_code IS NOT NULL GROUP BY country_code ORDER BY total DESC LIMIT 10) c),
    'top_locations',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('city',g.city,'region',g.region,'region_code',g.region_code,'country_code',g.country_code,'events',g.total) ORDER BY g.total DESC),'[]'::jsonb) FROM (SELECT city,region,region_code,country_code,count(*) AS total FROM private.hl_security_events WHERE created_at>=pg_catalog.now()-interval '24 hours' AND (city IS NOT NULL OR region IS NOT NULL) GROUP BY city,region,region_code,country_code ORDER BY total DESC LIMIT 10) g),
    'top_origins',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('origin',o.request_origin,'events',o.total) ORDER BY o.total DESC),'[]'::jsonb) FROM (SELECT request_origin,count(*) AS total FROM private.hl_security_events WHERE created_at>=pg_catalog.now()-interval '24 hours' AND request_origin IS NOT NULL GROUP BY request_origin ORDER BY total DESC LIMIT 10) o),
    'last_event_at',max(created_at)
  ) INTO v FROM private.hl_security_events;
  RETURN coalesce(v,'{}'::jsonb);
END;
$function$;

-- 5. Security event directory adds city/region and a location search filter.
CREATE OR REPLACE FUNCTION public.platform_admin_list_security_events_v3(
  p_event_type text DEFAULT NULL,
  p_ip_search text DEFAULT NULL,
  p_country_code text DEFAULT NULL,
  p_location_search text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_limit integer:=least(greatest(coalesce(p_limit,30),1),100);
  v_offset integer:=least(greatest(coalesce(p_offset,0),0),1000000);
  v_type text:=nullif(left(btrim(coalesce(p_event_type,'')),40),'');
  v_ip text:=nullif(left(btrim(coalesce(p_ip_search,'')),80),'');
  v_country text:=nullif(upper(left(btrim(coalesce(p_country_code,'')),2)),'');
  v_location text:=nullif(left(btrim(coalesce(p_location_search,'')),120),'');
  v_total bigint;
  v_items jsonb;
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
    AND (v_location IS NULL OR coalesce(e.city,'') ILIKE '%'||v_location||'%' OR coalesce(e.region,'') ILIKE '%'||v_location||'%' OR coalesce(e.region_code,'') ILIKE '%'||v_location||'%')
    AND (p_from IS NULL OR e.created_at>=p_from)
    AND (p_to IS NULL OR e.created_at<p_to);
  SELECT coalesce(pg_catalog.jsonb_agg(q.item ORDER BY q.created_at DESC,q.id DESC),'[]'::jsonb) INTO v_items
  FROM (
    SELECT e.id,e.created_at,pg_catalog.jsonb_build_object(
      'id',e.id,'event_type',e.event_type,'ip_address',pg_catalog.host(e.ip_address),
      'ip_fingerprint',e.ip_fingerprint,'identity_ref',CASE WHEN e.identity_fingerprint IS NULL THEN NULL ELSE left(e.identity_fingerprint,12) END,
      'failure_code',e.failure_code,'user_agent',e.user_agent,'request_origin',e.request_origin,
      'country_code',e.country_code,'city',e.city,'region',e.region,'region_code',e.region_code,'created_at',e.created_at,
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
      AND (v_location IS NULL OR coalesce(e.city,'') ILIKE '%'||v_location||'%' OR coalesce(e.region,'') ILIKE '%'||v_location||'%' OR coalesce(e.region_code,'') ILIKE '%'||v_location||'%')
      AND (p_from IS NULL OR e.created_at>=p_from)
      AND (p_to IS NULL OR e.created_at<p_to)
    ORDER BY e.created_at DESC,e.id DESC OFFSET v_offset LIMIT v_limit
  ) q;
  RETURN pg_catalog.jsonb_build_object('items',v_items,'total_count',v_total,'limit',v_limit,'offset',v_offset,
    'has_more',(v_offset+pg_catalog.jsonb_array_length(v_items))<v_total);
END;
$function$;

-- 6. Include geo labels in the active block directory.
CREATE OR REPLACE FUNCTION public.platform_admin_list_security_ip_blocks(
  p_scope text DEFAULT NULL,p_limit integer DEFAULT 30,p_offset integer DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_limit integer:=least(greatest(coalesce(p_limit,30),1),100); v_offset integer:=greatest(coalesce(p_offset,0),0); v_total bigint; v_items jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE='শুধু Super Admin IP Block তালিকা দেখতে পারবেন।',ERRCODE='42501'; END IF;
  IF p_scope IS NOT NULL AND p_scope NOT IN ('auth','password_reset') THEN RAISE EXCEPTION USING MESSAGE='Block Scope সঠিক নয়।',ERRCODE='22023'; END IF;
  SELECT count(*) INTO v_total FROM private.hl_security_ip_blocks b WHERE b.blocked_until>pg_catalog.now() AND (p_scope IS NULL OR b.scope=p_scope);
  SELECT coalesce(pg_catalog.jsonb_agg(q.item ORDER BY q.blocked_until DESC),'[]'::jsonb) INTO v_items FROM (
    SELECT pg_catalog.jsonb_build_object('scope',b.scope,'ip_address',pg_catalog.host(b.ip_address),'block_reason',b.block_reason,
      'attempt_count',b.attempt_count,'blocked_at',b.blocked_at,'blocked_until',b.blocked_until,
      'country_code',b.country_code,'city',b.city,'region',b.region,'region_code',b.region_code) AS item,
      b.blocked_until
    FROM private.hl_security_ip_blocks b WHERE b.blocked_until>pg_catalog.now() AND (p_scope IS NULL OR b.scope=p_scope)
    ORDER BY b.blocked_until DESC OFFSET v_offset LIMIT v_limit
  ) q;
  RETURN pg_catalog.jsonb_build_object('items',v_items,'total_count',v_total,'limit',v_limit,'offset',v_offset);
END;
$function$;

-- 7. Privileges: new ingest/limiter functions are service_role-only; new reader is Super Admin.
REVOKE ALL ON FUNCTION public.hl_record_public_security_event_v3(text,text,text,inet,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hl_record_public_security_event_v3(text,text,text,inet,text,text,text,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.hl_consume_password_reset_ip_request_v2(inet,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hl_consume_password_reset_ip_request_v2(inet,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;

-- Run supabase/verify/Verify_Run36_security_geo_localhost.sql after successful commit.
-- IMPORTANT: city/region stay NULL unless request headers provide them. Unless supplied
-- through a separately authenticated proxy, these labels are unverified display metadata
-- and may be spoofed. Never use them for access control. IP geolocation is approximate, not GPS.
