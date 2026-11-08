-- Hostel Life Run38: link verified successful login events to an account identity.
-- Additive and narrowly scoped to Security Monitor. Existing events remain unchanged;
-- failed attempts continue to store only an HMAC identity reference, never raw email.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $run38_preflight$
BEGIN
  IF to_regclass('private.hl_security_events') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Run38 stopped: security events, profiles, or Auth users table is missing. No changes were committed.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='identity_fingerprint'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='created_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='full_name'
  ) THEN
    RAISE EXCEPTION 'Run38 stopped: expected identity/profile columns are missing. No changes were committed.';
  END IF;
  IF to_regprocedure('public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'Run38 stopped: Run36 Security Monitor reader is missing. No changes were committed.';
  END IF;
END;
$run38_preflight$;

ALTER TABLE private.hl_security_events
  ADD COLUMN IF NOT EXISTS actor_user_id uuid;

DO $run38_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='private.hl_security_events'::regclass
      AND conname='hl_security_events_actor_user_id_fkey'
  ) THEN
    ALTER TABLE private.hl_security_events
      ADD CONSTRAINT hl_security_events_actor_user_id_fkey
      FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END;
$run38_fk$;

ALTER TABLE private.hl_security_events
  VALIDATE CONSTRAINT hl_security_events_actor_user_id_fkey;

CREATE INDEX IF NOT EXISTS hl_security_events_actor_created_idx
  ON private.hl_security_events(actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

-- Only the Edge Function can call this RPC after validating the caller's JWT with
-- Supabase Auth. It can write exactly one kind of event: a verified login_success.
CREATE OR REPLACE FUNCTION public.hl_record_authenticated_login_v1(
  p_actor_user_id uuid,
  p_identity_fingerprint text,
  p_ip_fingerprint text,
  p_request_ip inet,
  p_user_agent text DEFAULT NULL,
  p_request_origin text DEFAULT NULL,
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
  v_ip_count integer := 0;
  v_global_count integer := 0;
  v_country text := upper(nullif(pg_catalog.btrim(coalesce(p_country_code,'')),''));
  v_city text := nullif(pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_city,'')), '[[:cntrl:]]', '', 'g'),100),'');
  v_region text := nullif(pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_region,'')), '[[:cntrl:]]', '', 'g'),100),'');
  v_region_code text := nullif(pg_catalog.left(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_region_code,'')), '[[:cntrl:]]', '', 'g'),20),'');
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=p_actor_user_id) THEN
    RAISE EXCEPTION USING MESSAGE='সফল Login-এর Auth পরিচয় যাচাই করা যায়নি।', ERRCODE='42501';
  END IF;
  IF p_identity_fingerprint IS NOT NULL AND p_identity_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING MESSAGE='Identity fingerprint সঠিক নয়।', ERRCODE='22023';
  END IF;
  IF p_ip_fingerprint IS NOT NULL AND p_ip_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING MESSAGE='IP fingerprint সঠিক নয়।', ERRCODE='22023';
  END IF;
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN v_country:=NULL; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(728194650173::bigint);
  SELECT count(*)::integer INTO v_global_count
  FROM private.hl_security_events WHERE created_at>v_now-interval '10 minutes';
  IF v_global_count>=1000 THEN
    RETURN pg_catalog.jsonb_build_object('accepted',false,'reason','global_telemetry_rate_limited');
  END IF;

  IF p_request_ip IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hostel-life-security-event:'||pg_catalog.host(p_request_ip),0));
    SELECT count(*)::integer INTO v_ip_count
    FROM private.hl_security_events
    WHERE ip_address=p_request_ip AND created_at>v_now-interval '10 minutes';
    IF v_ip_count>=60 THEN
      RETURN pg_catalog.jsonb_build_object('accepted',false,'reason','telemetry_rate_limited');
    END IF;
  END IF;

  INSERT INTO private.hl_security_events(
    event_type, actor_user_id, ip_address, ip_fingerprint, identity_fingerprint,
    user_agent, request_origin, country_code, city, region, region_code
  ) VALUES (
    'login_success', p_actor_user_id, p_request_ip, p_ip_fingerprint, p_identity_fingerprint,
    nullif(pg_catalog.left(coalesce(p_user_agent,''),512),''),
    nullif(pg_catalog.left(coalesce(p_request_origin,''),200),''),
    v_country, v_city, v_region, v_region_code
  );
  RETURN pg_catalog.jsonb_build_object('accepted',true,'actor_user_id',p_actor_user_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.hl_record_authenticated_login_v1(uuid,text,text,inet,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hl_record_authenticated_login_v1(uuid,text,text,inet,text,text,text,text,text,text) TO service_role;

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
      'actor_user_id',e.actor_user_id,
      'actor_name',(SELECT nullif(pg_catalog.btrim(p.full_name),'') FROM public.profiles p WHERE p.id=e.actor_user_id),
      'actor_verified',e.actor_user_id IS NOT NULL,
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


-- A read-only health RPC avoids deliberately raising errors on every panel refresh.
CREATE OR REPLACE FUNCTION public.hl_security_monitor_writer_health_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'telemetry_writer_ready', to_regprocedure('public.hl_record_public_security_event_v3(text,text,text,inet,text,text,text,text,text,text,text)') IS NOT NULL,
    'authenticated_login_writer_ready', to_regprocedure('public.hl_record_authenticated_login_v1(uuid,text,text,inet,text,text,text,text,text,text)') IS NOT NULL,
    'event_table_ready', to_regclass('private.hl_security_events') IS NOT NULL,
    'actor_column_ready', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='actor_user_id'
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.hl_security_monitor_writer_health_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hl_security_monitor_writer_health_v1() TO service_role;

REVOKE ALL ON FUNCTION public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;

-- Run supabase/verify/Verify_Run38_security_monitor_actor_identity.sql after commit.
-- Historical events are intentionally not backfilled because their original email
-- address was never stored. New successful logins show the verified profile name;
-- failed login attempts continue to show only an irreversible identity reference.
