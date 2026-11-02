-- ============================================================================
-- HOSTEL LIFE V1.18 — Module 3: Activity, Presence & Security Monitoring
-- Additive, backwards-compatible migration. No existing business rows altered.
-- Apply only after reviewing and taking a fresh Master Backup.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Fail before any DDL if this is not the expected Hostel Life schema.
-- The migration remains fully transactional; a failed preflight changes nothing.
DO $preflight$
DECLARE
  v_missing text[];
  v_missing_tables text[];
BEGIN
  SELECT array_agg(required_name ORDER BY required_name)
  INTO v_missing_tables
  FROM (VALUES
    ('auth.users'),('auth.sessions'),('public.profiles'),('public.hostels'),
    ('public.hostel_memberships'),('public.monthly_periods'),('public.daily_meal_days'),
    ('public.daily_meal_records'),('public.meal_requests'),('public.market_entries'),
    ('public.market_entry_items'),('public.ledger_transactions'),('public.khala_money_entries'),
    ('public.period_assistant_managers'),('public.archive_edit_permissions'),
    ('public.notifications'),('public.platform_audit_log')
  ) AS required(required_name)
  WHERE to_regclass(required_name) IS NULL;

  IF COALESCE(array_length(v_missing_tables,1),0)>0 THEN
    RAISE EXCEPTION 'Run27 preflight failed. Required Hostel Life/Auth tables are missing: %',
      array_to_string(v_missing_tables, ', ')
      USING ERRCODE='55000';
  END IF;

  SELECT array_agg(format('%s.%s', required.table_name, required.column_name) ORDER BY required.table_name,required.column_name)
  INTO v_missing
  FROM (VALUES
    ('auth.users','id'),('auth.users','email'),('auth.users','last_sign_in_at'),
    ('auth.sessions','id'),('auth.sessions','user_id'),('auth.sessions','created_at'),('auth.sessions','ip'),
    ('public.profiles','id'),('public.profiles','full_name'),('public.profiles','phone'),
    ('public.profiles','avatar_url'),('public.profiles','role'),('public.profiles','is_blocked'),('public.profiles','flags'),
    ('public.hostels','id'),('public.hostels','name'),
    ('public.hostel_memberships','id'),('public.hostel_memberships','hostel_id'),
    ('public.hostel_memberships','user_id'),('public.hostel_memberships','role'),('public.hostel_memberships','status'),
    ('public.hostel_memberships','created_at'),('public.hostel_memberships','joined_at'),
    ('public.monthly_periods','id'),('public.monthly_periods','hostel_id'),
    ('public.daily_meal_days','id'),('public.daily_meal_days','hostel_id'),('public.daily_meal_days','period_id'),
    ('public.daily_meal_records','id'),('public.daily_meal_records','hostel_id'),
    ('public.daily_meal_records','member_id'),('public.daily_meal_records','daily_meal_day_id'),
    ('public.meal_requests','id'),('public.meal_requests','hostel_id'),('public.meal_requests','membership_id'),
    ('public.market_entries','id'),('public.market_entries','hostel_id'),('public.market_entries','buyer_membership_id'),
    ('public.market_entry_items','id'),('public.market_entry_items','market_entry_id'),
    ('public.ledger_transactions','id'),('public.ledger_transactions','hostel_id'),('public.ledger_transactions','member_id'),
    ('public.khala_money_entries','id'),('public.khala_money_entries','hostel_id'),('public.khala_money_entries','member_id'),
    ('public.period_assistant_managers','membership_id'),('public.period_assistant_managers','hostel_id'),
    ('public.archive_edit_permissions','membership_id'),('public.archive_edit_permissions','hostel_id'),
    ('public.notifications','id'),('public.notifications','hostel_id'),
    ('public.notifications','recipient_user_id'),('public.notifications','created_by'),
    ('public.platform_audit_log','actor_user_id'),('public.platform_audit_log','action'),
    ('public.platform_audit_log','target_type'),('public.platform_audit_log','target_id'),
    ('public.platform_audit_log','details'),('public.platform_audit_log','created_at')
  ) AS required(table_name,column_name)
  LEFT JOIN information_schema.columns c
    ON c.table_schema=split_part(required.table_name,'.',1)
   AND c.table_name=split_part(required.table_name,'.',2)
   AND c.column_name=required.column_name
  WHERE c.column_name IS NULL;

  IF COALESCE(array_length(v_missing,1),0)>0 THEN
    RAISE EXCEPTION 'Run27 preflight failed. Required columns are missing: %',
      array_to_string(v_missing, ', ')
      USING ERRCODE='55000';
  END IF;

  IF to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'Run27 preflight failed. Required private security helper functions are missing.'
      USING ERRCODE='55000';
  END IF;

  IF to_regprocedure('public.platform_admin_list_hostel_members_v3(uuid)') IS NOT NULL
     AND pg_get_function_result(to_regprocedure('public.platform_admin_list_hostel_members_v3(uuid)')) <> 'jsonb' THEN
    RAISE EXCEPTION 'Run27 preflight failed. Existing platform_admin_list_hostel_members_v3(uuid) has an incompatible return type.'
      USING ERRCODE='55000';
  END IF;
END;
$preflight$;

CREATE SCHEMA IF NOT EXISTS private;
-- Preserve the existing private-schema USAGE grants used by legacy RLS helpers.
-- New telemetry objects are protected independently with table/function grants.
REVOKE CREATE ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) Small presence row per Auth user. No heartbeat history is stored here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.hl_user_presence (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_login_at timestamptz,
  last_seen_at timestamptz,
  last_logout_at timestamptz,
  last_active_hostel_id uuid REFERENCES public.hostels(id) ON DELETE SET NULL,
  last_session_id text,
  last_login_ip inet,
  last_user_agent text,
  login_count bigint NOT NULL DEFAULT 0 CHECK (login_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.hl_user_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.hl_user_presence FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX IF NOT EXISTS hl_user_presence_last_seen_idx
  ON private.hl_user_presence(last_seen_at DESC NULLS LAST);

-- Track each Supabase Auth session independently. This prevents one device's
-- logout from marking another still-active device as offline.
CREATE TABLE IF NOT EXISTS private.hl_login_sessions (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hostel_id uuid REFERENCES public.hostels(id) ON DELETE SET NULL,
  logged_in_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_logout_at timestamptz,
  login_recorded boolean NOT NULL DEFAULT false,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.hl_login_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.hl_login_sessions FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX IF NOT EXISTS hl_login_sessions_user_login_idx
  ON private.hl_login_sessions(user_id, logged_in_at DESC);
CREATE INDEX IF NOT EXISTS hl_login_sessions_user_active_seen_idx
  ON private.hl_login_sessions(user_id, last_seen_at DESC)
  WHERE last_logout_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2) Activity timeline. Values/notes/financial amounts are NEVER copied.
--    Only event type, actor/subject, target and changed column names are kept.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.hl_activity_events (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  hostel_id uuid REFERENCES public.hostels(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  source_table text NOT NULL DEFAULT '',
  target_id text,
  ip_address inet,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.hl_activity_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.hl_activity_events FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX IF NOT EXISTS hl_activity_hostel_created_idx
  ON private.hl_activity_events(hostel_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS hl_activity_actor_created_idx
  ON private.hl_activity_events(hostel_id, actor_user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS hl_activity_subject_created_idx
  ON private.hl_activity_events(hostel_id, subject_user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS hl_activity_global_created_idx
  ON private.hl_activity_events(created_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- 3) App-originated auth/security telemetry. The exact email is never stored.
--    IP is restricted behind Super Admin-only RPC and pruned after 90 days.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.hl_security_events (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN (
    'login_failed','signup_failed','signup_submitted','password_reset_failed'
  )),
  ip_address inet,
  ip_fingerprint text,
  identity_fingerprint text,
  failure_code text,
  user_agent text,
  request_origin text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.hl_security_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.hl_security_events FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX IF NOT EXISTS hl_security_events_created_idx
  ON private.hl_security_events(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS hl_security_events_ip_created_idx
  ON private.hl_security_events(ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS hl_security_events_fingerprint_created_idx
  ON private.hl_security_events(identity_fingerprint, created_at DESC)
  WHERE identity_fingerprint IS NOT NULL;

-- Request IP is diagnostic context only. It is not used to authorize or block
-- any action; Supabase's own Auth rate limits/CAPTCHA remain authoritative.
CREATE OR REPLACE FUNCTION private.hl_request_ip()
RETURNS inet
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_headers jsonb;
  v_ip text;
BEGIN
  BEGIN
    v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  -- Trust only the Cloudflare ingress header; generic forwarding headers
  -- can be supplied by a client and must not be used as audit identity.
  v_ip := NULLIF(v_headers->>'cf-connecting-ip','');
  IF v_ip IS NULL THEN RETURN NULL; END IF;
  BEGIN
    RETURN v_ip::inet;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Presence RPCs. Heartbeat database writes are throttled to 10 minutes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hl_touch_my_presence()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_hostel_id uuid;
  v_session_id uuid;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_last_seen timestamptz;
  v_last_login timestamptz;
  v_last_logout timestamptz;
  v_login_count bigint := 0;
  v_latest_session uuid;
  v_latest_hostel uuid;
  v_latest_ip inet;
  v_latest_agent text;
BEGIN
  PERFORM private.assert_signed_in();
  BEGIN v_session_id := NULLIF(auth.jwt()->>'session_id','')::uuid;
  EXCEPTION WHEN OTHERS THEN v_session_id:=NULL; END;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('recorded',false,'reason','session_id_unavailable','recently_active',false);
  END IF;

  SELECT m.hostel_id INTO v_hostel_id
  FROM public.hostel_memberships m
  WHERE m.user_id=v_user_id AND m.status='active'
  ORDER BY m.created_at DESC LIMIT 1;

  -- Seed sessions already active when Module 3 is first deployed. Their true
  -- Supabase session creation timestamp/IP are used; no historical fake event.
  INSERT INTO private.hl_login_sessions(
    session_id,user_id,hostel_id,logged_in_at,last_seen_at,ip_address,user_agent
  )
  SELECT s.id,s.user_id,v_hostel_id,COALESCE(s.created_at,u.last_sign_in_at,now()),now(),
         COALESCE(private.hl_request_ip(),s.ip),NULL
  FROM auth.sessions s
  JOIN auth.users u ON u.id=s.user_id
  WHERE s.id=v_session_id AND s.user_id=v_user_id
  ON CONFLICT(session_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Keep one heartbeat write per session at most every ten minutes.
  IF v_inserted=0 THEN
    UPDATE private.hl_login_sessions
    SET last_seen_at=now(),hostel_id=COALESCE(hostel_id,v_hostel_id),
        ip_address=COALESCE(ip_address,private.hl_request_ip())
    WHERE session_id=v_session_id AND user_id=v_user_id
      AND last_logout_at IS NULL
      AND last_seen_at < now()-interval '10 minutes';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  ELSE
    v_updated := v_inserted;
  END IF;

  IF v_updated>0 THEN
    SELECT count(*),max(logged_in_at),max(last_seen_at),max(last_logout_at)
    INTO v_login_count,v_last_login,v_last_seen,v_last_logout
    FROM private.hl_login_sessions WHERE user_id=v_user_id;
    SELECT session_id,hostel_id,ip_address,user_agent
    INTO v_latest_session,v_latest_hostel,v_latest_ip,v_latest_agent
    FROM private.hl_login_sessions WHERE user_id=v_user_id
    ORDER BY logged_in_at DESC,created_at DESC LIMIT 1;
    INSERT INTO private.hl_user_presence(
      user_id,last_login_at,last_seen_at,last_logout_at,last_active_hostel_id,
      last_session_id,last_login_ip,last_user_agent,login_count,updated_at
    ) VALUES(
      v_user_id,v_last_login,v_last_seen,v_last_logout,v_latest_hostel,
      v_latest_session::text,v_latest_ip,v_latest_agent,v_login_count,now()
    )
    ON CONFLICT(user_id) DO UPDATE SET
      last_login_at=GREATEST(COALESCE(private.hl_user_presence.last_login_at,EXCLUDED.last_login_at),EXCLUDED.last_login_at),
      last_seen_at=GREATEST(COALESCE(private.hl_user_presence.last_seen_at,EXCLUDED.last_seen_at),EXCLUDED.last_seen_at),
      last_logout_at=GREATEST(private.hl_user_presence.last_logout_at,EXCLUDED.last_logout_at),
      last_active_hostel_id=COALESCE(EXCLUDED.last_active_hostel_id,private.hl_user_presence.last_active_hostel_id),
      last_session_id=EXCLUDED.last_session_id,
      last_login_ip=COALESCE(EXCLUDED.last_login_ip,private.hl_user_presence.last_login_ip),
      last_user_agent=COALESCE(EXCLUDED.last_user_agent,private.hl_user_presence.last_user_agent),
      login_count=EXCLUDED.login_count,updated_at=now();
  END IF;

  SELECT last_seen_at INTO v_last_seen FROM private.hl_user_presence WHERE user_id=v_user_id;
  RETURN jsonb_build_object(
    'last_seen_at',v_last_seen,
    'recently_active',EXISTS(
      SELECT 1 FROM private.hl_login_sessions ls
      WHERE ls.user_id=v_user_id AND ls.last_logout_at IS NULL
        AND ls.last_seen_at>=now()-interval '20 minutes'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.hl_request_user_agent()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_headers jsonb;
BEGIN
  BEGIN
    v_headers := NULLIF(current_setting('request.headers',true),'')::jsonb;
    RETURN left(COALESCE(v_headers->>'user-agent',''),512);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.hl_record_my_login()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_hostel_id uuid;
  v_session_id uuid;
  v_ip inet := private.hl_request_ip();
  v_user_agent text := private.hl_request_user_agent();
  v_inserted integer := 0;
  v_loop_hostel_id uuid;
  v_any_event boolean := false;
  v_last_seen timestamptz;
  v_last_login timestamptz;
  v_last_logout timestamptz;
  v_login_count bigint := 0;
  v_latest_session uuid;
  v_latest_hostel uuid;
  v_latest_ip inet;
  v_latest_agent text;
BEGIN
  PERFORM private.assert_signed_in();
  BEGIN v_session_id := NULLIF(auth.jwt()->>'session_id','')::uuid;
  EXCEPTION WHEN OTHERS THEN v_session_id:=NULL; END;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('recorded',false,'reason','session_id_unavailable');
  END IF;

  -- Serialize duplicate callbacks for the same user/session pair.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text||':'||v_session_id::text,0));
  SELECT m.hostel_id INTO v_hostel_id
  FROM public.hostel_memberships m
  WHERE m.user_id=v_user_id AND m.status='active'
  ORDER BY m.created_at DESC LIMIT 1;

  IF v_ip IS NULL THEN
    BEGIN
      SELECT s.ip INTO v_ip FROM auth.sessions s
      WHERE s.id=v_session_id AND s.user_id=v_user_id
      ORDER BY s.created_at DESC LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_ip:=NULL;
    END;
  END IF;

  INSERT INTO private.hl_login_sessions(
    session_id,user_id,hostel_id,logged_in_at,last_seen_at,login_recorded,ip_address,user_agent
  ) VALUES(v_session_id,v_user_id,v_hostel_id,now(),now(),true,v_ip,v_user_agent)
  ON CONFLICT(session_id) DO UPDATE SET
    logged_in_at=now(),hostel_id=COALESCE(EXCLUDED.hostel_id,private.hl_login_sessions.hostel_id),
    login_recorded=true,ip_address=COALESCE(EXCLUDED.ip_address,private.hl_login_sessions.ip_address),
    user_agent=COALESCE(EXCLUDED.user_agent,private.hl_login_sessions.user_agent)
  WHERE private.hl_login_sessions.user_id=v_user_id
    AND private.hl_login_sessions.login_recorded=false
    AND private.hl_login_sessions.last_logout_at IS NULL;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted=0 THEN
    RETURN jsonb_build_object('recorded',false,'duplicate_session',true);
  END IF;

  SELECT count(*),max(logged_in_at),max(last_seen_at),max(last_logout_at)
  INTO v_login_count,v_last_login,v_last_seen,v_last_logout
  FROM private.hl_login_sessions WHERE user_id=v_user_id;
  SELECT session_id,hostel_id,ip_address,user_agent
  INTO v_latest_session,v_latest_hostel,v_latest_ip,v_latest_agent
  FROM private.hl_login_sessions WHERE user_id=v_user_id
  ORDER BY logged_in_at DESC,created_at DESC LIMIT 1;
  INSERT INTO private.hl_user_presence(
    user_id,last_login_at,last_seen_at,last_logout_at,last_active_hostel_id,
    last_session_id,last_login_ip,last_user_agent,login_count,updated_at
  ) VALUES(
    v_user_id,v_last_login,v_last_seen,v_last_logout,v_latest_hostel,
    v_latest_session::text,v_latest_ip,v_latest_agent,v_login_count,now()
  )
  ON CONFLICT(user_id) DO UPDATE SET
    last_login_at=EXCLUDED.last_login_at,
    last_seen_at=GREATEST(COALESCE(private.hl_user_presence.last_seen_at,EXCLUDED.last_seen_at),EXCLUDED.last_seen_at),
    last_active_hostel_id=COALESCE(EXCLUDED.last_active_hostel_id,private.hl_user_presence.last_active_hostel_id),
    last_session_id=EXCLUDED.last_session_id,
    last_login_ip=EXCLUDED.last_login_ip,
    last_user_agent=EXCLUDED.last_user_agent,
    login_count=EXCLUDED.login_count,updated_at=now();

  FOR v_loop_hostel_id IN
    SELECT DISTINCT m.hostel_id FROM public.hostel_memberships m
    WHERE m.user_id=v_user_id AND m.status='active'
  LOOP
    v_any_event := true;
    INSERT INTO private.hl_activity_events(
      hostel_id,actor_user_id,subject_user_id,event_type,source_table,ip_address,metadata
    ) VALUES(
      v_loop_hostel_id,v_user_id,v_user_id,'auth.login','auth',v_ip,
      jsonb_build_object('method','supabase_auth')
    );
  END LOOP;
  IF NOT v_any_event THEN
    INSERT INTO private.hl_activity_events(
      hostel_id,actor_user_id,subject_user_id,event_type,source_table,ip_address,metadata
    ) VALUES(NULL,v_user_id,v_user_id,'auth.login','auth',v_ip,
      jsonb_build_object('method','supabase_auth'));
  END IF;
  RETURN jsonb_build_object('recorded',true,'last_login_at',v_last_login,'login_count',v_login_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.hl_record_my_logout()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_hostel_id uuid;
  v_ip inet := private.hl_request_ip();
  v_updated integer := 0;
  v_last_seen timestamptz;
  v_last_login timestamptz;
  v_last_logout timestamptz;
  v_login_count bigint := 0;
  v_latest_session uuid;
  v_latest_hostel uuid;
  v_latest_ip inet;
  v_latest_agent text;
BEGIN
  PERFORM private.assert_signed_in();
  BEGIN v_session_id := NULLIF(auth.jwt()->>'session_id','')::uuid;
  EXCEPTION WHEN OTHERS THEN v_session_id:=NULL; END;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('recorded',false,'reason','session_id_unavailable');
  END IF;

  -- Ensure a session that predates Module 3 is represented before its logout.
  INSERT INTO private.hl_login_sessions(session_id,user_id,hostel_id,logged_in_at,last_seen_at,ip_address)
  SELECT s.id,s.user_id,m.hostel_id,COALESCE(s.created_at,u.last_sign_in_at,now()),now(),COALESCE(v_ip,s.ip)
  FROM auth.sessions s
  JOIN auth.users u ON u.id=s.user_id
  LEFT JOIN LATERAL (
    SELECT hm.hostel_id FROM public.hostel_memberships hm
    WHERE hm.user_id=s.user_id AND hm.status='active'
    ORDER BY hm.created_at DESC LIMIT 1
  ) m ON true
  WHERE s.id=v_session_id AND s.user_id=v_user_id
  ON CONFLICT(session_id) DO NOTHING;

  UPDATE private.hl_login_sessions
  SET last_logout_at=now(),last_seen_at=GREATEST(last_seen_at,now())
  WHERE session_id=v_session_id AND user_id=v_user_id AND last_logout_at IS NULL
  RETURNING hostel_id INTO v_hostel_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated=0 THEN
    RETURN jsonb_build_object('recorded',false,'duplicate_logout',true);
  END IF;

  SELECT count(*),max(logged_in_at),max(last_seen_at),max(last_logout_at)
  INTO v_login_count,v_last_login,v_last_seen,v_last_logout
  FROM private.hl_login_sessions WHERE user_id=v_user_id;
  SELECT session_id,hostel_id,ip_address,user_agent
  INTO v_latest_session,v_latest_hostel,v_latest_ip,v_latest_agent
  FROM private.hl_login_sessions WHERE user_id=v_user_id
  ORDER BY logged_in_at DESC,created_at DESC LIMIT 1;
  INSERT INTO private.hl_user_presence(
    user_id,last_login_at,last_seen_at,last_logout_at,last_active_hostel_id,
    last_session_id,last_login_ip,last_user_agent,login_count,updated_at
  ) VALUES(
    v_user_id,v_last_login,v_last_seen,v_last_logout,v_latest_hostel,
    v_latest_session::text,v_latest_ip,v_latest_agent,v_login_count,now()
  )
  ON CONFLICT(user_id) DO UPDATE SET
    last_login_at=EXCLUDED.last_login_at,
    last_seen_at=GREATEST(COALESCE(private.hl_user_presence.last_seen_at,EXCLUDED.last_seen_at),EXCLUDED.last_seen_at),
    last_logout_at=EXCLUDED.last_logout_at,
    last_active_hostel_id=COALESCE(EXCLUDED.last_active_hostel_id,private.hl_user_presence.last_active_hostel_id),
    last_session_id=EXCLUDED.last_session_id,
    last_login_ip=COALESCE(EXCLUDED.last_login_ip,private.hl_user_presence.last_login_ip),
    last_user_agent=COALESCE(EXCLUDED.last_user_agent,private.hl_user_presence.last_user_agent),
    login_count=EXCLUDED.login_count,updated_at=now();

  INSERT INTO private.hl_activity_events(
    hostel_id,actor_user_id,subject_user_id,event_type,source_table,ip_address
  ) VALUES(v_hostel_id,v_user_id,v_user_id,'auth.logout','auth',v_ip);
  RETURN jsonb_build_object('recorded',true,'last_logout_at',v_last_logout);
END;
$$;

-- Supabase JS signOut() defaults to global scope. Close every tracked session
-- before the Auth API revokes refresh tokens across devices.
CREATE OR REPLACE FUNCTION public.hl_record_my_global_logout()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_current_session_id uuid;
  v_hostel_id uuid;
  v_ip inet := private.hl_request_ip();
  v_hostel_ids uuid[] := ARRAY[]::uuid[];
  v_last_seen timestamptz;
  v_last_login timestamptz;
  v_last_logout timestamptz;
  v_login_count bigint := 0;
  v_latest_session uuid;
  v_latest_hostel uuid;
  v_latest_ip inet;
  v_latest_agent text;
  v_closed_count integer := 0;
BEGIN
  PERFORM private.assert_signed_in();
  BEGIN v_current_session_id := NULLIF(auth.jwt()->>'session_id','')::uuid;
  EXCEPTION WHEN OTHERS THEN v_current_session_id:=NULL; END;
  IF v_current_session_id IS NULL THEN
    RETURN jsonb_build_object('recorded',false,'reason','session_id_unavailable');
  END IF;

  SELECT m.hostel_id INTO v_hostel_id
  FROM public.hostel_memberships m
  WHERE m.user_id=v_user_id AND m.status='active'
  ORDER BY m.created_at DESC LIMIT 1;

  -- Make sure the current session is captured even if the user signs out
  -- before the first presence heartbeat has been sent.
  INSERT INTO private.hl_login_sessions(
    session_id,user_id,hostel_id,logged_in_at,last_seen_at,ip_address
  )
  SELECT s.id,s.user_id,v_hostel_id,COALESCE(s.created_at,u.last_sign_in_at,now()),now(),COALESCE(v_ip,s.ip)
  FROM auth.sessions s
  JOIN auth.users u ON u.id=s.user_id
  WHERE s.id=v_current_session_id AND s.user_id=v_user_id
  ON CONFLICT(session_id) DO NOTHING;

  WITH closed_sessions AS (
    UPDATE private.hl_login_sessions ls
    SET last_logout_at=now(),last_seen_at=GREATEST(ls.last_seen_at,now())
    WHERE ls.user_id=v_user_id AND ls.last_logout_at IS NULL
    RETURNING ls.hostel_id
  )
  SELECT COALESCE(array_agg(DISTINCT c.hostel_id) FILTER(WHERE c.hostel_id IS NOT NULL),ARRAY[]::uuid[]),count(*)::integer
  INTO v_hostel_ids,v_closed_count
  FROM closed_sessions c;

  SELECT count(*),max(logged_in_at),max(last_seen_at),max(last_logout_at)
  INTO v_login_count,v_last_login,v_last_seen,v_last_logout
  FROM private.hl_login_sessions WHERE user_id=v_user_id;
  SELECT session_id,hostel_id,ip_address,user_agent
  INTO v_latest_session,v_latest_hostel,v_latest_ip,v_latest_agent
  FROM private.hl_login_sessions WHERE user_id=v_user_id
  ORDER BY logged_in_at DESC,created_at DESC LIMIT 1;

  INSERT INTO private.hl_user_presence(
    user_id,last_login_at,last_seen_at,last_logout_at,last_active_hostel_id,
    last_session_id,last_login_ip,last_user_agent,login_count,updated_at
  ) VALUES(
    v_user_id,v_last_login,v_last_seen,v_last_logout,v_latest_hostel,
    v_latest_session::text,v_latest_ip,v_latest_agent,v_login_count,now()
  )
  ON CONFLICT(user_id) DO UPDATE SET
    last_login_at=COALESCE(EXCLUDED.last_login_at,private.hl_user_presence.last_login_at),
    last_seen_at=GREATEST(COALESCE(private.hl_user_presence.last_seen_at,EXCLUDED.last_seen_at),EXCLUDED.last_seen_at),
    last_logout_at=GREATEST(COALESCE(private.hl_user_presence.last_logout_at,EXCLUDED.last_logout_at),EXCLUDED.last_logout_at),
    last_active_hostel_id=COALESCE(EXCLUDED.last_active_hostel_id,private.hl_user_presence.last_active_hostel_id),
    last_session_id=COALESCE(EXCLUDED.last_session_id,private.hl_user_presence.last_session_id),
    last_login_ip=COALESCE(EXCLUDED.last_login_ip,private.hl_user_presence.last_login_ip),
    last_user_agent=COALESCE(EXCLUDED.last_user_agent,private.hl_user_presence.last_user_agent),
    login_count=GREATEST(private.hl_user_presence.login_count,EXCLUDED.login_count),updated_at=now();

  IF COALESCE(array_length(v_hostel_ids,1),0)>0 THEN
    FOREACH v_hostel_id IN ARRAY v_hostel_ids LOOP
      INSERT INTO private.hl_activity_events(
        hostel_id,actor_user_id,subject_user_id,event_type,source_table,ip_address
      ) VALUES(v_hostel_id,v_user_id,v_user_id,'auth.logout','auth',v_ip);
    END LOOP;
  ELSE
    INSERT INTO private.hl_activity_events(
      hostel_id,actor_user_id,subject_user_id,event_type,source_table,ip_address
    ) VALUES(v_hostel_id,v_user_id,v_user_id,'auth.logout','auth',v_ip);
  END IF;

  RETURN jsonb_build_object('recorded',true,'sessions_closed',v_closed_count,'last_logout_at',v_last_logout);
END;
$$;

CREATE OR REPLACE FUNCTION private.hl_capture_activity_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_new jsonb := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  v_row jsonb;
  v_hostel_id uuid;
  v_actor uuid := auth.uid();
  v_subject uuid;
  v_target_id text;
  v_event_type text;
  v_changed text[] := ARRAY[]::text[];
  v_membership_id uuid;
  v_details jsonb := '{}'::jsonb;
  v_profile_hostel_id uuid;
  v_linked_hostel boolean := false;
BEGIN
  v_row := CASE WHEN TG_OP='DELETE' THEN v_old ELSE v_new END;

  -- Cascades (for example Super Delete of a hostel/period) already have a
  -- top-level administrative event. Skip nested row triggers so FK cleanup
  -- cannot create misleading history or hold a reference to a deleting hostel.
  IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;

  IF TG_OP='UPDATE' THEN
    SELECT COALESCE(array_agg(k ORDER BY k),'{}'::text[]) INTO v_changed
    FROM jsonb_object_keys(v_new) AS keys(k)
    WHERE v_old->k IS DISTINCT FROM v_new->k
      AND k NOT IN ('updated_at','last_seen_at');
    IF TG_TABLE_NAME='profiles' THEN
      SELECT COALESCE(array_agg(field_name ORDER BY field_name),'{}'::text[]) INTO v_changed
      FROM unnest(v_changed) AS changed(field_name)
      WHERE field_name IN ('full_name','phone','avatar_url','role');
    END IF;
    IF COALESCE(array_length(v_changed,1),0)=0 THEN RETURN NEW; END IF;
  END IF;

  IF TG_TABLE_NAME='profiles' THEN
    BEGIN v_subject := NULLIF(v_row->>'id','')::uuid; EXCEPTION WHEN OTHERS THEN v_subject:=NULL; END;
  ELSIF TG_TABLE_NAME='notifications' THEN
    BEGIN v_subject := NULLIF(v_row->>'recipient_user_id','')::uuid; EXCEPTION WHEN OTHERS THEN v_subject:=NULL; END;
  END IF;

  IF v_hostel_id IS NULL AND v_row ? 'hostel_id' THEN
    BEGIN v_hostel_id := NULLIF(v_row->>'hostel_id','')::uuid; EXCEPTION WHEN OTHERS THEN v_hostel_id:=NULL; END;
  END IF;

  IF TG_TABLE_NAME='market_entry_items' THEN
    SELECT me.hostel_id INTO v_hostel_id FROM public.market_entries me
    WHERE me.id=NULLIF(v_row->>'market_entry_id','')::uuid;
  END IF;

  IF v_actor IS NULL THEN
    BEGIN
      v_actor := COALESCE(
        NULLIF(v_row->>'created_by','')::uuid,
        NULLIF(v_row->>'updated_by','')::uuid,
        NULLIF(v_row->>'reviewed_by','')::uuid,
        NULLIF(v_row->>'granted_by','')::uuid,
        NULLIF(v_row->>'actor_user_id','')::uuid,
        NULLIF(v_row->>'assigned_by','')::uuid
      );
    EXCEPTION WHEN OTHERS THEN v_actor:=NULL; END;
  END IF;

  BEGIN
    v_membership_id := CASE TG_TABLE_NAME
      WHEN 'daily_meal_records' THEN NULLIF(v_row->>'member_id','')::uuid
      WHEN 'meal_requests' THEN NULLIF(v_row->>'membership_id','')::uuid
      WHEN 'market_entries' THEN NULLIF(v_row->>'buyer_membership_id','')::uuid
      WHEN 'ledger_transactions' THEN NULLIF(v_row->>'member_id','')::uuid
      WHEN 'khala_money_entries' THEN NULLIF(v_row->>'member_id','')::uuid
      WHEN 'hostel_memberships' THEN NULLIF(v_row->>'id','')::uuid
      WHEN 'period_assistant_managers' THEN NULLIF(v_row->>'membership_id','')::uuid
      WHEN 'archive_edit_permissions' THEN NULLIF(v_row->>'membership_id','')::uuid
      ELSE NULL
    END;
  EXCEPTION WHEN OTHERS THEN v_membership_id:=NULL; END;
  IF v_membership_id IS NOT NULL THEN
    SELECT m.user_id INTO v_subject FROM public.hostel_memberships m WHERE m.id=v_membership_id;
  END IF;
  IF TG_TABLE_NAME='hostel_memberships' THEN
    BEGIN v_subject := NULLIF(v_row->>'user_id','')::uuid; EXCEPTION WHEN OTHERS THEN v_subject:=NULL; END;
  END IF;
  IF TG_TABLE_NAME='market_entry_items' THEN
    v_subject := NULL;
  END IF;
  IF TG_TABLE_NAME='platform_audit_log' THEN
    v_subject := NULL;
    v_details := jsonb_build_object(
      'platform_action',v_row->>'action',
      'target_type',v_row->>'target_type',
      'target_id',v_row->>'target_id'
    );
    -- Link Super Admin actions to the affected hostel/member when possible.
    -- Never assign a deleted Auth user to the FK-backed subject column.
    IF v_row->>'target_type'='user' THEN
      BEGIN v_subject := NULLIF(v_row->>'target_id','')::uuid; EXCEPTION WHEN OTHERS THEN v_subject:=NULL; END;
      IF v_subject IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=v_subject) THEN v_subject:=NULL; END IF;
      IF v_subject IS NOT NULL THEN
        SELECT m.hostel_id INTO v_hostel_id FROM public.hostel_memberships m
        WHERE m.user_id=v_subject ORDER BY m.created_at DESC LIMIT 1;
      END IF;
    ELSIF v_row->>'target_type'='hostel' THEN
      BEGIN
        v_hostel_id := NULLIF(v_row->>'target_id','')::uuid;
        IF v_hostel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.hostels h WHERE h.id=v_hostel_id) THEN v_hostel_id:=NULL; END IF;
      EXCEPTION WHEN OTHERS THEN v_hostel_id:=NULL; END;
    ELSIF v_row->>'target_type'='member' THEN
      BEGIN v_hostel_id := NULLIF(v_row->'details'->>'hostel_id','')::uuid; EXCEPTION WHEN OTHERS THEN v_hostel_id:=NULL; END;
      BEGIN v_subject := NULLIF(v_row->'details'->>'user_id','')::uuid; EXCEPTION WHEN OTHERS THEN v_subject:=NULL; END;
      IF v_subject IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=v_subject) THEN v_subject:=NULL; END IF;
      IF v_hostel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.hostels h WHERE h.id=v_hostel_id) THEN v_hostel_id:=NULL; END IF;
    ELSIF v_row->>'target_type'='monthly_periods' THEN
      BEGIN
        SELECT mp.hostel_id INTO v_hostel_id FROM public.monthly_periods mp
        WHERE mp.id=NULLIF(v_row->>'target_id','')::uuid;
      EXCEPTION WHEN OTHERS THEN v_hostel_id:=NULL; END;
    END IF;
  ELSE
    v_details := jsonb_build_object('changed_fields',to_jsonb(v_changed));
  END IF;


  v_target_id := CASE WHEN TG_TABLE_NAME='platform_audit_log' THEN v_row->>'target_id'
    ELSE COALESCE(v_row->>'id',v_row->>'period_id',v_row->>'daily_meal_day_id',v_row->>'market_entry_id') END;
  v_event_type := CASE TG_TABLE_NAME
    WHEN 'hostel_memberships' THEN 'membership.'||lower(TG_OP)
    WHEN 'monthly_periods' THEN 'period.'||lower(TG_OP)
    WHEN 'daily_meal_days' THEN 'meal_day.'||lower(TG_OP)
    WHEN 'daily_meal_records' THEN 'meal_record.'||lower(TG_OP)
    WHEN 'meal_requests' THEN 'meal_request.'||lower(TG_OP)
    WHEN 'market_entries' THEN 'market_entry.'||lower(TG_OP)
    WHEN 'market_entry_items' THEN 'market_item.'||lower(TG_OP)
    WHEN 'ledger_transactions' THEN 'ledger_entry.'||lower(TG_OP)
    WHEN 'khala_money_entries' THEN 'khala_payment.'||lower(TG_OP)
    WHEN 'period_assistant_managers' THEN 'assistant_manager.'||lower(TG_OP)
    WHEN 'archive_edit_permissions' THEN 'archive_permission.'||lower(TG_OP)
    WHEN 'notifications' THEN 'notification.sent'
    WHEN 'platform_audit_log' THEN 'platform.'||COALESCE(NULLIF(v_row->>'action',''),lower(TG_OP))
    ELSE lower(TG_TABLE_NAME)||'.'||lower(TG_OP)
  END;

  -- Profile edits (name/phone/avatar) affect the same account across all
  -- memberships. Record only changed field names, once per current hostel.
  IF TG_TABLE_NAME='profiles' THEN
    IF v_subject IS NOT NULL THEN
      FOR v_profile_hostel_id IN
        SELECT DISTINCT m.hostel_id FROM public.hostel_memberships m WHERE m.user_id=v_subject
      LOOP
        v_linked_hostel := true;
        INSERT INTO private.hl_activity_events(
          hostel_id,actor_user_id,subject_user_id,event_type,source_table,target_id,metadata
        ) VALUES(
          v_profile_hostel_id,v_actor,v_subject,v_event_type,TG_TABLE_NAME,v_target_id,v_details
        );
      END LOOP;
    END IF;
    IF NOT v_linked_hostel THEN
      INSERT INTO private.hl_activity_events(
        hostel_id,actor_user_id,subject_user_id,event_type,source_table,target_id,metadata
      ) VALUES(NULL,v_actor,v_subject,v_event_type,TG_TABLE_NAME,v_target_id,v_details);
    END IF;
    RETURN NEW;
  END IF;

  -- User-level platform actions (block/unblock/flag) apply to the account,
  -- so surface the same event in each hostel where that account is a member.
  IF TG_TABLE_NAME='platform_audit_log' AND v_row->>'target_type'='user' THEN
    IF v_subject IS NOT NULL THEN
      FOR v_profile_hostel_id IN
        SELECT DISTINCT m.hostel_id FROM public.hostel_memberships m WHERE m.user_id=v_subject
      LOOP
        v_linked_hostel := true;
        INSERT INTO private.hl_activity_events(
          hostel_id,actor_user_id,subject_user_id,event_type,source_table,target_id,metadata
        ) VALUES(
          v_profile_hostel_id,v_actor,v_subject,v_event_type,TG_TABLE_NAME,v_target_id,v_details
        );
      END LOOP;
    END IF;
    IF NOT v_linked_hostel THEN
      INSERT INTO private.hl_activity_events(
        hostel_id,actor_user_id,subject_user_id,event_type,source_table,target_id,metadata
      ) VALUES(NULL,v_actor,v_subject,v_event_type,TG_TABLE_NAME,v_target_id,v_details);
    END IF;
    RETURN NEW;
  END IF;

  -- Events without a known actor are still useful for system state transitions,
  -- but only allowlisted tables reach this trigger.
  INSERT INTO private.hl_activity_events(
    hostel_id,actor_user_id,subject_user_id,event_type,source_table,target_id,metadata
  ) VALUES(
    v_hostel_id,v_actor,v_subject,v_event_type,TG_TABLE_NAME,v_target_id,v_details
  );

  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- archive_period_audit is intentionally not double-hooked: the underlying
-- meal/market/ledger/member rows below already create the same activity event.
-- This avoids duplicate timeline entries while retaining the separate archive log.
-- Drop/create makes this migration safely re-runnable without duplicate hooks.
DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'hostel_memberships','monthly_periods','daily_meal_days','daily_meal_records',
    'meal_requests','market_entries','market_entry_items','ledger_transactions',
    'khala_money_entries','period_assistant_managers','archive_edit_permissions',
    'notifications','platform_audit_log','profiles'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS hl_activity_capture ON public.%I',v_table);
    IF v_table='profiles' THEN
      -- Profiles contain identity details. Only allowlisted profile edits are logged.
      EXECUTE 'CREATE TRIGGER hl_activity_capture AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.hl_capture_activity_event()';
    ELSIF v_table='notifications' THEN
      -- One recipient-scoped event per delivered notification; body/title stay private.
      EXECUTE 'CREATE TRIGGER hl_activity_capture AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION private.hl_capture_activity_event()';
    ELSE
      EXECUTE format('CREATE TRIGGER hl_activity_capture AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.hl_capture_activity_event()',v_table);
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Service-role-only ingest for unauthenticated login/registration attempts.
--    The Edge Function sends HMAC fingerprints; no raw email/password is kept.
-- ---------------------------------------------------------------------------
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ip_count integer := 0;
BEGIN
  IF p_event_type NOT IN ('login_failed','signup_failed','signup_submitted','password_reset_failed') THEN
    RAISE EXCEPTION USING MESSAGE='অনুমোদিত Security Event নয়।',ERRCODE='22023';
  END IF;
  IF p_identity_fingerprint IS NOT NULL AND p_identity_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING MESSAGE='Identity fingerprint সঠিক নয়।',ERRCODE='22023';
  END IF;
  IF p_ip_fingerprint IS NOT NULL AND p_ip_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING MESSAGE='IP fingerprint সঠিক নয়।',ERRCODE='22023';
  END IF;
  -- Global cap protects the telemetry table against distributed-IP floods.
  -- This cap only drops optional telemetry; it never blocks an Auth attempt.
  PERFORM pg_advisory_xact_lock(728194650173::bigint);
  IF (SELECT count(*) FROM private.hl_security_events WHERE created_at>now()-interval '10 minutes') >= 1000 THEN
    RETURN jsonb_build_object('accepted',false,'reason','global_telemetry_rate_limited');
  END IF;

  -- Some gateway/auth flows may not expose a trustworthy client IP. Keep the
  -- event and HMAC identity fingerprint anyway; simply skip the IP-only cap.
  IF p_request_ip IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(host(p_request_ip),0));
    SELECT count(*)::integer INTO v_ip_count
    FROM private.hl_security_events
    WHERE ip_address=p_request_ip AND created_at>now()-interval '10 minutes';

    -- Telemetry only: excessive callers are not blocked from Auth. Stop
    -- writing after 60 rows/10m/IP to cap abuse and storage cost.
    IF v_ip_count >= 60 THEN
      RETURN jsonb_build_object('accepted',false,'reason','telemetry_rate_limited');
    END IF;
  END IF;

  INSERT INTO private.hl_security_events(
    event_type,ip_address,ip_fingerprint,identity_fingerprint,
    failure_code,user_agent,request_origin
  ) VALUES(
    p_event_type,p_request_ip,p_ip_fingerprint,p_identity_fingerprint,
    NULLIF(left(COALESCE(p_failure_code,''),40),''),
    NULLIF(left(COALESCE(p_user_agent,''),512),''),
    NULLIF(left(COALESCE(p_request_origin,''),200),'')
  );

  DELETE FROM private.hl_security_events WHERE created_at < now()-interval '90 days';
  RETURN jsonb_build_object('accepted',true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) Super Admin read RPCs. No direct table grants; all limits are clamped.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_admin_list_hostel_members_v3(p_hostel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='শুধু Super Admin সদস্যদের তালিকা দেখতে পারবেন।',ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hostels WHERE id=p_hostel_id) THEN
    RAISE EXCEPTION USING MESSAGE='মেসটি পাওয়া যায়নি।',ERRCODE='P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'membership_id',m.id,'id',m.id,'user_id',m.user_id,'hostel_id',m.hostel_id,
    'full_name',p.full_name,'member_name',p.full_name,'phone',p.phone,'avatar_url',p.avatar_url,
    'email',(SELECT u.email FROM auth.users u WHERE u.id=m.user_id),
    'role',m.role,'status',m.status,'member_status',m.status,'is_blocked',p.is_blocked,
    'is_favorite',COALESCE((p.flags->>'favorite')::boolean,false),
    'is_trusted',COALESCE((p.flags->>'trusted')::boolean,false),
    'flags',p.flags,'joined_at',m.joined_at,
    'last_login_at',COALESCE((SELECT max(ls.logged_in_at) FROM private.hl_login_sessions ls WHERE ls.user_id=m.user_id AND ls.hostel_id=m.hostel_id),(SELECT up.last_login_at FROM private.hl_user_presence up WHERE up.user_id=m.user_id AND up.last_active_hostel_id=m.hostel_id)),
    'last_seen_at',COALESCE((SELECT max(ls.last_seen_at) FROM private.hl_login_sessions ls WHERE ls.user_id=m.user_id AND ls.hostel_id=m.hostel_id),(SELECT up.last_seen_at FROM private.hl_user_presence up WHERE up.user_id=m.user_id AND up.last_active_hostel_id=m.hostel_id)),
    'last_logout_at',COALESCE((SELECT max(ls.last_logout_at) FROM private.hl_login_sessions ls WHERE ls.user_id=m.user_id AND ls.hostel_id=m.hostel_id),(SELECT up.last_logout_at FROM private.hl_user_presence up WHERE up.user_id=m.user_id AND up.last_active_hostel_id=m.hostel_id)),
    'login_count',GREATEST((SELECT count(*) FROM private.hl_login_sessions ls WHERE ls.user_id=m.user_id AND ls.hostel_id=m.hostel_id),COALESCE((SELECT up.login_count FROM private.hl_user_presence up WHERE up.user_id=m.user_id AND up.last_active_hostel_id=m.hostel_id),0)),
    'last_login_ip',COALESCE((SELECT host(ls.ip_address) FROM private.hl_login_sessions ls WHERE ls.user_id=m.user_id AND ls.hostel_id=m.hostel_id ORDER BY ls.logged_in_at DESC,ls.created_at DESC LIMIT 1),(SELECT host(up.last_login_ip) FROM private.hl_user_presence up WHERE up.user_id=m.user_id AND up.last_active_hostel_id=m.hostel_id)),
    'is_online',EXISTS(SELECT 1 FROM private.hl_login_sessions ls WHERE ls.user_id=m.user_id AND ls.hostel_id=m.hostel_id AND ls.last_logout_at IS NULL AND ls.last_seen_at>=now()-interval '20 minutes'),
    'presence_recorded',EXISTS(SELECT 1 FROM private.hl_login_sessions ls WHERE ls.user_id=m.user_id AND ls.hostel_id=m.hostel_id)
  ) ORDER BY p.full_name),'[]'::jsonb)
  INTO v_result
  FROM public.hostel_memberships m
  JOIN public.profiles p ON p.id=m.user_id
  WHERE m.hostel_id=p_hostel_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_get_member_activity_overview(
  p_hostel_id uuid,p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE='শুধু Super Admin এই তথ্য দেখতে পারবেন।',ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hostel_memberships WHERE hostel_id=p_hostel_id AND user_id=p_user_id) THEN
    RAISE EXCEPTION USING MESSAGE='এই মেসে ব্যবহারকারীর সদস্য-রেকর্ড পাওয়া যায়নি।',ERRCODE='P0002';
  END IF;
  SELECT jsonb_build_object(
    'user_id',p_user_id,'hostel_id',p_hostel_id,
    'last_login_at',COALESCE((SELECT max(ls.logged_in_at) FROM private.hl_login_sessions ls WHERE ls.user_id=p_user_id AND ls.hostel_id=p_hostel_id),(SELECT up.last_login_at FROM private.hl_user_presence up WHERE up.user_id=p_user_id AND up.last_active_hostel_id=p_hostel_id)),
    'last_seen_at',COALESCE((SELECT max(ls.last_seen_at) FROM private.hl_login_sessions ls WHERE ls.user_id=p_user_id AND ls.hostel_id=p_hostel_id),(SELECT up.last_seen_at FROM private.hl_user_presence up WHERE up.user_id=p_user_id AND up.last_active_hostel_id=p_hostel_id)),
    'last_logout_at',COALESCE((SELECT max(ls.last_logout_at) FROM private.hl_login_sessions ls WHERE ls.user_id=p_user_id AND ls.hostel_id=p_hostel_id),(SELECT up.last_logout_at FROM private.hl_user_presence up WHERE up.user_id=p_user_id AND up.last_active_hostel_id=p_hostel_id)),
    'login_count',GREATEST((SELECT count(*) FROM private.hl_login_sessions ls WHERE ls.user_id=p_user_id AND ls.hostel_id=p_hostel_id),COALESCE((SELECT up.login_count FROM private.hl_user_presence up WHERE up.user_id=p_user_id AND up.last_active_hostel_id=p_hostel_id),0)),
    'last_login_ip',COALESCE((SELECT host(ls.ip_address) FROM private.hl_login_sessions ls WHERE ls.user_id=p_user_id AND ls.hostel_id=p_hostel_id ORDER BY ls.logged_in_at DESC,ls.created_at DESC LIMIT 1),(SELECT host(up.last_login_ip) FROM private.hl_user_presence up WHERE up.user_id=p_user_id AND up.last_active_hostel_id=p_hostel_id)),
    'last_user_agent',(SELECT ls.user_agent FROM private.hl_login_sessions ls WHERE ls.user_id=p_user_id AND ls.hostel_id=p_hostel_id ORDER BY ls.logged_in_at DESC,ls.created_at DESC LIMIT 1),
    'is_online',EXISTS(SELECT 1 FROM private.hl_login_sessions ls WHERE ls.user_id=p_user_id AND ls.hostel_id=p_hostel_id AND ls.last_logout_at IS NULL AND ls.last_seen_at>=now()-interval '20 minutes'),
    'last_activity_at',(SELECT max(e.created_at) FROM private.hl_activity_events e
      WHERE e.hostel_id=p_hostel_id AND (e.actor_user_id=p_user_id OR e.subject_user_id=p_user_id)),
    'history_available_from',(SELECT min(e.created_at) FROM private.hl_activity_events e
      WHERE e.hostel_id=p_hostel_id AND (e.actor_user_id=p_user_id OR e.subject_user_id=p_user_id))
  ) INTO v_result;
  RETURN COALESCE(v_result,'{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_list_member_sessions(
  p_hostel_id uuid,p_user_id uuid,p_limit integer DEFAULT 20,p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer:=LEAST(GREATEST(COALESCE(p_limit,20),1),50);
  v_offset integer:=LEAST(GREATEST(COALESCE(p_offset,0),0),1000000);
  v_total bigint; v_items jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='শুধু Super Admin Login History দেখতে পারবেন।',ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hostel_memberships WHERE hostel_id=p_hostel_id AND user_id=p_user_id) THEN
    RAISE EXCEPTION USING MESSAGE='এই মেসে ব্যবহারকারীর সদস্য-রেকর্ড পাওয়া যায়নি।',ERRCODE='P0002';
  END IF;
  SELECT count(*) INTO v_total
  FROM private.hl_login_sessions s WHERE s.user_id=p_user_id AND s.hostel_id=p_hostel_id;
  SELECT COALESCE(jsonb_agg(q.item ORDER BY q.logged_in_at DESC,q.created_at DESC),'[]'::jsonb)
  INTO v_items
  FROM (
    SELECT s.logged_in_at,s.created_at,jsonb_build_object(
      'logged_in_at',s.logged_in_at,'last_seen_at',s.last_seen_at,
      'last_logout_at',s.last_logout_at,'ip_address',host(s.ip_address),
      'user_agent',s.user_agent,
      'is_online',s.last_logout_at IS NULL AND s.last_seen_at>=now()-interval '20 minutes',
      'session_status',CASE WHEN s.last_logout_at IS NOT NULL THEN 'signed_out'
        WHEN s.last_seen_at>=now()-interval '20 minutes' THEN 'recently_active' ELSE 'stale' END
    ) AS item
    FROM private.hl_login_sessions s
    WHERE s.user_id=p_user_id AND s.hostel_id=p_hostel_id
    ORDER BY s.logged_in_at DESC,s.created_at DESC
    OFFSET v_offset LIMIT v_limit
  ) q;
  RETURN jsonb_build_object('items',v_items,'total_count',v_total,'limit',v_limit,'offset',v_offset,
    'has_more',(v_offset+jsonb_array_length(v_items))<v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_list_member_activity(
  p_hostel_id uuid,p_user_id uuid,p_limit integer DEFAULT 30,p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer:=LEAST(GREATEST(COALESCE(p_limit,30),1),100);
  v_offset integer:=LEAST(GREATEST(COALESCE(p_offset,0),0),1000000);
  v_total bigint; v_items jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE='শুধু Super Admin Activity Log দেখতে পারবেন।',ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hostel_memberships WHERE hostel_id=p_hostel_id AND user_id=p_user_id) THEN
    RAISE EXCEPTION USING MESSAGE='এই মেসে ব্যবহারকারীর সদস্য-রেকর্ড পাওয়া যায়নি।',ERRCODE='P0002';
  END IF;
  SELECT count(*) INTO v_total FROM private.hl_activity_events e
  WHERE e.hostel_id=p_hostel_id AND (e.actor_user_id=p_user_id OR e.subject_user_id=p_user_id);
  SELECT COALESCE(jsonb_agg(q.item ORDER BY q.created_at DESC,q.id DESC),'[]'::jsonb) INTO v_items
  FROM (
    SELECT e.id,e.created_at,jsonb_build_object(
      'id',e.id,'hostel_id',e.hostel_id,'event_type',e.event_type,
      'source_table',e.source_table,'target_id',e.target_id,
      'actor_user_id',e.actor_user_id,'actor_name',COALESCE(NULLIF(ap.full_name,''),'সিস্টেম/অজানা'),
      'subject_user_id',e.subject_user_id,'subject_name',COALESCE(NULLIF(sp.full_name,''),'—'),
      'ip_address',CASE WHEN e.event_type IN ('auth.login','auth.logout') THEN host(e.ip_address) END,
      'metadata',e.metadata,'created_at',e.created_at
    ) AS item
    FROM private.hl_activity_events e
    LEFT JOIN public.profiles ap ON ap.id=e.actor_user_id
    LEFT JOIN public.profiles sp ON sp.id=e.subject_user_id
    WHERE e.hostel_id=p_hostel_id AND (e.actor_user_id=p_user_id OR e.subject_user_id=p_user_id)
    ORDER BY e.created_at DESC,e.id DESC OFFSET v_offset LIMIT v_limit
  ) q;
  RETURN jsonb_build_object('items',v_items,'total_count',v_total,'limit',v_limit,'offset',v_offset,
    'has_more',(v_offset+jsonb_array_length(v_items))<v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_list_activity(
  p_hostel_id uuid DEFAULT NULL,p_event_type text DEFAULT NULL,
  p_limit integer DEFAULT 30,p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer:=LEAST(GREATEST(COALESCE(p_limit,30),1),100);
  v_offset integer:=LEAST(GREATEST(COALESCE(p_offset,0),0),1000000);
  v_type text:=NULLIF(left(btrim(COALESCE(p_event_type,'')),100),'');
  v_total bigint; v_items jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE='শুধু Super Admin Activity Log দেখতে পারবেন।',ERRCODE='42501'; END IF;
  SELECT count(*) INTO v_total FROM private.hl_activity_events e
  WHERE (p_hostel_id IS NULL OR e.hostel_id=p_hostel_id)
    AND (v_type IS NULL OR e.event_type=v_type);
  SELECT COALESCE(jsonb_agg(q.item ORDER BY q.created_at DESC,q.id DESC),'[]'::jsonb) INTO v_items
  FROM (
    SELECT e.id,e.created_at,jsonb_build_object(
      'id',e.id,'hostel_id',e.hostel_id,'hostel_name',h.name,'event_type',e.event_type,
      'source_table',e.source_table,'target_id',e.target_id,
      'ip_address',CASE WHEN e.event_type IN ('auth.login','auth.logout') THEN host(e.ip_address) END,
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
    ORDER BY e.created_at DESC,e.id DESC OFFSET v_offset LIMIT v_limit
  ) q;
  RETURN jsonb_build_object('items',v_items,'total_count',v_total,'limit',v_limit,'offset',v_offset,
    'has_more',(v_offset+jsonb_array_length(v_items))<v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_get_security_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE='শুধু Super Admin Security Monitoring দেখতে পারবেন।',ERRCODE='42501'; END IF;
  SELECT jsonb_build_object(
    'events_24h',count(*) FILTER (WHERE created_at>=now()-interval '24 hours'),
    'events_7d',count(*) FILTER (WHERE created_at>=now()-interval '7 days'),
    'failed_logins_24h',count(*) FILTER (WHERE event_type='login_failed' AND created_at>=now()-interval '24 hours'),
    'failed_signups_24h',count(*) FILTER (WHERE event_type='signup_failed' AND created_at>=now()-interval '24 hours'),
    'signup_submitted_24h',count(*) FILTER (WHERE event_type='signup_submitted' AND created_at>=now()-interval '24 hours'),
    'password_reset_failed_24h',count(*) FILTER (WHERE event_type='password_reset_failed' AND created_at>=now()-interval '24 hours'),
    'repeat_failure_ips_24h',(SELECT count(*) FROM (SELECT ip_address FROM private.hl_security_events s WHERE s.event_type IN ('login_failed','signup_failed') AND s.created_at>=now()-interval '24 hours' AND s.ip_address IS NOT NULL GROUP BY ip_address HAVING count(*)>=5) repeated),
    'unique_ips_24h',count(DISTINCT ip_address) FILTER (WHERE created_at>=now()-interval '24 hours' AND ip_address IS NOT NULL),
    'last_event_at',max(created_at)
  ) INTO v FROM private.hl_security_events;
  RETURN COALESCE(v,'{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_list_security_events(
  p_event_type text DEFAULT NULL,p_ip_search text DEFAULT NULL,
  p_limit integer DEFAULT 30,p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer:=LEAST(GREATEST(COALESCE(p_limit,30),1),100);
  v_offset integer:=LEAST(GREATEST(COALESCE(p_offset,0),0),1000000);
  v_type text:=NULLIF(left(btrim(COALESCE(p_event_type,'')),40),'');
  v_ip text:=NULLIF(left(btrim(COALESCE(p_ip_search,'')),80),'');
  v_total bigint; v_items jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE='শুধু Super Admin Security Monitoring দেখতে পারবেন।',ERRCODE='42501'; END IF;
  SELECT count(*) INTO v_total FROM private.hl_security_events e
  WHERE (v_type IS NULL OR e.event_type=v_type)
    AND (v_ip IS NULL OR host(e.ip_address) ILIKE '%'||v_ip||'%');
  SELECT COALESCE(jsonb_agg(q.item ORDER BY q.created_at DESC,q.id DESC),'[]'::jsonb) INTO v_items
  FROM (
    SELECT e.id,e.created_at,jsonb_build_object(
      'id',e.id,'event_type',e.event_type,'ip_address',host(e.ip_address),
      'ip_fingerprint',e.ip_fingerprint,
      'identity_ref',CASE WHEN e.identity_fingerprint IS NULL THEN NULL ELSE left(e.identity_fingerprint,12) END,
      'failure_code',e.failure_code,'user_agent',e.user_agent,
      'request_origin',e.request_origin,'created_at',e.created_at,
      'ip_attempts_15m',CASE WHEN e.ip_address IS NULL THEN 0 ELSE (SELECT count(*) FROM private.hl_security_events x WHERE x.ip_address=e.ip_address AND x.event_type IN ('login_failed','signup_failed') AND x.created_at>now()-interval '15 minutes') END,
      'identity_attempts_15m',CASE WHEN e.identity_fingerprint IS NULL THEN 0 ELSE (SELECT count(*) FROM private.hl_security_events x WHERE x.identity_fingerprint=e.identity_fingerprint AND x.event_type IN ('login_failed','signup_failed') AND x.created_at>now()-interval '15 minutes') END,
      'risk_level',CASE
        WHEN (e.ip_address IS NOT NULL AND (SELECT count(*) FROM private.hl_security_events x WHERE x.ip_address=e.ip_address AND x.event_type IN ('login_failed','signup_failed') AND x.created_at>now()-interval '15 minutes')>=10)
          OR (e.identity_fingerprint IS NOT NULL AND (SELECT count(*) FROM private.hl_security_events x WHERE x.identity_fingerprint=e.identity_fingerprint AND x.event_type IN ('login_failed','signup_failed') AND x.created_at>now()-interval '15 minutes')>=5) THEN 'high'
        WHEN (e.ip_address IS NOT NULL AND (SELECT count(*) FROM private.hl_security_events x WHERE x.ip_address=e.ip_address AND x.event_type IN ('login_failed','signup_failed') AND x.created_at>now()-interval '15 minutes')>=5)
          OR (e.identity_fingerprint IS NOT NULL AND (SELECT count(*) FROM private.hl_security_events x WHERE x.identity_fingerprint=e.identity_fingerprint AND x.event_type IN ('login_failed','signup_failed') AND x.created_at>now()-interval '15 minutes')>=3) THEN 'review'
        ELSE 'normal' END
    ) AS item
    FROM private.hl_security_events e
    WHERE (v_type IS NULL OR e.event_type=v_type)
      AND (v_ip IS NULL OR host(e.ip_address) ILIKE '%'||v_ip||'%')
    ORDER BY e.created_at DESC,e.id DESC OFFSET v_offset LIMIT v_limit
  ) q;
  RETURN jsonb_build_object('items',v_items,'total_count',v_total,'limit',v_limit,'offset',v_offset,
    'has_more',(v_offset+jsonb_array_length(v_items))<v_total);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8) Function permissions. Service role alone can ingest unauthenticated data.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION private.hl_request_ip() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.hl_request_user_agent() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.hl_capture_activity_event() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hl_touch_my_presence() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.hl_record_my_login() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.hl_record_my_logout() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.hl_record_my_global_logout() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.hl_record_public_security_event(text,text,text,inet,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_get_member_activity_overview(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_member_sessions(uuid,uuid,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_member_activity(uuid,uuid,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_activity(uuid,text,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_get_security_overview() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_security_events(text,text,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_hostel_members_v3(uuid) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.hl_touch_my_presence() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hl_record_my_login() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hl_record_my_logout() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hl_record_my_global_logout() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hl_record_public_security_event(text,text,text,inet,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_member_activity_overview(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_member_sessions(uuid,uuid,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_member_activity(uuid,uuid,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_activity(uuid,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_security_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_security_events(text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_hostel_members_v3(uuid) TO authenticated;

COMMIT;
