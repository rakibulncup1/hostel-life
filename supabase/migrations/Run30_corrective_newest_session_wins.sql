-- ============================================================================
-- HOSTEL LIFE — Run30
-- Corrective session policy: newest login wins; oldest sessions are revoked.
-- Also supports an optional fixed session lifetime configured by Super Admin.
--
-- IMPORTANT:
--   * This migration repairs the previous Run28 policy that denied the newest
--     session and kept the oldest sessions.
--   * Existing auth.sessions are backfilled as allowed; this migration itself
--     does NOT sign users out or delete Auth sessions.
--   * On the next NEW login, the newest N app sessions are retained and older
--     ones are revoked at the application/RLS layer. Their clients sign out
--     locally on the next active heartbeat/focus event.
--   * A timeout of 0 means no fixed app-level expiry. Existing sessions receive
--     a fresh timeout window only when Super Admin changes the policy.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';

DO $run30_preflight$
BEGIN
  IF to_regclass('public.platform_settings') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('auth.sessions') IS NULL
     OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Run30 stopped: required platform/auth tables are missing. Apply the existing Run28 migration first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE singleton=true) THEN
    RAISE EXCEPTION 'Run30 stopped: the singleton platform_settings row is missing; no session policy changes were made.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='platform_settings' AND column_name='max_devices_per_user'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='auth' AND table_name='sessions' AND column_name='id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='auth' AND table_name='sessions' AND column_name='user_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='auth' AND table_name='sessions' AND column_name='created_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='auth' AND table_name='sessions' AND column_name='not_after'
  ) THEN
    RAISE EXCEPTION 'Run30 stopped: Run28 session policy or expected Supabase Auth session columns are missing.';
  END IF;
  IF to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.is_super_admin()') IS NULL
     OR to_regprocedure('private.can_access_hostel(uuid)') IS NULL
     OR to_regprocedure('private.can_manage_hostel(uuid,uuid,boolean,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Run30 stopped: required Hostel Life authorization helpers are missing.';
  END IF;
END;
$run30_preflight$;

-- ---------------------------------------------------------------------------
-- 1. Session registry. It is not directly readable/writable by client roles.
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS session_timeout_minutes integer NOT NULL DEFAULT 0;

DO $run30_timeout_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.platform_settings'::regclass
      AND conname='platform_settings_session_timeout_check'
  ) THEN
    ALTER TABLE public.platform_settings
      ADD CONSTRAINT platform_settings_session_timeout_check
      CHECK (session_timeout_minutes BETWEEN 0 AND 10080) NOT VALID;
  END IF;
END;
$run30_timeout_constraint$;
ALTER TABLE public.platform_settings VALIDATE CONSTRAINT platform_settings_session_timeout_check;

CREATE TABLE IF NOT EXISTS public.hl_auth_sessions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  auth_created_at timestamptz NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,session_id),
  CONSTRAINT hl_auth_sessions_revoke_reason_check
    CHECK (revoke_reason IS NULL OR revoke_reason IN ('device_limit','session_timeout','manual_policy_update','auth_session_missing'))
);
CREATE INDEX IF NOT EXISTS hl_auth_sessions_active_user_idx
  ON public.hl_auth_sessions(user_id,registered_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS hl_auth_sessions_expiry_idx
  ON public.hl_auth_sessions(expires_at)
  WHERE revoked_at IS NULL AND expires_at IS NOT NULL;
ALTER TABLE public.hl_auth_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hl_auth_sessions FROM PUBLIC,anon,authenticated;

-- Preserve every currently active Supabase Auth session at migration time.
-- No old device is revoked merely because this corrective migration is run.
INSERT INTO public.hl_auth_sessions(
  user_id,session_id,auth_created_at,registered_at,last_seen_at,expires_at
)
SELECT s.user_id,s.id,s.created_at,s.created_at,now(),
  CASE WHEN ps.session_timeout_minutes>0
    THEN s.created_at + make_interval(mins=>ps.session_timeout_minutes)
    ELSE NULL END
FROM auth.sessions s
CROSS JOIN LATERAL (
  SELECT coalesce(session_timeout_minutes,0) AS session_timeout_minutes
  FROM public.platform_settings WHERE singleton=true LIMIT 1
) ps
WHERE s.not_after IS NULL OR s.not_after>now()
ON CONFLICT(user_id,session_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Current-session validator used by existing restrictive RLS policies.
--    Unlike Run28, it does not rank old/new sessions and never blocks a newly
--    created current session merely because it is newer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.is_current_auth_session_allowed()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_session uuid;
BEGIN
  IF v_user IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=v_user AND p.is_blocked) THEN
    RETURN false;
  END IF;
  BEGIN
    v_session := nullif(auth.jwt()->>'session_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;
  IF v_session IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.hl_auth_sessions app_s
    JOIN auth.sessions auth_s ON auth_s.id=app_s.session_id AND auth_s.user_id=app_s.user_id
    WHERE app_s.user_id=v_user AND app_s.session_id=v_session
      AND app_s.revoked_at IS NULL
      AND (app_s.expires_at IS NULL OR app_s.expires_at>now())
      AND (auth_s.not_after IS NULL OR auth_s.not_after>now())
  );
END;
$$;
REVOKE ALL ON FUNCTION private.is_current_auth_session_allowed() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.is_current_auth_session_allowed() TO authenticated;

-- Restore the original authorization semantics, adding only the new session
-- registry check. The period-aware manager rule is copied from the final Run1
-- definition, not the earlier, less restrictive version.
CREATE OR REPLACE FUNCTION private.assert_signed_in()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING message='এই কাজটি করতে আগে লগইন করুন।',errcode='28000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_blocked) THEN
    RAISE EXCEPTION USING message='আপনার অ্যাকাউন্টটি বর্তমানে ব্লক করা হয়েছে।',errcode='42501';
  END IF;
  IF NOT private.is_current_auth_session_allowed() THEN
    RAISE EXCEPTION USING message='নিরাপত্তার কারণে এই Login Session বন্ধ করা হয়েছে বা এর নির্ধারিত সময় শেষ হয়েছে। আবার লগইন করুন।',errcode='42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.is_current_auth_session_allowed()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.role='super_admin' AND NOT p.is_blocked)
$$;

CREATE OR REPLACE FUNCTION private.can_access_hostel(p_hostel_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.is_current_auth_session_allowed() AND (
    EXISTS (
      SELECT 1 FROM public.hostel_memberships m
      JOIN public.profiles p ON p.id=m.user_id
      JOIN public.hostels h ON h.id=m.hostel_id
      WHERE m.user_id=auth.uid() AND m.hostel_id=p_hostel_id
        AND m.status='active' AND NOT p.is_blocked AND h.platform_status='active'
    ) OR private.is_super_admin()
  )
$$;

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

-- ---------------------------------------------------------------------------
-- 3. Session registration and newest-session-wins eviction.
--    Existing sessions are kept during Run30. Only a newly created auth session
--    triggers eviction. The newest configured number remain active.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hl_enforce_my_session_limit()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_session uuid;
  v_auth_created_at timestamptz;
  v_max integer := 10;
  v_timeout integer := 0;
  v_inserted integer := 0;
  v_row public.hl_auth_sessions%ROWTYPE;
  v_allowed boolean := false;
  v_active integer := 0;
  v_expires_at timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION USING message='এই কাজটি করতে আগে লগইন করুন।',errcode='28000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=v_user AND p.is_blocked) THEN
    RAISE EXCEPTION USING message='আপনার অ্যাকাউন্টটি বর্তমানে ব্লক করা হয়েছে।',errcode='42501';
  END IF;

  BEGIN
    v_session := nullif(auth.jwt()->>'session_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_session := NULL;
  END;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'reason','session_id_missing','max_devices_per_user',10);
  END IF;

  SELECT s.created_at INTO v_auth_created_at
  FROM auth.sessions s
  WHERE s.id=v_session AND s.user_id=v_user AND (s.not_after IS NULL OR s.not_after>now());
  IF v_auth_created_at IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'reason','auth_session_missing','max_devices_per_user',10);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('hostel-life-session-policy:'||v_user::text,0));
  SELECT greatest(1,least(30,coalesce(max_devices_per_user,10))),
         greatest(0,least(10080,coalesce(session_timeout_minutes,0)))
  INTO v_max,v_timeout
  FROM public.platform_settings WHERE singleton=true;
  v_max := coalesce(v_max,10);
  v_timeout := coalesce(v_timeout,0);

  SELECT * INTO v_row FROM public.hl_auth_sessions
  WHERE user_id=v_user AND session_id=v_session FOR UPDATE;

  IF FOUND THEN
    IF v_row.revoked_at IS NOT NULL THEN
      RETURN jsonb_build_object('allowed',false,'reason','session_revoked',
        'max_devices_per_user',v_max,'active_sessions',0,'expires_at',v_row.expires_at);
    END IF;
    IF v_row.expires_at IS NOT NULL AND v_row.expires_at<=now() THEN
      UPDATE public.hl_auth_sessions
      SET revoked_at=now(),revoke_reason='session_timeout',updated_at=now()
      WHERE user_id=v_user AND session_id=v_session AND revoked_at IS NULL;
      RETURN jsonb_build_object('allowed',false,'reason','session_expired',
        'max_devices_per_user',v_max,'active_sessions',0,'expires_at',v_row.expires_at);
    END IF;
    UPDATE public.hl_auth_sessions SET last_seen_at=now(),updated_at=now()
    WHERE user_id=v_user AND session_id=v_session;
  ELSE
    INSERT INTO public.hl_auth_sessions(
      user_id,session_id,auth_created_at,registered_at,last_seen_at,expires_at
    ) VALUES (
      v_user,v_session,v_auth_created_at,now(),now(),
      CASE WHEN v_timeout>0 THEN now()+make_interval(mins=>v_timeout) ELSE NULL END
    ) ON CONFLICT(user_id,session_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    -- This is the only automatic eviction point: a genuinely new Auth session.
    -- Always keep the current newly created session first, then the newest others.
    IF v_inserted=1 THEN
      WITH ranked AS (
        SELECT s.session_id,
          row_number() OVER (ORDER BY (s.session_id=v_session) DESC,s.registered_at DESC,s.session_id DESC) AS position
        FROM public.hl_auth_sessions s
        WHERE s.user_id=v_user AND s.revoked_at IS NULL
          AND (s.expires_at IS NULL OR s.expires_at>now())
      )
      UPDATE public.hl_auth_sessions s
      SET revoked_at=now(),revoke_reason='device_limit',updated_at=now()
      FROM ranked r
      WHERE s.user_id=v_user AND s.session_id=r.session_id AND r.position>v_max
        AND s.revoked_at IS NULL;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.hl_auth_sessions s JOIN auth.sessions a
      ON a.id=s.session_id AND a.user_id=s.user_id
    WHERE s.user_id=v_user AND s.session_id=v_session AND s.revoked_at IS NULL
      AND (s.expires_at IS NULL OR s.expires_at>now())
      AND (a.not_after IS NULL OR a.not_after>now())
  ) INTO v_allowed;
  SELECT count(*) INTO v_active FROM public.hl_auth_sessions s
  WHERE s.user_id=v_user AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>now());
  SELECT expires_at INTO v_expires_at FROM public.hl_auth_sessions
  WHERE user_id=v_user AND session_id=v_session;

  RETURN jsonb_build_object(
    'allowed',v_allowed,'reason',CASE WHEN v_allowed THEN 'active' ELSE 'session_revoked' END,
    'max_devices_per_user',v_max,'active_sessions',v_active,
    'session_timeout_minutes',v_timeout,'expires_at',v_expires_at
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Super Admin session policy. Existing sessions receive a new window when
--    the timeout policy is changed. Lowering the cap keeps the newest sessions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_admin_get_session_policy()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_limit integer; v_timeout integer;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING message='শুধু Super Admin Session Policy দেখতে পারবেন।',errcode='42501';
  END IF;
  SELECT max_devices_per_user,session_timeout_minutes INTO v_limit,v_timeout
  FROM public.platform_settings WHERE singleton=true;
  RETURN jsonb_build_object('max_devices_per_user',coalesce(v_limit,10),
    'session_timeout_minutes',coalesce(v_timeout,0),'minimum',1,'maximum',30);
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_set_session_policy(p_limit integer,p_timeout_minutes integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old_limit integer;
  v_old_timeout integer;
  v_current_session uuid;
  v_now timestamptz := now();
  v_revoked integer := 0;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING message='শুধু Super Admin Session Policy পরিবর্তন করতে পারবেন।',errcode='42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION USING message='একসঙ্গে সর্বোচ্চ Session সংখ্যা ১ থেকে ৩০-এর মধ্যে হতে হবে।',errcode='22023';
  END IF;
  IF p_timeout_minutes IS NULL OR p_timeout_minutes NOT BETWEEN 0 AND 10080 THEN
    RAISE EXCEPTION USING message='Session-এর সময় ০ থেকে ১০,০৮০ মিনিটের মধ্যে হতে হবে।',errcode='22023';
  END IF;
  BEGIN v_current_session:=nullif(auth.jwt()->>'session_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN v_current_session:=NULL; END;

  SELECT max_devices_per_user,session_timeout_minutes INTO v_old_limit,v_old_timeout
  FROM public.platform_settings WHERE singleton=true FOR UPDATE;
  UPDATE public.platform_settings
  SET max_devices_per_user=p_limit,session_timeout_minutes=p_timeout_minutes,
      updated_by=auth.uid(),updated_at=v_now
  WHERE singleton=true;

  -- Expired sessions stay expired; changing policy must never revive them.
  UPDATE public.hl_auth_sessions
  SET revoked_at=v_now,revoke_reason='session_timeout',updated_at=v_now
  WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at<=v_now;

  UPDATE public.hl_auth_sessions
  SET expires_at=CASE WHEN p_timeout_minutes=0 THEN NULL ELSE v_now+make_interval(mins=>p_timeout_minutes) END,
      updated_at=v_now
  WHERE revoked_at IS NULL;

  WITH ranked AS (
    SELECT s.user_id,s.session_id,
      row_number() OVER (
        PARTITION BY s.user_id
        ORDER BY (s.user_id=auth.uid() AND s.session_id=v_current_session) DESC,
                 s.registered_at DESC,s.session_id DESC
      ) AS position
    FROM public.hl_auth_sessions s
    WHERE s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>v_now)
  ), revoked AS (
    UPDATE public.hl_auth_sessions s
    SET revoked_at=v_now,revoke_reason='manual_policy_update',updated_at=v_now
    FROM ranked r
    WHERE s.user_id=r.user_id AND s.session_id=r.session_id
      AND r.position>p_limit AND s.revoked_at IS NULL
    RETURNING 1
  ) SELECT count(*) INTO v_revoked FROM revoked;

  INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,details)
  VALUES(auth.uid(),'session_policy_updated','platform_settings','session_policy',
    jsonb_build_object('old_max_sessions',v_old_limit,'new_max_sessions',p_limit,
      'old_timeout_minutes',v_old_timeout,'new_timeout_minutes',p_timeout_minutes,
      'revoked_sessions',v_revoked,'new_login_keeps_newest',true));

  RETURN jsonb_build_object('max_devices_per_user',p_limit,
    'session_timeout_minutes',p_timeout_minutes,'revoked_sessions',v_revoked,'status','updated');
END;
$$;

-- Backward-compatible wrapper for a V5 frontend that still calls the old RPC.
CREATE OR REPLACE FUNCTION public.platform_admin_set_max_devices_per_user(p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_timeout integer;
BEGIN
  SELECT coalesce(session_timeout_minutes,0) INTO v_timeout
  FROM public.platform_settings WHERE singleton=true;
  RETURN public.platform_admin_set_session_policy(p_limit,coalesce(v_timeout,0));
END;
$$;

REVOKE ALL ON FUNCTION public.hl_enforce_my_session_limit() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_get_session_policy() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_set_session_policy(integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_set_max_devices_per_user(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hl_enforce_my_session_limit() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_session_policy() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_set_session_policy(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_set_max_devices_per_user(integer) TO authenticated;

COMMIT;
