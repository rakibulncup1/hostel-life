-- Hostel Life Run39: targeted improvements requested by the owner.
-- Additive migration. Never rewrites historical actor identities or financial rows.
-- Apply only after a verified backup. Production is not modified by this file.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';

DO $run39_preflight$
BEGIN
  IF to_regclass('private.hl_security_events') IS NULL OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.hostel_memberships') IS NULL OR to_regclass('public.hostels') IS NULL
     OR to_regclass('public.monthly_periods') IS NULL OR to_regclass('public.market_entries') IS NULL
     OR to_regclass('public.ledger_transactions') IS NULL OR to_regclass('public.khala_money_entries') IS NULL
     OR to_regclass('public.notifications') IS NULL OR to_regclass('public.platform_notification_preferences') IS NULL
     OR to_regclass('private.hl_security_ip_blocks') IS NULL OR to_regclass('public.meal_requests') IS NULL THEN
    RAISE EXCEPTION 'Run39 stopped: one or more expected Hostel Life tables are missing; no changes committed.';
  END IF;
  IF to_regprocedure('public.hl_record_public_security_event_v3(text,text,text,inet,text,text,text,text,text,text,text)') IS NULL
     OR to_regprocedure('public.hl_record_authenticated_login_v1(uuid,text,text,inet,text,text,text,text,text,text)') IS NULL
     OR to_regprocedure('public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer)') IS NULL
     OR to_regprocedure('private.can_manage_hostel(uuid,uuid,boolean,boolean)') IS NULL
     OR to_regprocedure('public._hl_original_manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)') IS NULL
     OR to_regprocedure('public.hl_is_auth_session_active_for_security_event(uuid,uuid)') IS NULL
     OR to_regprocedure('private.is_current_auth_session_allowed()') IS NULL
     OR to_regprocedure('public.get_my_archive_editable_periods()') IS NULL
     OR to_regprocedure('private.is_primary_manager(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Run39 stopped: the expected Run36/Run38/Run16 functions are missing or have a different signature; no changes committed.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('private','hl_security_events','event_type'),('private','hl_security_events','ip_address'),
      ('private','hl_security_events','ip_fingerprint'),('private','hl_security_events','identity_fingerprint'),
      ('private','hl_security_events','failure_code'),('private','hl_security_events','user_agent'),
      ('private','hl_security_events','request_origin'),('private','hl_security_events','country_code'),
      ('private','hl_security_events','city'),('private','hl_security_events','region'),
      ('private','hl_security_events','region_code'),('private','hl_security_events','created_at'),
      ('private','hl_security_ip_blocks','scope'),('private','hl_security_ip_blocks','ip_address'),
      ('private','hl_security_ip_blocks','block_reason'),('private','hl_security_ip_blocks','country_code'),
      ('private','hl_security_ip_blocks','city'),('private','hl_security_ip_blocks','region'),
      ('private','hl_security_ip_blocks','region_code'),('private','hl_security_ip_blocks','attempt_count'),
      ('private','hl_security_ip_blocks','blocked_at'),('private','hl_security_ip_blocks','blocked_until'),
      ('private','hl_security_ip_blocks','last_attempt_at'),('private','hl_security_ip_blocks','updated_at'),
      ('public','profiles','full_name'),('public','profiles','phone'),('public','profiles','is_blocked'),
      ('public','hostel_memberships','hostel_id'),('public','hostel_memberships','user_id'),
      ('public','hostel_memberships','status'),('public','hostel_memberships','role'),
      ('public','hostels','name'),
      ('public','monthly_periods','hostel_id'),('public','monthly_periods','label'),
      ('public','monthly_periods','start_date'),('public','monthly_periods','end_date'),
      ('public','monthly_periods','status'),('public','monthly_periods','closed_by'),
      ('public','monthly_periods','closed_at'),('public','monthly_periods','created_by'),
      ('public','market_entries','hostel_id'),('public','market_entries','period_id'),
      ('public','market_entries','entry_date'),('public','market_entries','buyer_membership_id'),
      ('public','market_entries','buyer_name_snapshot'),('public','market_entries','total_amount'),
      ('public','market_entries','credit_to_buyer'),('public','market_entries','status'),
      ('public','market_entries','created_by'),('public','market_entries','updated_by'),
      ('public','market_entries','updated_at'),('public','market_entries','voided_by'),
      ('public','ledger_transactions','hostel_id'),('public','ledger_transactions','period_id'),
      ('public','ledger_transactions','member_id'),('public','ledger_transactions','member_name_snapshot'),
      ('public','ledger_transactions','entry_date'),('public','ledger_transactions','ledger_type'),
      ('public','ledger_transactions','amount'),('public','ledger_transactions','description'),
      ('public','ledger_transactions','status'),('public','ledger_transactions','created_by'),
      ('public','ledger_transactions','updated_by'),('public','ledger_transactions','updated_at'),
      ('public','khala_money_entries','hostel_id'),('public','khala_money_entries','period_id'),
      ('public','khala_money_entries','member_id'),('public','khala_money_entries','payment_date'),
      ('public','khala_money_entries','amount'),('public','khala_money_entries','description'),
      ('public','khala_money_entries','status'),('public','khala_money_entries','created_by'),
      ('public','khala_money_entries','created_at'),('public','khala_money_entries','updated_at'),
      ('public','khala_money_entries','voided_by'),('public','khala_money_entries','void_reason'),
      ('public','notifications','hostel_id'),('public','notifications','recipient_user_id'),
      ('public','notifications','title'),('public','notifications','body'),
      ('public','notifications','created_by'),('public','notifications','notification_kind'),
      ('public','platform_notification_preferences','singleton'),
      ('public','platform_notification_preferences','market_activity_enabled'),
      ('public','platform_notification_preferences','ledger_activity_enabled'),
      ('public','meal_requests','hostel_id'),('public','meal_requests','membership_id'),
      ('public','meal_requests','status'),('public','meal_requests','reviewed_by'),
      ('public','meal_requests','review_reason')
    ) AS required(schema_name,table_name,column_name)
    LEFT JOIN information_schema.columns c
      ON c.table_schema=required.schema_name AND c.table_name=required.table_name AND c.column_name=required.column_name
    WHERE c.column_name IS NULL
  ) THEN
    RAISE EXCEPTION 'Run39 stopped: one or more expected Run35–Run38 columns are missing; no changes committed.';
  END IF;
END;
$run39_preflight$;

-- ---------------------------------------------------------------------------
-- A. Security monitor: store attempted email for new events, never passwords/OTP.
-- Existing rows remain untouched and will correctly show no historical email.
-- ---------------------------------------------------------------------------
ALTER TABLE private.hl_security_events ADD COLUMN IF NOT EXISTS attempt_email text;
CREATE INDEX IF NOT EXISTS hl_security_events_attempt_email_created_idx
  ON private.hl_security_events (lower(attempt_email), created_at DESC)
  WHERE attempt_email IS NOT NULL;
DO $run39_event_type_check$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.hl_security_events'::regclass AND conname='hl_security_events_event_type_run35_check') THEN
    ALTER TABLE private.hl_security_events DROP CONSTRAINT hl_security_events_event_type_run35_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='private.hl_security_events'::regclass AND conname='hl_security_events_event_type_run39_check') THEN
    ALTER TABLE private.hl_security_events ADD CONSTRAINT hl_security_events_event_type_run39_check
      CHECK (event_type IN ('login_failed','login_success','signup_failed','signup_submitted','signup_verified','password_reset_failed','password_reset_requested')) NOT VALID;
  END IF;
END;
$run39_event_type_check$;
ALTER TABLE private.hl_security_events VALIDATE CONSTRAINT hl_security_events_event_type_run39_check;

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

REVOKE ALL ON FUNCTION public.hl_record_public_security_event_v4(text,text,text,inet,text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hl_record_public_security_event_v4(text,text,text,inet,text,text,text,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.hl_record_authenticated_auth_event_v2(
  p_event_type text,
  p_actor_user_id uuid,
  p_session_id uuid,
  p_attempt_email text,
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
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_attempt_email,'')));
BEGIN
  IF p_event_type NOT IN ('login_success','signup_verified') THEN
    RAISE EXCEPTION USING MESSAGE='অনুমোদিত authenticated Security Event নয়।', ERRCODE='22023';
  END IF;
  IF p_actor_user_id IS NULL OR p_session_id IS NULL
     OR public.hl_is_auth_session_active_for_security_event(p_actor_user_id,p_session_id) IS NOT TRUE
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=p_actor_user_id AND pg_catalog.lower(u.email)=v_email
       AND (p_event_type <> 'signup_verified' OR u.email_confirmed_at IS NOT NULL)) THEN
    RAISE EXCEPTION USING MESSAGE='Supabase Auth-এর যাচাইকৃত পরিচয় মেলেনি।', ERRCODE='42501';
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
    event_type, actor_user_id, attempt_email, ip_address, ip_fingerprint, identity_fingerprint,
    user_agent, request_origin, country_code, city, region, region_code
  ) VALUES (
    p_event_type, p_actor_user_id, v_email, p_request_ip, p_ip_fingerprint, p_identity_fingerprint,
    nullif(pg_catalog.left(coalesce(p_user_agent,''),512),''),
    nullif(pg_catalog.left(coalesce(p_request_origin,''),200),''),
    v_country, v_city, v_region, v_region_code
  );
  RETURN pg_catalog.jsonb_build_object('accepted',true,'actor_user_id',p_actor_user_id,'event_type',p_event_type);
END;
$function$;

REVOKE ALL ON FUNCTION public.hl_record_authenticated_auth_event_v2(text,uuid,uuid,text,text,text,inet,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hl_record_authenticated_auth_event_v2(text,uuid,uuid,text,text,text,inet,text,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.platform_admin_list_security_events_v4(
  p_event_type text DEFAULT NULL,
  p_ip_search text DEFAULT NULL,
  p_country_code text DEFAULT NULL,
  p_location_search text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_base jsonb;
  v_items jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='শুধু Super Admin Security Monitoring দেখতে পারবেন।', ERRCODE='42501';
  END IF;
  v_base := public.platform_admin_list_security_events_v3(
    p_event_type,p_ip_search,p_country_code,p_location_search,p_from,p_to,p_limit,p_offset
  );
  SELECT COALESCE(pg_catalog.jsonb_agg(
    x.item || pg_catalog.jsonb_build_object(
      'attempt_email',s.attempt_email,
      'matched_user_id',u.id,
      'matched_profile_name',NULLIF(pg_catalog.btrim(p.full_name),''),
      'matched_phone',p.phone,
      'matched_memberships',COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'hostel_name',h.name,'role',m.role,'status',m.status
        ) ORDER BY m.created_at DESC)
        FROM public.hostel_memberships m
        LEFT JOIN public.hostels h ON h.id=m.hostel_id
        WHERE m.user_id=u.id
      ),'[]'::jsonb)
    ) ORDER BY x.ordinality
  ),'[]'::jsonb) INTO v_items
  FROM pg_catalog.jsonb_array_elements(COALESCE(v_base->'items','[]'::jsonb)) WITH ORDINALITY AS x(item,ordinality)
  LEFT JOIN private.hl_security_events s ON s.id=(x.item->>'id')::bigint
  LEFT JOIN auth.users u ON u.id=COALESCE(s.actor_user_id,(
    SELECT au.id FROM auth.users au WHERE s.attempt_email IS NOT NULL
      AND pg_catalog.lower(au.email)=s.attempt_email ORDER BY au.created_at LIMIT 1
  ))
  LEFT JOIN public.profiles p ON p.id=u.id;
  RETURN v_base || pg_catalog.jsonb_build_object('items',v_items);
END;
$function$;
REVOKE ALL ON FUNCTION public.platform_admin_list_security_events_v4(text,text,text,text,timestamptz,timestamptz,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_security_events_v4(text,text,text,text,timestamptz,timestamptz,integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.hl_security_monitor_writer_health_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'telemetry_writer_ready', to_regprocedure('public.hl_record_public_security_event_v4(text,text,text,inet,text,text,text,text,text,text,text,text)') IS NOT NULL,
    'authenticated_login_writer_ready', to_regprocedure('public.hl_record_authenticated_auth_event_v2(text,uuid,uuid,text,text,text,inet,text,text,text,text,text,text)') IS NOT NULL,
    'event_table_ready', to_regclass('private.hl_security_events') IS NOT NULL,
    'actor_column_ready', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='actor_user_id'),
    'attempt_email_column_ready', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='attempt_email')
  );
$function$;
REVOKE ALL ON FUNCTION public.hl_security_monitor_writer_health_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hl_security_monitor_writer_health_v1() TO service_role;

ALTER TABLE public.khala_money_entries ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.manager_update_market_entry(p_market_entry_id uuid,p_entry_date date,p_buyer_membership_id uuid,p_items jsonb,p_credit_to_buyer boolean,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_entry public.market_entries%rowtype; v_member public.hostel_memberships%rowtype; v_total numeric; v_old_total numeric; v_old jsonb;
begin
  perform private.assert_signed_in();
  select * into v_entry from public.market_entries where id=p_market_entry_id;
  if not found then raise exception using message='বাজার এন্ট্রি পাওয়া যায়নি।',errcode='P0002'; end if;
  if NOT (
    private.can_manage_hostel(v_entry.hostel_id,v_entry.period_id,false,true)
    OR private.can_manage_closed_period(v_entry.hostel_id,v_entry.period_id)
  ) THEN
    raise exception using message='এই মাসের বাজার সম্পাদনার অনুমতি নেই।',errcode='42501';
  end if;
  if v_entry.status='void' then raise exception using message='বাতিল করা বাজার এন্ট্রি সম্পাদনা করা যায় না।',errcode='55000'; end if;
  if v_entry.period_id is distinct from (select id from public.monthly_periods where id=v_entry.period_id and hostel_id=v_entry.hostel_id and status='running')
     and not exists(select 1 from public.archive_edit_permissions a where a.period_id=v_entry.period_id and a.membership_id=private.my_membership_id() and a.revoked_at is null and (a.expires_at is null or a.expires_at>now()))
     and not private.can_manage_closed_period(v_entry.hostel_id,v_entry.period_id)
     and not private.is_super_admin() then raise exception using message='পুরোনো মাসের বাজার সম্পাদনার জন্য আলাদা অনুমতি প্রয়োজন।',errcode='42501'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception using message='বাজার সংশোধনের কারণ লিখুন।',errcode='22023'; end if;
  if p_entry_date is null or p_entry_date<(select start_date from public.monthly_periods where id=v_entry.period_id) or p_entry_date>(select end_date from public.monthly_periods where id=v_entry.period_id) then raise exception using message='বাজারের তারিখ সংশ্লিষ্ট মাসের সীমার বাইরে।',errcode='22023'; end if;
  select * into v_member from public.hostel_memberships where id=p_buyer_membership_id and hostel_id=v_entry.hostel_id and status='active';
  if not found then raise exception using message='বাজারকারীর সক্রিয় সদস্য-তথ্য পাওয়া যায়নি।',errcode='P0002'; end if;
  v_old_total:=v_entry.total_amount;
  select coalesce(jsonb_agg(jsonb_build_object('item_name',item_name,'quantity',quantity,'amount',amount,'serial_no',serial_no) order by serial_no),'[]'::jsonb) into v_old from public.market_entry_items where market_entry_id=v_entry.id;
  v_total:=private.write_market_items(v_entry.id,p_items);
  update public.market_entries set entry_date=p_entry_date,buyer_membership_id=p_buyer_membership_id,buyer_name_snapshot=(select full_name from public.profiles where id=v_member.user_id),total_amount=v_total,credit_to_buyer=coalesce(p_credit_to_buyer,false),updated_by=auth.uid(),updated_at=now() where id=v_entry.id returning * into v_entry;
  perform private.sync_market_credit(v_entry.id);
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_entry.hostel_id,v_entry.period_id,auth.uid(),'update:market_entry','বাজার এন্ট্রি সংশোধন করা হয়েছে',jsonb_build_object('market_entry_id',v_entry.id,'reason',p_reason,'old_items',v_old,'new_items',p_items,'old_total',v_old_total,'new_total',v_total));
  return jsonb_build_object('market_entry_id',v_entry.id,'id',v_entry.id,'total_amount',v_total,'status','updated');
end $$;

-- Existing Run8 Archive Correction workflow now recognizes the recorded month closer.
CREATE OR REPLACE FUNCTION public.hlc_get_archive_correction_bundle(p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $hlc$
DECLARE v_period public.monthly_periods%rowtype; v_h uuid := private.my_hostel_id(); v_result jsonb;
BEGIN
 PERFORM private.assert_signed_in();
 SELECT * INTO v_period FROM public.monthly_periods WHERE id=p_period_id AND hostel_id=v_h AND status IN ('closed','archived');
 IF NOT FOUND THEN RAISE EXCEPTION 'অনুমোদিত বন্ধ মাস পাওয়া যায়নি' USING ERRCODE='42501'; END IF;
 IF NOT (private.is_primary_manager(v_h,NULL) OR private.can_manage_closed_period(v_h,p_period_id)) THEN RAISE EXCEPTION 'এই বন্ধ মাস সংশোধনের অনুমতি নেই' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
 'period',jsonb_build_object('id',v_period.id,'period_id',v_period.id,'status',v_period.status,'label',v_period.label,'start_date',v_period.start_date,'end_date',v_period.end_date),
 'final_meal',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'member_name',coalesce(p.full_name,r.member_name_snapshot,'সদস্য'),'meal_date',d.meal_date,'final_breakfast',coalesce(r.final_breakfast,0),'final_lunch',coalesce(r.final_lunch,0),'final_dinner',coalesce(r.final_dinner,0)) ORDER BY d.meal_date,p.full_name)
  FROM public.daily_meal_records r JOIN public.daily_meal_days d ON d.id=r.daily_meal_day_id LEFT JOIN public.hostel_memberships m ON m.id=r.member_id LEFT JOIN public.profiles p ON p.id=m.user_id
  WHERE r.period_id=v_period.id AND r.hostel_id=v_h AND d.period_id=v_period.id AND d.status='finalized' AND NOT r.cancelled),'[]'::jsonb),
 'market',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'entry_date',e.entry_date,'name',coalesce(e.buyer_name_snapshot,'বাজার'),'total_amount',e.total_amount,'item_count',(SELECT count(*) FROM public.market_entry_items i WHERE i.market_entry_id=e.id)) ORDER BY e.entry_date DESC)
  FROM public.market_entries e WHERE e.period_id=v_period.id AND e.hostel_id=v_h AND e.status='active'),'[]'::jsonb),
 'deposit',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'member_name',coalesce(p.full_name,l.member_name_snapshot,'সদস্য'),'entry_date',l.entry_date,'amount',l.amount) ORDER BY l.entry_date DESC)
  FROM public.ledger_transactions l LEFT JOIN public.hostel_memberships m ON m.id=l.member_id LEFT JOIN public.profiles p ON p.id=m.user_id WHERE l.period_id=v_period.id AND l.hostel_id=v_h AND l.status='active' AND l.ledger_type='deposit'),'[]'::jsonb),
 'other_expense',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'description',l.description,'entry_date',l.entry_date,'amount',abs(l.amount)) ORDER BY l.entry_date DESC)
  FROM public.ledger_transactions l WHERE l.period_id=v_period.id AND l.hostel_id=v_h AND l.status='active' AND l.ledger_type='other_expense'),'[]'::jsonb),
 'khala',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',k.id,'description',coalesce(k.description,k.member_name_snapshot,'খালার টাকা'),'payment_date',k.payment_date,'amount',k.amount) ORDER BY k.payment_date DESC)
  FROM public.khala_money_entries k WHERE k.period_id=v_period.id AND k.hostel_id=v_h AND k.status='active'),'[]'::jsonb),
 'audit',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'summary',a.summary,'action',a.action,'reason',a.details->>'reason','actor_name',coalesce(p.full_name,'ম্যানেজার'),'created_at',a.created_at) ORDER BY a.created_at DESC)
  FROM (SELECT * FROM public.archive_period_audit WHERE period_id=v_period.id AND hostel_id=v_h AND action LIKE 'hlc:%' ORDER BY created_at DESC LIMIT 100) a LEFT JOIN public.profiles p ON p.id=a.actor_user_id),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $hlc$;

CREATE OR REPLACE FUNCTION public.hlc_apply_archive_correction(p_period_id uuid,p_kind text,p_target_id uuid,p_changes jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $hlc$
DECLARE v_h uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype; v_old jsonb; v_new jsonb;
 v_amount numeric; v_b numeric; v_l numeric; v_d numeric; v_old_amount numeric; v_item_count integer;
 v_entry public.market_entries%rowtype; v_led public.ledger_transactions%rowtype; v_k public.khala_money_entries%rowtype; v_r public.daily_meal_records%rowtype;
 v_reason text:=btrim(coalesce(p_reason,'')); v_title text; v_member record; v_actor_name text;
BEGIN
 PERFORM private.assert_signed_in();
 IF NOT (private.is_primary_manager(v_h,NULL) OR private.can_manage_closed_period(v_h,p_period_id)) THEN RAISE EXCEPTION 'এই বন্ধ মাস সংশোধনের অনুমতি নেই' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_period FROM public.monthly_periods WHERE id=p_period_id AND hostel_id=v_h AND status IN ('closed','archived') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'অনুমোদিত বন্ধ মাস পাওয়া যায়নি' USING ERRCODE='42501'; END IF;
 IF length(v_reason) NOT BETWEEN 8 AND 500 OR p_target_id IS NULL OR p_kind NOT IN ('final_meal','market','deposit','other_expense','khala')
   OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'সংশোধনের কারণ বা তথ্য সঠিক নয়' USING ERRCODE='22023'; END IF;
 IF p_kind='final_meal' THEN
   IF (SELECT count(*) FROM jsonb_object_keys(p_changes))<>3 OR NOT (p_changes ?& array['final_breakfast','final_lunch','final_dinner']) THEN RAISE EXCEPTION 'শুধু তিনটি final meal field পরিবর্তন করা যাবে' USING ERRCODE='22023'; END IF;
   v_b:=(p_changes->>'final_breakfast')::numeric; v_l:=(p_changes->>'final_lunch')::numeric; v_d:=(p_changes->>'final_dinner')::numeric;
   IF v_b IS NULL OR v_l IS NULL OR v_d IS NULL OR v_b<0 OR v_l<0 OR v_d<0 OR v_b>50 OR v_l>50 OR v_d>50 OR v_b::text='NaN' OR v_l::text='NaN' OR v_d::text='NaN'
    OR v_b<>round(v_b,2) OR v_l<>round(v_l,2) OR v_d<>round(v_d,2) THEN RAISE EXCEPTION 'ফাইনাল মিল ০–৫০ এর মধ্যে, দুই দশমিক ঘর পর্যন্ত দিন' USING ERRCODE='22023'; END IF;
   SELECT r.* INTO v_r FROM public.daily_meal_records r JOIN public.daily_meal_days d ON d.id=r.daily_meal_day_id
    WHERE r.id=p_target_id AND r.period_id=p_period_id AND r.hostel_id=v_h AND NOT r.cancelled AND d.period_id=p_period_id AND d.status='finalized' FOR UPDATE OF r;
   IF NOT FOUND THEN RAISE EXCEPTION 'সংশোধনযোগ্য final meal নেই' USING ERRCODE='P0002'; END IF;
   v_old:=jsonb_build_object('final_breakfast',v_r.final_breakfast,'final_lunch',v_r.final_lunch,'final_dinner',v_r.final_dinner);
   IF v_r.final_breakfast IS NOT DISTINCT FROM v_b AND v_r.final_lunch IS NOT DISTINCT FROM v_l AND v_r.final_dinner IS NOT DISTINCT FROM v_d THEN RETURN jsonb_build_object('status','success','unchanged',true); END IF;
   UPDATE public.daily_meal_records SET final_breakfast=v_b,final_lunch=v_l,final_dinner=v_d,finalization_source='archive_correction',finalized_by=auth.uid(),finalized_at=now(),updated_by=auth.uid(),updated_at=now() WHERE id=p_target_id;
   v_new:=jsonb_build_object('final_breakfast',v_b,'final_lunch',v_l,'final_dinner',v_d);
 ELSIF p_kind='market' THEN
   IF (SELECT count(*) FROM jsonb_object_keys(p_changes))<>1 OR NOT(p_changes ? 'total_amount') THEN RAISE EXCEPTION 'শুধু total_amount পরিবর্তন করা যাবে' USING ERRCODE='22023'; END IF;
   v_amount:=(p_changes->>'total_amount')::numeric;
   SELECT * INTO v_entry FROM public.market_entries WHERE id=p_target_id AND period_id=p_period_id AND hostel_id=v_h AND status='active' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'বাজার এন্ট্রি নেই' USING ERRCODE='P0002'; END IF;
   SELECT count(*) INTO v_item_count FROM public.market_entry_items WHERE market_entry_id=p_target_id;
   IF v_item_count<>1 THEN RAISE EXCEPTION 'একাধিক/শূন্য বাজার আইটেম: শুধু টোটাল সংশোধন নিরাপদ নয়; আইটেমভিত্তিক সংশোধন দরকার' USING ERRCODE='55000'; END IF;
   v_old:=jsonb_build_object('total_amount',v_entry.total_amount);
   IF v_amount IS NULL OR v_amount<0 OR v_amount>100000000 OR v_amount::text='NaN' OR v_amount<>round(v_amount,2) THEN RAISE EXCEPTION 'টাকার পরিমাণ সঠিক নয়' USING ERRCODE='22023'; END IF;
   IF v_entry.total_amount = v_amount THEN RETURN jsonb_build_object('status','success','unchanged',true); END IF;
   UPDATE public.market_entry_items SET amount=v_amount WHERE market_entry_id=p_target_id;
   UPDATE public.market_entries SET total_amount=v_amount,updated_by=auth.uid(),updated_at=now() WHERE id=p_target_id;
   -- Existing canonical function synchronizes any buyer's credited market deposit.
   PERFORM private.sync_market_credit(p_target_id);
   v_new:=jsonb_build_object('total_amount',v_amount);
 ELSIF p_kind IN ('deposit','other_expense') THEN
   IF (SELECT count(*) FROM jsonb_object_keys(p_changes))<>1 OR NOT(p_changes ? 'amount') THEN RAISE EXCEPTION 'শুধু amount পরিবর্তন করা যাবে' USING ERRCODE='22023'; END IF;
   v_amount:=(p_changes->>'amount')::numeric;
   SELECT * INTO v_led FROM public.ledger_transactions WHERE id=p_target_id AND period_id=p_period_id AND hostel_id=v_h AND status='active'
    AND ledger_type=CASE WHEN p_kind='deposit' THEN 'deposit' ELSE 'other_expense' END FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'সংশোধনযোগ্য লেনদেন নেই' USING ERRCODE='P0002'; END IF;
   IF v_led.reference_type IS NOT NULL OR v_led.reference_id IS NOT NULL THEN RAISE EXCEPTION 'লিঙ্ক করা লেনদেন সরাসরি পরিবর্তন করা যাবে না' USING ERRCODE='55000'; END IF;
   v_old:=jsonb_build_object('amount',abs(v_led.amount));
   IF v_amount IS NULL OR v_amount>100000000 OR v_amount::text='NaN' OR v_amount<>round(v_amount,2) OR (p_kind='deposit' AND v_amount<=0) OR (p_kind='other_expense' AND v_amount<0) THEN RAISE EXCEPTION 'টাকার পরিমাণ সঠিক নয়' USING ERRCODE='22023'; END IF;
   IF abs(v_led.amount) = v_amount THEN RETURN jsonb_build_object('status','success','unchanged',true); END IF;
   UPDATE public.ledger_transactions SET amount=CASE WHEN p_kind='other_expense' THEN -v_amount ELSE v_amount END,updated_by=auth.uid(),updated_at=now(),adjustment_reason=v_reason WHERE id=p_target_id;
   v_new:=jsonb_build_object('amount',v_amount);
 ELSE
   IF (SELECT count(*) FROM jsonb_object_keys(p_changes))<>1 OR NOT(p_changes ? 'amount') THEN RAISE EXCEPTION 'শুধু amount পরিবর্তন করা যাবে' USING ERRCODE='22023'; END IF;
   v_amount:=(p_changes->>'amount')::numeric;
   SELECT * INTO v_k FROM public.khala_money_entries WHERE id=p_target_id AND period_id=p_period_id AND hostel_id=v_h AND status='active' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'খালার টাকার এন্ট্রি নেই' USING ERRCODE='P0002'; END IF;
   v_old:=jsonb_build_object('amount',v_k.amount);
   IF v_amount IS NULL OR v_amount<=0 OR v_amount>100000000 OR v_amount::text='NaN' OR v_amount<>round(v_amount,2) THEN RAISE EXCEPTION 'টাকার পরিমাণ সঠিক নয়' USING ERRCODE='22023'; END IF;
   IF v_k.amount = v_amount THEN RETURN jsonb_build_object('status','success','unchanged',true); END IF;
   UPDATE public.khala_money_entries SET amount=v_amount,updated_at=now() WHERE id=p_target_id;
   v_new:=jsonb_build_object('amount',v_amount);
 END IF;
 IF v_old IS NOT DISTINCT FROM v_new THEN RETURN jsonb_build_object('status','success','unchanged',true); END IF;
 INSERT INTO public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
 VALUES(v_h,p_period_id,auth.uid(),'hlc:'||p_kind,'বন্ধ মাসের হিসাব সংশোধন',jsonb_build_object('target_id',p_target_id,'reason',v_reason,'old',v_old,'new',v_new));
 SELECT NULLIF(pg_catalog.btrim(p.full_name),'') INTO v_actor_name FROM public.profiles p WHERE p.id=auth.uid();
 FOR v_member IN SELECT user_id FROM public.hostel_memberships WHERE hostel_id=v_h AND status='active' LOOP
   INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by,notification_kind)
   VALUES(v_h,v_member.user_id,'বন্ধ মাসের হিসাব সংশোধন · '||v_period.label,v_period.label||' মাসের হিসাব সংশোধন করেছেন '||COALESCE(v_actor_name,'মাসের দায়িত্বপ্রাপ্ত ব্যক্তি')||'। কারণ: '||left(v_reason,180),auth.uid(),'archive_correction');
 END LOOP;
 RETURN jsonb_build_object('status','success','period_id',p_period_id,'kind',p_kind,'target_id',p_target_id);
END $hlc$;
REVOKE ALL ON FUNCTION public.hlc_get_archive_correction_bundle(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.hlc_apply_archive_correction(uuid,text,uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hlc_get_archive_correction_bundle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hlc_apply_archive_correction(uuid,text,uuid,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.hl_capture_financial_editor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  -- NULL means a system/service update with no authenticated human actor; do not
  -- leave an older editor name attached to a newer system-maintained timestamp.
  NEW.updated_by := auth.uid();
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.hl_capture_financial_editor() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS hl_capture_market_editor ON public.market_entries;
CREATE TRIGGER hl_capture_market_editor BEFORE UPDATE ON public.market_entries FOR EACH ROW EXECUTE FUNCTION private.hl_capture_financial_editor();
DROP TRIGGER IF EXISTS hl_capture_ledger_editor ON public.ledger_transactions;
CREATE TRIGGER hl_capture_ledger_editor BEFORE UPDATE ON public.ledger_transactions FOR EACH ROW EXECUTE FUNCTION private.hl_capture_financial_editor();
DROP TRIGGER IF EXISTS hl_capture_khala_editor ON public.khala_money_entries;
CREATE TRIGGER hl_capture_khala_editor BEFORE UPDATE ON public.khala_money_entries FOR EACH ROW EXECUTE FUNCTION private.hl_capture_financial_editor();

create or replace function public.get_market_history_v2(p_period_id uuid default null,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period uuid:=p_period_id; v_result jsonb;
begin
  perform private.assert_signed_in();
  if v_hostel is null then return '[]'::jsonb; end if;
  if v_period is null then select id into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1; end if;
  if v_period is not null and not exists(select 1 from public.monthly_periods where id=v_period and hostel_id=v_hostel) then raise exception using message='এই মাসের বাজারের তথ্য দেখার অনুমতি নেই।',errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('market_entry_id',me.id,'id',me.id,'entry_date',me.entry_date,'period_id',me.period_id,
    'buyer_membership_id',me.buyer_membership_id,'member_id',me.buyer_membership_id,'buyer_name',coalesce(p.full_name,me.buyer_name_snapshot,'সদস্য'),
    'member_name',coalesce(p.full_name,me.buyer_name_snapshot,'সদস্য'),'total_amount',me.total_amount,'credit_to_buyer',me.credit_to_buyer,
    'status',me.status,'void_reason',me.void_reason,'created_at',me.created_at,'updated_at',me.updated_at,
    'created_by',me.created_by,'created_by_name',COALESCE(NULLIF(pg_catalog.btrim(creator.full_name),''),'নাম পাওয়া যায়নি'),
    'updated_by',me.updated_by,'updated_by_name',NULLIF(pg_catalog.btrim(editor.full_name),''),
    'voided_by',me.voided_by,'voided_by_name',NULLIF(pg_catalog.btrim(voider.full_name),''),
    'items',coalesce((select jsonb_agg(jsonb_build_object('serial_no',i.serial_no,'item_name',i.item_name,'name',i.item_name,'quantity',i.quantity,'amount',i.amount) order by i.serial_no) from public.market_entry_items i where i.market_entry_id=me.id),'[]'::jsonb)) order by me.entry_date desc,me.created_at desc),'[]'::jsonb)
  into v_result from (select * from public.market_entries where hostel_id=v_hostel and (v_period is null or period_id=v_period) order by entry_date desc,created_at desc limit greatest(1,least(coalesce(p_limit,100),2000))) me
  left join public.hostel_memberships m on m.id=me.buyer_membership_id left join public.profiles p on p.id=m.user_id
  left join public.profiles creator on creator.id=me.created_by left join public.profiles editor on editor.id=me.updated_by left join public.profiles voider on voider.id=me.voided_by;
  return v_result;
end $$;

create or replace function public.get_market_detail_v2(p_market_entry_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_entry public.market_entries%rowtype; v_result jsonb;
begin
  perform private.assert_signed_in(); select * into v_entry from public.market_entries where id=p_market_entry_id and hostel_id=v_hostel;
  if not found then raise exception using message='বাজারের বিস্তারিত পাওয়া যায়নি।',errcode='P0002'; end if;
  select jsonb_build_object('market_entry_id',v_entry.id,'id',v_entry.id,'entry_date',v_entry.entry_date,'period_id',v_entry.period_id,
    'buyer_membership_id',v_entry.buyer_membership_id,'buyer_name',coalesce(p.full_name,v_entry.buyer_name_snapshot,'সদস্য'),'member_name',coalesce(p.full_name,v_entry.buyer_name_snapshot,'সদস্য'),
    'total_amount',v_entry.total_amount,'credit_to_buyer',v_entry.credit_to_buyer,'status',v_entry.status,'void_reason',v_entry.void_reason,
    'created_at',v_entry.created_at,'updated_at',v_entry.updated_at,
    'created_by',v_entry.created_by,'created_by_name',(select NULLIF(pg_catalog.btrim(full_name),'') from public.profiles where id=v_entry.created_by),
    'updated_by',v_entry.updated_by,'updated_by_name',(select NULLIF(pg_catalog.btrim(full_name),'') from public.profiles where id=v_entry.updated_by),
    'voided_by',v_entry.voided_by,'voided_by_name',(select NULLIF(pg_catalog.btrim(full_name),'') from public.profiles where id=v_entry.voided_by),'items',coalesce((select jsonb_agg(jsonb_build_object('serial_no',i.serial_no,'item_name',i.item_name,'name',i.item_name,'quantity',i.quantity,'amount',i.amount) order by i.serial_no) from public.market_entry_items i where i.market_entry_id=v_entry.id),'[]'::jsonb))
    into v_result from (select 1) x left join public.hostel_memberships m on m.id=v_entry.buyer_membership_id left join public.profiles p on p.id=m.user_id;
  return v_result;
end $$;

create or replace function public.get_account_history_v2(
  p_period_id uuid default null,
  p_member_id uuid default null,
  p_limit integer default 200
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_hostel uuid := private.my_hostel_id();
  v_period uuid := p_period_id;
  v_result jsonb;
  v_effective_member uuid := p_member_id;
  v_can_manage boolean := false;
begin
  perform private.assert_signed_in();
  if v_hostel is null then return '[]'::jsonb; end if;

  v_can_manage := private.can_manage_hostel(v_hostel,null,false,false);
  if not v_can_manage then
    if v_effective_member is null then v_effective_member := private.my_membership_id(); end if;
    if v_effective_member is distinct from private.my_membership_id() then
      raise exception using message='শুধু নিজের লেনদেনের হিসাব দেখার অনুমতি আছে।',errcode='42501';
    end if;
  end if;

  if v_effective_member is not null and not exists(
    select 1 from public.hostel_memberships where id=v_effective_member and hostel_id=v_hostel
  ) then
    raise exception using message='এই সদস্যের লেনদেন দেখার অনুমতি নেই।',errcode='42501';
  end if;
  if v_period is not null and not exists(
    select 1 from public.monthly_periods where id=v_period and hostel_id=v_hostel
  ) then
    raise exception using message='এই মাসের হিসাব দেখার অনুমতি নেই।',errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'transaction_id',l.id,'id',l.id,'member_id',l.member_id,
    'member_name',coalesce(p.full_name,l.member_name_snapshot,'সদস্য'),
    'transaction_type',l.ledger_type,'ledger_type',l.ledger_type,'ledger_group',l.ledger_group,
    'amount',l.amount,'entry_date',l.entry_date,'description',l.description,
    'reference_type',l.reference_type,'reference_id',l.reference_id,'status',l.status,
    'created_at',l.created_at,'updated_at',l.updated_at,'source','ledger',
    'created_by',l.created_by,'created_by_name',NULLIF(pg_catalog.btrim(creator.full_name),''),
    'updated_by',l.updated_by,'updated_by_name',NULLIF(pg_catalog.btrim(editor.full_name),'')
  ) order by l.entry_date desc,l.created_at desc),'[]'::jsonb)
  into v_result
  from (
    select * from public.ledger_transactions
    where hostel_id=v_hostel and (v_period is null or period_id=v_period)
      and (v_effective_member is null or member_id=v_effective_member or (ledger_type='other_expense' and member_id is null))
    order by entry_date desc,created_at desc
    limit greatest(1,least(coalesce(p_limit,200),3000))
  ) l
  left join public.hostel_memberships m on m.id=l.member_id
  left join public.profiles p on p.id=m.user_id
  left join public.profiles creator on creator.id=l.created_by
  left join public.profiles editor on editor.id=l.updated_by;
  return v_result;
end $$;

CREATE OR REPLACE FUNCTION public.get_khala_money_history_v2(
  p_period_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_period uuid := p_period_id;
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF v_hostel IS NULL OR NOT private.can_access_hostel(v_hostel) THEN
    RAISE EXCEPTION USING message = 'এই হিসাব দেখার অনুমতি নেই।', errcode = '42501';
  END IF;
  IF v_period IS NULL THEN
    SELECT id INTO v_period FROM public.monthly_periods
    WHERE hostel_id = v_hostel AND status = 'running'
    ORDER BY start_date DESC LIMIT 1;
  END IF;
  IF v_period IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.monthly_periods WHERE id = v_period AND hostel_id = v_hostel
  ) THEN
    RAISE EXCEPTION USING message = 'এই মাসের খালার টাকার তথ্য দেখার অনুমতি নেই।', errcode = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'entry_id', k.id, 'id', k.id, 'hostel_id', k.hostel_id, 'period_id', k.period_id,
    'member_id', k.member_id,
    'member_name', COALESCE(NULLIF(NULLIF(pg_catalog.btrim(k.member_name_snapshot),''),'খালার পারিশ্রমিক'), NULLIF(pg_catalog.btrim(recipient_profile.full_name),''),'সদস্যের নাম পাওয়া যায়নি'),
    'recipient_name', COALESCE(NULLIF(NULLIF(pg_catalog.btrim(k.member_name_snapshot),''),'খালার পারিশ্রমিক'), NULLIF(pg_catalog.btrim(recipient_profile.full_name),''),'সদস্যের নাম পাওয়া যায়নি'),
    'amount', k.amount, 'entry_date', k.payment_date, 'payment_date', k.payment_date,
    'description', k.description, 'status', k.status, 'void_reason', k.void_reason,
    'created_at', k.created_at, 'updated_at', k.updated_at,
    'created_by', k.created_by,
    'created_by_name', COALESCE(NULLIF(btrim(creator.full_name), ''), 'নাম পাওয়া যায়নি'),
    'updated_by',k.updated_by,'updated_by_name',NULLIF(btrim(editor.full_name),''),
    'voided_by',k.voided_by,'voided_by_name',NULLIF(btrim(voider.full_name),'')
  ) ORDER BY k.payment_date DESC, k.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT * FROM public.khala_money_entries
    WHERE hostel_id = v_hostel AND (v_period IS NULL OR period_id = v_period)
    ORDER BY payment_date DESC, created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 200), 3000))
  ) k
  LEFT JOIN public.hostel_memberships recipient ON recipient.id = k.member_id
  LEFT JOIN public.profiles recipient_profile ON recipient_profile.id = recipient.user_id
  LEFT JOIN public.profiles creator ON creator.id = k.created_by
  LEFT JOIN public.profiles editor ON editor.id = k.updated_by
  LEFT JOIN public.profiles voider ON voider.id = k.voided_by;
  RETURN v_result;
END
$fn$;

CREATE OR REPLACE FUNCTION public.get_other_expense_history(p_period_id uuid DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_hostel uuid := private.my_hostel_id(); v_rows jsonb;
BEGIN
 PERFORM private.assert_signed_in();
 IF v_hostel IS NULL THEN RETURN '[]'::jsonb; END IF;
 IF p_period_id IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM public.monthly_periods WHERE id=p_period_id AND hostel_id=v_hostel) THEN
    RAISE EXCEPTION 'এই মাসের তথ্য দেখার অনুমতি নেই' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,'period_id',q.period_id,
    'amount',q.amount,'entry_date',q.entry_date,'description',q.description,
    'status',q.status,'ledger_type',q.ledger_type,'ledger_group',q.ledger_group,
    'created_at',q.created_at,'updated_at',q.updated_at,'created_by',q.created_by,
    'created_by_name',NULLIF(pg_catalog.btrim(creator.full_name),''),'updated_by',q.updated_by,
    'updated_by_name',NULLIF(pg_catalog.btrim(editor.full_name),''))
    ORDER BY q.entry_date DESC,q.created_at DESC),'[]'::jsonb)
 INTO v_rows FROM (
   SELECT l.id,l.period_id,l.amount,l.entry_date,l.description,l.status,l.ledger_type,l.ledger_group,l.created_at,l.updated_at,l.created_by,l.updated_by
   FROM public.ledger_transactions l WHERE l.hostel_id=v_hostel AND l.ledger_type='other_expense'
    AND (p_period_id IS NULL OR l.period_id=p_period_id)
   ORDER BY l.entry_date DESC,l.created_at DESC
   LIMIT least(greatest(coalesce(p_limit,200),1),500)
 ) q
 LEFT JOIN public.profiles creator ON creator.id=q.created_by
 LEFT JOIN public.profiles editor ON editor.id=q.updated_by;
 RETURN v_rows;
END $$;

ALTER TABLE public.monthly_periods ADD COLUMN IF NOT EXISTS khala_entry_end_date date;
-- Preserve the historical calendar month for already-closed periods whose accounting
-- end_date was shortened by the close process. No transactions are moved or rewritten.
UPDATE public.monthly_periods
SET khala_entry_end_date = (date_trunc('month',start_date::timestamp) + interval '1 month - 1 day')::date
WHERE status IN ('closed','archived') AND khala_entry_end_date IS NULL;
UPDATE public.monthly_periods
SET khala_entry_end_date = LEAST(
  (date_trunc('month',start_date::timestamp) + interval '1 month' - interval '1 day')::date,
  COALESCE(end_date,(date_trunc('month',start_date::timestamp) + interval '1 month' - interval '1 day')::date)
)
WHERE status='running' AND khala_entry_end_date IS NULL;

CREATE OR REPLACE FUNCTION private.hl_preserve_khala_entry_end_date()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF TG_OP='INSERT' OR NEW.status='running' THEN
    -- A running period may have an open-ended database end_date. Khala entries
    -- must still remain inside the calendar month represented by this period.
    NEW.khala_entry_end_date := LEAST(
      (date_trunc('month',NEW.start_date::timestamp) + interval '1 month' - interval '1 day')::date,
      COALESCE(NEW.end_date,(date_trunc('month',NEW.start_date::timestamp) + interval '1 month' - interval '1 day')::date)
    );
  ELSIF OLD.status='running' AND NEW.status IN ('closed','archived') THEN
    -- Keep the month-end horizon even though close_current_month shortens end_date.
    NEW.khala_entry_end_date := COALESCE(OLD.khala_entry_end_date,
      (date_trunc('month',NEW.start_date::timestamp) + interval '1 month' - interval '1 day')::date);
  ELSE
    NEW.khala_entry_end_date := COALESCE(NEW.khala_entry_end_date,OLD.khala_entry_end_date,
      (date_trunc('month',NEW.start_date::timestamp) + interval '1 month' - interval '1 day')::date);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.hl_preserve_khala_entry_end_date() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS hl_preserve_khala_entry_end_date_trg ON public.monthly_periods;
CREATE TRIGGER hl_preserve_khala_entry_end_date_trg BEFORE INSERT OR UPDATE OF end_date,status,start_date ON public.monthly_periods
FOR EACH ROW EXECUTE FUNCTION private.hl_preserve_khala_entry_end_date();

-- Retain the original closer's authority for this exact closed month only.

-- Former closer authority is exact-period scoped. The person must still be an
-- active, unblocked member of the same hostel and the period must remain closed.
CREATE OR REPLACE FUNCTION private.can_manage_closed_period(p_hostel_id uuid,p_period_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT private.is_current_auth_session_allowed() AND p_hostel_id IS NOT NULL AND p_period_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.monthly_periods mp
      JOIN public.hostel_memberships m ON m.hostel_id=mp.hostel_id AND m.user_id=auth.uid()
      JOIN public.profiles p ON p.id=m.user_id
      WHERE mp.id=p_period_id AND mp.hostel_id=p_hostel_id
        AND mp.status IN ('closed','archived') AND mp.closed_by=auth.uid()
        AND m.status='active' AND NOT COALESCE(p.is_blocked,false)
    );
$function$;
REVOKE ALL ON FUNCTION private.can_manage_closed_period(uuid,uuid) FROM PUBLIC,anon,authenticated;

-- Retain Run30 manager semantics, adding only the former closer's own closed period.
CREATE OR REPLACE FUNCTION private.can_manage_hostel(
  p_hostel_id uuid,p_period_id uuid DEFAULT NULL,
  p_primary_only boolean DEFAULT false,p_allow_archive boolean DEFAULT false
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.is_current_auth_session_allowed() AND (
    private.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.monthly_periods mp
      WHERE mp.hostel_id=p_hostel_id AND mp.status='running' AND (p_period_id IS NULL OR mp.id=p_period_id)
        AND (
          EXISTS (
            SELECT 1 FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
            WHERE m.id=mp.primary_manager_membership_id AND m.user_id=auth.uid()
              AND m.status='active' AND NOT p.is_blocked
          )
          OR (NOT p_primary_only AND EXISTS (
            SELECT 1 FROM public.period_assistant_managers a
            JOIN public.hostel_memberships m ON m.id=a.membership_id
            JOIN public.profiles p ON p.id=m.user_id
            WHERE a.period_id=mp.id AND m.user_id=auth.uid()
              AND m.status='active' AND NOT p.is_blocked
          ))
        )
    )
    OR (p_period_id IS NULL AND EXISTS (
      SELECT 1 FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
      WHERE m.hostel_id=p_hostel_id AND m.user_id=auth.uid() AND m.role='manager'
        AND m.status='active' AND NOT p.is_blocked
        AND NOT EXISTS (SELECT 1 FROM public.monthly_periods mp WHERE mp.hostel_id=p_hostel_id AND mp.status='running')
    ))
    OR (p_allow_archive AND EXISTS (
      SELECT 1 FROM public.archive_edit_permissions a JOIN public.hostel_memberships m ON m.id=a.membership_id
      WHERE a.hostel_id=p_hostel_id AND a.period_id=p_period_id AND a.membership_id=private.my_membership_id()
        AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>now())
        AND m.status='active' AND m.user_id=auth.uid()
    ))
  )
$$;
REVOKE ALL ON FUNCTION private.can_manage_hostel(uuid,uuid,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.can_manage_hostel(uuid,uuid,boolean,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION private.can_manage_khala_period(p_hostel_id uuid,p_period_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT private.is_current_auth_session_allowed() AND (
    private.is_super_admin()
    OR private.can_manage_hostel(p_hostel_id,p_period_id,false,true)
    OR EXISTS (
      SELECT 1 FROM public.monthly_periods mp
      JOIN public.hostel_memberships m ON m.hostel_id=mp.hostel_id AND m.user_id=auth.uid()
      JOIN public.profiles p ON p.id=m.user_id
      WHERE mp.id=p_period_id AND mp.hostel_id=p_hostel_id
        AND mp.status IN ('closed','archived') AND mp.closed_by=auth.uid()
        AND m.status='active' AND NOT COALESCE(p.is_blocked,false)
    )
  );
$function$;
REVOKE ALL ON FUNCTION private.can_manage_khala_period(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_my_archive_editable_periods()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_hostel uuid:=private.my_hostel_id(); v_member uuid:=private.my_membership_id(); v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'period_id',mp.id,'id',mp.id,'label',mp.label,'start_date',mp.start_date,'end_date',mp.end_date,
    'permission_id',a.id,'reason',COALESCE(a.reason,CASE WHEN mp.closed_by=auth.uid() THEN 'মাস বন্ধকারী ম্যানেজার' END),
    'expires_at',a.expires_at,'access_kind',CASE WHEN mp.closed_by=auth.uid() THEN 'closed_by' ELSE 'archive_grant' END,
    'manager_at_close_name',NULLIF(pg_catalog.btrim(closer.full_name),'')
  ) ORDER BY mp.start_date DESC),'[]'::jsonb) INTO v_result
  FROM public.monthly_periods mp
  LEFT JOIN public.profiles closer ON closer.id=mp.closed_by
  LEFT JOIN LATERAL (
    SELECT ap.id,ap.reason,ap.expires_at FROM public.archive_edit_permissions ap
    WHERE ap.hostel_id=mp.hostel_id AND ap.period_id=mp.id AND ap.membership_id=v_member
      AND ap.revoked_at IS NULL AND (ap.expires_at IS NULL OR ap.expires_at>pg_catalog.now())
    ORDER BY ap.created_at DESC LIMIT 1
  ) a ON true
  WHERE mp.hostel_id=v_hostel AND mp.status IN ('closed','archived')
    AND (a.id IS NOT NULL OR private.can_manage_closed_period(mp.hostel_id,mp.id));
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_my_archive_editable_periods() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_archive_editable_periods() TO authenticated;



CREATE OR REPLACE FUNCTION public.get_khala_entry_periods_v2()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_hostel uuid:=private.my_hostel_id(); v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF v_hostel IS NULL THEN RAISE EXCEPTION USING MESSAGE='মেসের তথ্য পাওয়া যায়নি।',ERRCODE='42501'; END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',mp.id,'period_id',mp.id,'label',mp.label,'start_date',mp.start_date,
    'end_date',COALESCE(mp.khala_entry_end_date,mp.end_date),'status',mp.status,
    'closed_by',mp.closed_by,'closed_at',mp.closed_at,
    'manager_at_close_name',NULLIF(pg_catalog.btrim(p.full_name),''),
    'access_kind',CASE WHEN mp.closed_by=auth.uid() THEN 'closed_by'
      WHEN mp.status='running' THEN 'current_manager' ELSE 'archive_grant' END
  ) ORDER BY mp.start_date DESC),'[]'::jsonb) INTO v_result
  FROM public.monthly_periods mp LEFT JOIN public.profiles p ON p.id=mp.closed_by
  WHERE mp.hostel_id=v_hostel AND mp.status IN ('running','closed','archived')
    AND private.can_manage_khala_period(v_hostel,mp.id);
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_khala_entry_periods_v2() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_khala_entry_periods_v2() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_khala_entry_members_v2(p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_hostel uuid; v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  SELECT hostel_id INTO v_hostel FROM public.monthly_periods WHERE id=p_period_id;
  IF v_hostel IS NULL OR NOT private.can_manage_khala_period(v_hostel,p_period_id) THEN
    RAISE EXCEPTION USING MESSAGE='এই নির্দিষ্ট মাসের সদস্য তালিকা দেখার অনুমতি নেই।',ERRCODE='42501';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'membership_id',m.id,'member_id',m.id,'member_name',COALESCE(NULLIF(pg_catalog.btrim(p.full_name),''),'সদস্য'),
    'full_name',p.full_name,'member_status',m.status,'role',m.role
  ) ORDER BY p.full_name),'[]'::jsonb) INTO v_result
  FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
  WHERE m.hostel_id=v_hostel AND m.status='active' AND NOT COALESCE(p.is_blocked,false);
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_khala_entry_members_v2(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_khala_entry_members_v2(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._hl_original_manager_add_khala_money_for_period(
  p_period_id uuid,p_member_id uuid,p_amount numeric,p_payment_date date,p_description text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_period public.monthly_periods%ROWTYPE; v_member public.hostel_memberships%ROWTYPE; v_member_name text; v_row public.khala_money_entries%ROWTYPE;
BEGIN
  PERFORM private.assert_signed_in();
  SELECT * INTO v_period FROM public.monthly_periods WHERE id=p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='মাসের তথ্য পাওয়া যায়নি।',ERRCODE='P0002'; END IF;
  IF NOT private.can_manage_khala_period(v_period.hostel_id,v_period.id) THEN
    RAISE EXCEPTION USING MESSAGE='এই নির্দিষ্ট মাসে খালার টাকা যোগ বা সংশোধনের অনুমতি নেই।',ERRCODE='42501';
  END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_amount>100000000 THEN
    RAISE EXCEPTION USING MESSAGE='খালার টাকার পরিমাণ সঠিক নয়।',ERRCODE='22023';
  END IF;
  IF p_payment_date<v_period.start_date OR p_payment_date>COALESCE(v_period.khala_entry_end_date,v_period.end_date)
     OR p_payment_date>(now() AT TIME ZONE 'Asia/Dhaka')::date THEN
    RAISE EXCEPTION USING MESSAGE='প্রদানের তারিখটি নির্বাচিত মাসের অনুমোদিত সীমার মধ্যে হতে হবে।',ERRCODE='22023';
  END IF;
  SELECT * INTO v_member FROM public.hostel_memberships WHERE id=p_member_id AND hostel_id=v_period.hostel_id AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='সক্রিয় সদস্যের তথ্য পাওয়া যায়নি।',ERRCODE='P0002'; END IF;
  SELECT NULLIF(pg_catalog.btrim(p.full_name),'') INTO v_member_name
  FROM public.profiles p WHERE p.id=v_member.user_id;
  INSERT INTO public.khala_money_entries(hostel_id,period_id,member_id,member_name_snapshot,payment_date,amount,description,created_by)
  VALUES(v_period.hostel_id,v_period.id,p_member_id,COALESCE(v_member_name,'সদস্য'),p_payment_date,round(p_amount,2),NULLIF(pg_catalog.btrim(p_description),''),auth.uid())
  RETURNING * INTO v_row;
  INSERT INTO public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
  VALUES(v_period.hostel_id,v_period.id,auth.uid(),'insert:khala_money','খালার টাকা যোগ করা হয়েছে',
    pg_catalog.jsonb_build_object('entry_id',v_row.id,'member_id',p_member_id,'amount',v_row.amount,'payment_date',v_row.payment_date,'manager_at_close',v_period.closed_by));
  RETURN pg_catalog.jsonb_build_object('entry_id',v_row.id,'id',v_row.id,'period_id',v_row.period_id,'amount',v_row.amount,'status','active');
END;
$function$;
REVOKE ALL ON FUNCTION public._hl_original_manager_add_khala_money_for_period(uuid,uuid,numeric,date,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.manager_update_khala_money(
  p_entry_id uuid,p_member_id uuid,p_amount numeric,p_payment_date date,p_description text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_row public.khala_money_entries%ROWTYPE; v_member public.hostel_memberships%ROWTYPE; v_period public.monthly_periods%ROWTYPE; v_member_name text;
BEGIN
  PERFORM private.assert_signed_in();
  SELECT * INTO v_row FROM public.khala_money_entries WHERE id=p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='খালার টাকার এন্ট্রি পাওয়া যায়নি।',ERRCODE='P0002'; END IF;
  IF NOT private.can_manage_khala_period(v_row.hostel_id,v_row.period_id) THEN
    RAISE EXCEPTION USING MESSAGE='এই নির্দিষ্ট মাসের এন্ট্রি সম্পাদনার অনুমতি নেই।',ERRCODE='42501';
  END IF;
  IF v_row.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION USING MESSAGE='বাতিল এন্ট্রি সম্পাদনা করা যাবে না।',ERRCODE='55000'; END IF;
  IF p_member_id IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_amount>100000000 THEN
    RAISE EXCEPTION USING MESSAGE='সদস্য ও টাকার পরিমাণ সঠিকভাবে দিন।',ERRCODE='22023';
  END IF;
  SELECT * INTO v_period FROM public.monthly_periods WHERE id=v_row.period_id AND hostel_id=v_row.hostel_id;
  IF NOT FOUND OR p_payment_date IS NULL OR p_payment_date<v_period.start_date
     OR p_payment_date>COALESCE(v_period.khala_entry_end_date,v_period.end_date)
     OR p_payment_date>(now() AT TIME ZONE 'Asia/Dhaka')::date THEN
    RAISE EXCEPTION USING MESSAGE='প্রদানের তারিখ নির্বাচিত মাসের অনুমোদিত সীমার মধ্যে হতে হবে।',ERRCODE='22023';
  END IF;
  SELECT * INTO v_member FROM public.hostel_memberships WHERE id=p_member_id AND hostel_id=v_row.hostel_id AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='নির্বাচিত সক্রিয় সদস্য পাওয়া যায়নি।',ERRCODE='P0002'; END IF;
  SELECT NULLIF(pg_catalog.btrim(p.full_name),'') INTO v_member_name
  FROM public.profiles p WHERE p.id=v_member.user_id;
  UPDATE public.khala_money_entries SET member_id=p_member_id,member_name_snapshot=COALESCE(v_member_name,'সদস্য'),
    amount=round(p_amount,2),payment_date=p_payment_date,
    description=NULLIF(pg_catalog.btrim(p_description),''),updated_by=auth.uid(),updated_at=pg_catalog.clock_timestamp()
  WHERE id=v_row.id;
  INSERT INTO public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
  VALUES(v_row.hostel_id,v_row.period_id,auth.uid(),'update:khala_money','খালার টাকার এন্ট্রি সংশোধন করা হয়েছে',
    pg_catalog.jsonb_build_object('entry_id',v_row.id,'old_member_id',v_row.member_id,'new_member_id',p_member_id,
      'old_amount',v_row.amount,'new_amount',round(p_amount,2),'old_payment_date',v_row.payment_date,'new_payment_date',p_payment_date,
      'manager_at_close',v_period.closed_by));
  RETURN pg_catalog.jsonb_build_object('entry_id',v_row.id,'period_id',v_row.period_id,'amount',round(p_amount,2),'status','active');
END;
$function$;
REVOKE ALL ON FUNCTION public.manager_update_khala_money(uuid,uuid,numeric,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manager_update_khala_money(uuid,uuid,numeric,date,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.manager_void_khala_money(p_entry_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_row public.khala_money_entries%ROWTYPE;
BEGIN
  PERFORM private.assert_signed_in();
  SELECT * INTO v_row FROM public.khala_money_entries WHERE id=p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='খালার টাকার এন্ট্রি পাওয়া যায়নি।',ERRCODE='P0002'; END IF;
  IF NOT private.can_manage_khala_period(v_row.hostel_id,v_row.period_id) THEN
    RAISE EXCEPTION USING MESSAGE='এই নির্দিষ্ট মাসের খালার টাকার এন্ট্রি বাতিল করার অনুমতি নেই।',ERRCODE='42501';
  END IF;
  IF v_row.status='void' THEN RAISE EXCEPTION USING MESSAGE='এন্ট্রিটি আগেই বাতিল করা হয়েছে।',ERRCODE='55000'; END IF;
  IF NULLIF(pg_catalog.btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION USING MESSAGE='বাতিলের কারণ লিখুন।',ERRCODE='22023'; END IF;
  UPDATE public.khala_money_entries SET status='void',void_reason=pg_catalog.btrim(p_reason),voided_by=auth.uid(),voided_at=pg_catalog.now(),updated_by=auth.uid(),updated_at=pg_catalog.now() WHERE id=v_row.id;
  INSERT INTO public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
  VALUES(v_row.hostel_id,v_row.period_id,auth.uid(),'update:khala_void','খালার টাকার এন্ট্রি বাতিল হয়েছে',pg_catalog.jsonb_build_object('entry_id',v_row.id,'reason',p_reason));
  RETURN pg_catalog.jsonb_build_object('entry_id',v_row.id,'status','void');
END;
$function$;
REVOKE ALL ON FUNCTION public.manager_void_khala_money(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manager_void_khala_money(uuid,text) TO authenticated;

-- The owner requested activity notifications for all active members, including the actor.
INSERT INTO public.platform_notification_preferences(singleton,market_activity_enabled,ledger_activity_enabled)
VALUES(true,true,true)
ON CONFLICT(singleton) DO UPDATE SET market_activity_enabled=true,ledger_activity_enabled=true;

CREATE OR REPLACE FUNCTION private.hl_notify_market_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_buyer text; v_actor text; v_title text; v_body text;
BEGIN
  IF NOT COALESCE((SELECT market_activity_enabled FROM public.platform_notification_preferences WHERE singleton),false) THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM 'active' THEN RETURN NEW; END IF;
  SELECT COALESCE(NULLIF(pg_catalog.btrim(p.full_name),''),NULLIF(NEW.buyer_name_snapshot,''),'একজন সদস্য') INTO v_buyer
  FROM public.hostel_memberships m LEFT JOIN public.profiles p ON p.id=m.user_id WHERE m.id=NEW.buyer_membership_id;
  v_buyer:=COALESCE(v_buyer,NULLIF(NEW.buyer_name_snapshot,''),'একজন সদস্য');
  SELECT NULLIF(pg_catalog.btrim(full_name),'') INTO v_actor FROM public.profiles WHERE id=NEW.created_by;
  v_title:='নতুন বাজার · '||v_buyer;
  v_body:=v_buyer||' এর নামে ৳'||pg_catalog.to_char(NEW.total_amount,'FM999,999,999,990.00')||' টাকার বাজার এন্ট্রি করেছেন '||COALESCE(v_actor,'একজন ম্যানেজার')||'। তারিখ: '||pg_catalog.to_char(NEW.entry_date,'DD Mon YYYY')||CASE WHEN NEW.credit_to_buyer THEN '। বাজারটি সদস্যের হিসাবে যুক্ত হয়েছে।' ELSE '। সদস্যের হিসাবে যুক্ত হয়নি।' END;
  INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by,notification_kind)
  SELECT NEW.hostel_id,m.user_id,v_title,v_body,NEW.created_by,'market_entry'
  FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
  WHERE m.hostel_id=NEW.hostel_id AND m.status='active' AND NOT COALESCE(p.is_blocked,false);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.hl_notify_market_insert() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS hl_market_notification_ins ON public.market_entries;
CREATE TRIGGER hl_market_notification_ins AFTER INSERT ON public.market_entries FOR EACH ROW EXECUTE FUNCTION private.hl_notify_market_insert();

CREATE OR REPLACE FUNCTION private.hl_notify_ledger_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_member text; v_actor text; v_title text; v_body text; v_kind text; v_amount text;
BEGIN
  IF NOT COALESCE((SELECT ledger_activity_enabled FROM public.platform_notification_preferences WHERE singleton),false) THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM 'active' OR NEW.ledger_type NOT IN ('deposit','other_expense','adjustment') THEN RETURN NEW; END IF;
  SELECT COALESCE(NULLIF(pg_catalog.btrim(p.full_name),''),NULLIF(NEW.member_name_snapshot,''),'একজন সদস্য') INTO v_member
  FROM public.hostel_memberships m LEFT JOIN public.profiles p ON p.id=m.user_id WHERE m.id=NEW.member_id;
  v_member:=COALESCE(v_member,NULLIF(NEW.member_name_snapshot,''),'মেসের হিসাব');
  SELECT NULLIF(pg_catalog.btrim(full_name),'') INTO v_actor FROM public.profiles WHERE id=NEW.created_by;
  v_amount:=pg_catalog.to_char(abs(NEW.amount),'FM999,999,999,990.00');
  IF NEW.ledger_type='deposit' THEN
    v_kind:='deposit'; v_title:='নতুন জমা · '||v_member;
    v_body:=v_member||' ৳'||v_amount||' জমা দিয়েছেন। এন্ট্রি করেছেন '||COALESCE(v_actor,'একজন ম্যানেজার')||'। তারিখ: '||pg_catalog.to_char(NEW.entry_date,'DD Mon YYYY')||CASE WHEN NULLIF(NEW.description,'') IS NOT NULL THEN '। বিবরণ: '||NEW.description ELSE '' END;
  ELSIF NEW.ledger_type='other_expense' THEN
    v_kind:='other_expense'; v_title:='নতুন খরচের হিসাব';
    v_body:='৳'||v_amount||' টাকার অন্যান্য খরচ এন্ট্রি করেছেন '||COALESCE(v_actor,'একজন ম্যানেজার')||'। তারিখ: '||pg_catalog.to_char(NEW.entry_date,'DD Mon YYYY')||CASE WHEN NULLIF(NEW.description,'') IS NOT NULL THEN '। বিবরণ: '||NEW.description ELSE '' END;
  ELSE
    v_kind:='ledger_adjustment'; v_title:='হিসাব সংশোধন · '||v_member;
    v_body:=v_member||' এর হিসাবে '||CASE WHEN NEW.amount>=0 THEN '+' ELSE '−' END||'৳'||v_amount||' সংশোধন করেছেন '||COALESCE(v_actor,'একজন ম্যানেজার')||'। তারিখ: '||pg_catalog.to_char(NEW.entry_date,'DD Mon YYYY')||CASE WHEN NULLIF(NEW.description,'') IS NOT NULL THEN '। কারণ: '||NEW.description ELSE '' END;
  END IF;
  INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by,notification_kind)
  SELECT NEW.hostel_id,m.user_id,v_title,v_body,NEW.created_by,v_kind
  FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
  WHERE m.hostel_id=NEW.hostel_id AND m.status='active' AND NOT COALESCE(p.is_blocked,false);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.hl_notify_ledger_insert() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS hl_ledger_notification_ins ON public.ledger_transactions;
CREATE TRIGGER hl_ledger_notification_ins AFTER INSERT ON public.ledger_transactions FOR EACH ROW EXECUTE FUNCTION private.hl_notify_ledger_insert();

CREATE OR REPLACE FUNCTION private.hl_notify_khala_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_member text; v_actor text; v_title text; v_body text;
BEGIN
  IF NOT COALESCE((SELECT ledger_activity_enabled FROM public.platform_notification_preferences WHERE singleton),false) THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM 'active' THEN RETURN NEW; END IF;
  SELECT COALESCE(NULLIF(pg_catalog.btrim(p.full_name),''),'একজন সদস্য') INTO v_member
  FROM public.hostel_memberships m LEFT JOIN public.profiles p ON p.id=m.user_id WHERE m.id=NEW.member_id;
  SELECT NULLIF(pg_catalog.btrim(full_name),'') INTO v_actor FROM public.profiles WHERE id=NEW.created_by;
  v_title:='খালার পারিশ্রমিক · '||COALESCE(v_member,'সদস্য');
  v_body:=COALESCE(v_member,'একজন সদস্য')||' এর নামে ৳'||pg_catalog.to_char(NEW.amount,'FM999,999,999,990.00')||' খালার পারিশ্রমিক এন্ট্রি করেছেন '||COALESCE(v_actor,'একজন ম্যানেজার')||'। তারিখ: '||pg_catalog.to_char(NEW.payment_date,'DD Mon YYYY')||CASE WHEN NULLIF(NEW.description,'') IS NOT NULL THEN '। বিবরণ: '||NEW.description ELSE '' END;
  INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by,notification_kind)
  SELECT NEW.hostel_id,m.user_id,v_title,v_body,NEW.created_by,'khala_money'
  FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
  WHERE m.hostel_id=NEW.hostel_id AND m.status='active' AND NOT COALESCE(p.is_blocked,false);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.hl_notify_khala_insert() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS hl_khala_notification_ins ON public.khala_money_entries;
CREATE TRIGGER hl_khala_notification_ins AFTER INSERT ON public.khala_money_entries FOR EACH ROW EXECUTE FUNCTION private.hl_notify_khala_insert();

CREATE OR REPLACE FUNCTION private.hl_notify_important_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_h uuid; v_title text; v_body text; v_actor uuid; v_actor_name text; v_person text;
BEGIN
  IF TG_TABLE_NAME='meal_requests' THEN
    IF TG_OP<>'UPDATE' OR NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('approved','rejected') THEN RETURN NEW; END IF;
    v_h:=NEW.hostel_id; v_actor:=NEW.reviewed_by;
    SELECT NULLIF(pg_catalog.btrim(p.full_name),'') INTO v_person FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id WHERE m.id=NEW.membership_id AND m.hostel_id=v_h;
    SELECT NULLIF(pg_catalog.btrim(full_name),'') INTO v_actor_name FROM public.profiles WHERE id=v_actor;
    v_title:=CASE WHEN NEW.status='approved' THEN 'মিল অনুরোধ অনুমোদিত' ELSE 'মিল অনুরোধ বাতিল' END;
    v_body:=COALESCE(v_person,'একজন সদস্য')||' এর মিল অনুরোধ '||CASE WHEN NEW.status='approved' THEN 'অনুমোদন' ELSE 'বাতিল' END||' করেছেন '||COALESCE(v_actor_name,'ম্যানেজার')||CASE WHEN NULLIF(NEW.review_reason,'') IS NOT NULL THEN '। কারণ: '||NEW.review_reason ELSE '।' END;
    INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by,notification_kind)
    SELECT v_h,m.user_id,v_title,v_body,v_actor,'meal_request_'||NEW.status FROM public.hostel_memberships m
    WHERE m.id=NEW.membership_id AND m.hostel_id=v_h;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='hostel_memberships' THEN
    IF TG_OP<>'INSERT' AND NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
    v_h:=NEW.hostel_id; v_actor:=auth.uid();
    SELECT NULLIF(pg_catalog.btrim(full_name),'') INTO v_person FROM public.profiles WHERE id=NEW.user_id;
    SELECT NULLIF(pg_catalog.btrim(full_name),'') INTO v_actor_name FROM public.profiles WHERE id=v_actor;
    v_title:=CASE WHEN TG_OP='INSERT' THEN 'নতুন সদস্য যুক্ত' WHEN NEW.status='active' THEN 'সদস্য সক্রিয়' WHEN TG_OP='UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN 'সদস্যের ভূমিকা পরিবর্তন' ELSE 'সদস্যের অবস্থা পরিবর্তন' END;
    v_body:=COALESCE(v_person,'একজন সদস্য')||' এর সদস্যতার তথ্য '||CASE WHEN TG_OP='INSERT' THEN 'যুক্ত করেছেন ' ELSE 'পরিবর্তন করেছেন ' END||COALESCE(v_actor_name,'মেস কর্তৃপক্ষ')||'। বর্তমান অবস্থা: '||COALESCE(NEW.status,'অজানা')||'। ভূমিকা: '||COALESCE(NEW.role,'সদস্য')||'।';
    INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by,notification_kind)
    SELECT DISTINCT m.hostel_id,m.user_id,v_title,v_body,v_actor,'membership_change'
    FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
    WHERE m.hostel_id=v_h AND m.status='active' AND NOT COALESCE(p.is_blocked,false);
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.hl_notify_important_event() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS hl_approved_meal_request_notify ON public.meal_requests;
CREATE TRIGGER hl_approved_meal_request_notify AFTER UPDATE OF status ON public.meal_requests FOR EACH ROW EXECUTE FUNCTION private.hl_notify_important_event();
DROP TRIGGER IF EXISTS hl_membership_change_notify ON public.hostel_memberships;
CREATE TRIGGER hl_membership_change_notify AFTER INSERT OR UPDATE OF status,role ON public.hostel_memberships FOR EACH ROW EXECUTE FUNCTION private.hl_notify_important_event();

CREATE OR REPLACE FUNCTION private.hl_notify_period_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_title text; v_body text; v_actor uuid; v_actor_name text; v_manager_name text; v_hostel_name text;
BEGIN
  SELECT name INTO v_hostel_name FROM public.hostels WHERE id=NEW.hostel_id;
  IF TG_OP='INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'running' THEN RETURN NEW; END IF;
    v_actor:=NEW.created_by; v_title:='নতুন মাস শুরু · '||NEW.label;
    v_body:='মেস '||COALESCE(v_hostel_name,'')||' এ '||NEW.label||' মাসের হিসাব শুরু করেছেন ';
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('closed','archived') THEN
      v_actor:=NEW.closed_by; v_title:='মাস বন্ধ · '||NEW.label;
      v_body:=NEW.label||' মাসের হিসাব বন্ধ করেছেন ';
    ELSIF NEW.primary_manager_membership_id IS DISTINCT FROM OLD.primary_manager_membership_id THEN
      v_actor:=auth.uid(); v_title:='ম্যানেজার পরিবর্তন · '||NEW.label;
      SELECT p.full_name INTO v_manager_name FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id WHERE m.id=NEW.primary_manager_membership_id;
      v_body:=NEW.label||' মাসের নতুন ম্যানেজার '||COALESCE(v_manager_name,'নাম পাওয়া যায়নি')||'। পরিবর্তন করেছেন ';
    ELSE RETURN NEW;
    END IF;
  END IF;
  SELECT NULLIF(pg_catalog.btrim(full_name),'') INTO v_actor_name FROM public.profiles WHERE id=v_actor;
  v_body:=v_body||COALESCE(v_actor_name,'মেস কর্তৃপক্ষ')||'।';
  INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by,notification_kind)
  SELECT NEW.hostel_id,m.user_id,v_title,v_body,v_actor,
    CASE WHEN v_title LIKE 'মাস বন্ধ%' THEN 'month_closed' WHEN v_title LIKE 'ম্যানেজার পরিবর্তন%' THEN 'manager_change' ELSE 'new_month' END
  FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
  WHERE m.hostel_id=NEW.hostel_id AND m.status='active' AND NOT COALESCE(p.is_blocked,false);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.hl_notify_period_lifecycle() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS hl_period_lifecycle_notify ON public.monthly_periods;
CREATE TRIGGER hl_period_lifecycle_notify AFTER INSERT OR UPDATE OF primary_manager_membership_id,status,closed_by
ON public.monthly_periods FOR EACH ROW EXECUTE FUNCTION private.hl_notify_period_lifecycle();

NOTIFY pgrst,'reload schema';
COMMIT;

-- After backup + migration: run supabase/verify/Verify_Run39_targeted_improvements.sql.
-- Geo Worker deployment and Edge Function deployment are separate, explicit steps.
