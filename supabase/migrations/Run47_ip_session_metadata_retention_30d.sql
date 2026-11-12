-- Run47: enforce a 30-day cap for app-managed session IP / browser metadata.
-- The identity, login history, active session state and authorization checks remain intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $preflight$
BEGIN
  IF to_regclass('private.hl_login_sessions') IS NULL
     OR to_regclass('private.hl_user_presence') IS NULL
     OR to_regclass('private.hl_activity_events') IS NULL
     OR to_regclass('private.hl_security_events') IS NULL
     OR to_regclass('private.hl_security_ip_blocks') IS NULL
     OR to_regclass('private.hl_password_reset_ip_attempts') IS NULL
     OR to_regclass('private.password_reset_request_log') IS NULL
     OR to_regclass('private.hl_geo_proxy_nonces') IS NULL THEN
    RAISE EXCEPTION 'Run47 preflight failed: required private session/security tables are missing.' USING ERRCODE='55000';
  END IF;
  IF to_regprocedure('private.hl_prune_platform_logs()') IS NULL
     OR to_regprocedure('public.hl_touch_my_presence()') IS NULL
     OR to_regprocedure('public.hl_record_my_logout()') IS NULL
     OR to_regprocedure('public.hl_record_my_global_logout()') IS NULL THEN
    RAISE EXCEPTION 'Run47 preflight failed: scheduled cleanup or presence RPC is missing.' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_login_sessions' AND column_name='logged_in_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_login_sessions' AND column_name='ip_address')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_login_sessions' AND column_name='user_agent')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_user_presence' AND column_name='last_login_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_user_presence' AND column_name='last_login_ip')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_user_presence' AND column_name='last_user_agent') THEN
    RAISE EXCEPTION 'Run47 preflight failed: session metadata schema does not match the expected baseline.' USING ERRCODE='55000';
  END IF;
END;
$preflight$;

-- Keep the index narrow and partial: the daily cleanup only visits rows with
-- retained metadata, without changing session-list ordering or authentication.
CREATE INDEX IF NOT EXISTS hl_login_sessions_retention_idx
  ON private.hl_login_sessions(logged_in_at)
  WHERE ip_address IS NOT NULL OR user_agent IS NOT NULL;

CREATE OR REPLACE FUNCTION private.hl_enforce_login_session_metadata_retention()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF NEW.logged_in_at < pg_catalog.now() - interval '30 days' THEN
    NEW.ip_address := NULL;
    NEW.user_agent := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.hl_enforce_login_session_metadata_retention() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.hl_enforce_presence_metadata_retention()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF NEW.last_login_at IS NULL OR NEW.last_login_at < pg_catalog.now() - interval '30 days' THEN
    NEW.last_login_ip := NULL;
    NEW.last_user_agent := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.hl_enforce_presence_metadata_retention() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS hl_login_sessions_metadata_retention ON private.hl_login_sessions;
CREATE TRIGGER hl_login_sessions_metadata_retention
BEFORE INSERT OR UPDATE ON private.hl_login_sessions
FOR EACH ROW EXECUTE FUNCTION private.hl_enforce_login_session_metadata_retention();

DROP TRIGGER IF EXISTS hl_user_presence_metadata_retention ON private.hl_user_presence;
CREATE TRIGGER hl_user_presence_metadata_retention
BEFORE INSERT OR UPDATE ON private.hl_user_presence
FOR EACH ROW EXECUTE FUNCTION private.hl_enforce_presence_metadata_retention();

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
  v_session_metadata bigint := 0;
  v_presence_metadata bigint := 0;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(728194650175::bigint) THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok',true,'skipped',true,'reason','cleanup_already_running','ran_at',v_now,
      'activity_deleted',0,'security_deleted',0,'expired_blocks_deleted',0,
      'password_reset_ip_attempts_deleted',0,'password_reset_quota_rows_deleted',0,
      'session_metadata_cleared',0,'presence_metadata_cleared',0
    );
  END IF;

  DELETE FROM private.hl_activity_events WHERE created_at < v_now - interval '30 days';
  GET DIAGNOSTICS v_activity = ROW_COUNT;
  DELETE FROM private.hl_security_events WHERE created_at < v_now - interval '30 days';
  GET DIAGNOSTICS v_security = ROW_COUNT;
  -- An expired block is no longer needed for enforcement; keep the active block
  -- until its server-calculated expiry, then remove its raw IP immediately.
  DELETE FROM private.hl_security_ip_blocks WHERE blocked_until <= v_now;
  GET DIAGNOSTICS v_blocks = ROW_COUNT;
  DELETE FROM private.hl_password_reset_ip_attempts WHERE requested_at < v_now - interval '48 hours';
  GET DIAGNOSTICS v_reset_ip = ROW_COUNT;
  DELETE FROM private.password_reset_request_log WHERE requested_at < v_now - interval '35 days';
  GET DIAGNOSTICS v_reset_quota = ROW_COUNT;
  DELETE FROM private.hl_geo_proxy_nonces WHERE expires_at < v_now;
  GET DIAGNOSTICS v_geo_nonces = ROW_COUNT;

  UPDATE private.hl_login_sessions
  SET ip_address=NULL, user_agent=NULL
  WHERE logged_in_at < v_now - interval '30 days'
    AND (ip_address IS NOT NULL OR user_agent IS NOT NULL);
  GET DIAGNOSTICS v_session_metadata = ROW_COUNT;

  UPDATE private.hl_user_presence
  SET last_login_ip=NULL, last_user_agent=NULL
  WHERE last_login_at < v_now - interval '30 days'
    AND (last_login_ip IS NOT NULL OR last_user_agent IS NOT NULL);
  GET DIAGNOSTICS v_presence_metadata = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'ok',true,'skipped',false,'ran_at',v_now,
    'activity_deleted',v_activity,'security_deleted',v_security,
    'expired_blocks_deleted',v_blocks,
    'password_reset_ip_attempts_deleted',v_reset_ip,
    'password_reset_quota_rows_deleted',v_reset_quota,
    'expired_geo_proxy_nonces_deleted',v_geo_nonces,
    'session_metadata_cleared',v_session_metadata,
    'presence_metadata_cleared',v_presence_metadata,
    'retention_days',30,'platform_audit_log_retained_separately',true
  );
END;
$function$;

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
         CASE WHEN COALESCE(s.created_at,u.last_sign_in_at,now()) >= now()-interval '30 days' THEN COALESCE(private.hl_request_ip(),s.ip) ELSE NULL END,NULL
  FROM auth.sessions s
  JOIN auth.users u ON u.id=s.user_id
  WHERE s.id=v_session_id AND s.user_id=v_user_id
  ON CONFLICT(session_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Keep one heartbeat write per session at most every ten minutes.
  IF v_inserted=0 THEN
    UPDATE private.hl_login_sessions
    SET last_seen_at=now(),hostel_id=COALESCE(hostel_id,v_hostel_id),
        ip_address=CASE WHEN logged_in_at >= now()-interval '30 days' THEN COALESCE(ip_address,private.hl_request_ip()) ELSE NULL END,
        user_agent=CASE WHEN logged_in_at >= now()-interval '30 days' THEN user_agent ELSE NULL END
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
      last_login_ip=CASE WHEN v_last_login >= now()-interval '30 days' THEN COALESCE(EXCLUDED.last_login_ip,private.hl_user_presence.last_login_ip) ELSE NULL END,
      last_user_agent=CASE WHEN v_last_login >= now()-interval '30 days' THEN COALESCE(EXCLUDED.last_user_agent,private.hl_user_presence.last_user_agent) ELSE NULL END,
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
  SELECT s.id,s.user_id,m.hostel_id,COALESCE(s.created_at,u.last_sign_in_at,now()),now(),CASE WHEN COALESCE(s.created_at,u.last_sign_in_at,now()) >= now()-interval '30 days' THEN COALESCE(v_ip,s.ip) ELSE NULL END
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
    last_login_ip=CASE WHEN v_last_login >= now()-interval '30 days' THEN COALESCE(EXCLUDED.last_login_ip,private.hl_user_presence.last_login_ip) ELSE NULL END,
    last_user_agent=CASE WHEN v_last_login >= now()-interval '30 days' THEN COALESCE(EXCLUDED.last_user_agent,private.hl_user_presence.last_user_agent) ELSE NULL END,
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
  SELECT s.id,s.user_id,v_hostel_id,COALESCE(s.created_at,u.last_sign_in_at,now()),now(),CASE WHEN COALESCE(s.created_at,u.last_sign_in_at,now()) >= now()-interval '30 days' THEN COALESCE(v_ip,s.ip) ELSE NULL END
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
    last_login_ip=CASE WHEN v_last_login >= now()-interval '30 days' THEN COALESCE(EXCLUDED.last_login_ip,private.hl_user_presence.last_login_ip) ELSE NULL END,
    last_user_agent=CASE WHEN v_last_login >= now()-interval '30 days' THEN COALESCE(EXCLUDED.last_user_agent,private.hl_user_presence.last_user_agent) ELSE NULL END,
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

REVOKE ALL ON FUNCTION private.hl_prune_platform_logs() FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
