-- ============================================================================
-- HOSTEL LIFE — Run28: Authenticated Invitations, 12-char Join Code,
-- platform default theme and per-account concurrent device/session limit.
--
-- SECURITY MODEL:
--   * No anonymous/public dashboard access is created by this migration.
--   * No anon RPC can read hostel data, invitation metadata or join requests.
--   * Invitation links only allow an authenticated user to submit a Join Request.
--   * Membership is granted only after a manager/assistant approves the request.
--   * Only a hashed SHA-256 invitation token is stored in the database.
--
-- COMPATIBILITY:
--   * Intended to run once after the existing Run1–Run27 migrations.
--   * Existing 8-character join codes are rotated to new 12-character codes.
--     Previously shared 8-character codes will stop working after this migration.
--   * No existing hostel, member, meal, market, ledger or other business rows
--     are deleted or rewritten (except the hostel join_code column).
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';

DO $run28_preflight$
BEGIN
  IF to_regclass('public.hostels') IS NULL
     OR to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.platform_settings') IS NULL
     OR to_regclass('public.period_assistant_managers') IS NULL
     OR to_regclass('public.archive_edit_permissions') IS NULL
     OR to_regclass('public.platform_audit_log') IS NULL
     OR to_regclass('private.hl_activity_events') IS NULL
     OR to_regclass('auth.sessions') IS NULL THEN
    RAISE EXCEPTION 'Run28 stopped: a required Run1–Run27 table is missing. Do not run on an incomplete schema.';
  END IF;

  IF to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.assert_hostel_manager(uuid,uuid,boolean,boolean)') IS NULL
     OR to_regprocedure('private.is_super_admin()') IS NULL
     OR to_regprocedure('private.my_hostel_id()') IS NULL
     OR to_regprocedure('private.my_membership_id()') IS NULL
     OR to_regprocedure('private.consume_access_code(text,text)') IS NULL
     OR to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL
     OR to_regprocedure('extensions.digest(text,text)') IS NULL
     OR to_regprocedure('auth.jwt()') IS NULL THEN
    RAISE EXCEPTION 'Run28 stopped: a required permission, Auth or cryptographic helper function is missing.';
  END IF;

  IF NOT EXISTS (
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
    RAISE EXCEPTION 'Run28 stopped: auth.sessions does not expose the expected id/user_id/created_at/not_after columns.';
  END IF;
END;
$run28_preflight$;

-- ---------------------------------------------------------------------------
-- 1) Safe platform defaults and Super Admin-only device/session policy.
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS default_theme text NOT NULL DEFAULT 'dark',
  ADD COLUMN IF NOT EXISTS max_devices_per_user integer NOT NULL DEFAULT 10;

DO $run28_settings_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.platform_settings'::regclass
      AND conname='platform_settings_default_theme_check'
  ) THEN
    ALTER TABLE public.platform_settings
      ADD CONSTRAINT platform_settings_default_theme_check
      CHECK (default_theme IN ('system','light','dark','blue')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.platform_settings'::regclass
      AND conname='platform_settings_max_devices_check'
  ) THEN
    ALTER TABLE public.platform_settings
      ADD CONSTRAINT platform_settings_max_devices_check
      CHECK (max_devices_per_user BETWEEN 1 AND 30) NOT VALID;
  END IF;
END;
$run28_settings_constraints$;

ALTER TABLE public.platform_settings
  VALIDATE CONSTRAINT platform_settings_default_theme_check;
ALTER TABLE public.platform_settings
  VALIDATE CONSTRAINT platform_settings_max_devices_check;

CREATE OR REPLACE FUNCTION public.get_platform_public_settings()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'announcement_enabled',s.announcement_enabled,
      'announcement_title',s.announcement_title,
      'announcement_body',s.announcement_body,
      'registration_code_required',s.registration_code_required,
      'hostel_creation_code_required',s.hostel_creation_code_required,
      'developer_name',s.developer_name,
      'developer_title',s.developer_title,
      'developer_photo_url',s.developer_photo_url,
      'developer_email',s.developer_email,
      'developer_phone',s.developer_phone,
      'developer_portfolio_url',s.developer_portfolio_url,
      'default_theme',s.default_theme,
      'updated_at',s.updated_at
    )
    FROM public.platform_settings s WHERE s.singleton=true
  ), '{}'::jsonb)
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_set_default_theme(p_theme text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_theme text := lower(btrim(coalesce(p_theme,'')));
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING message='শুধু Super Admin ডিফল্ট থিম পরিবর্তন করতে পারবেন।', errcode='42501';
  END IF;
  IF v_theme NOT IN ('system','light','dark','blue') THEN
    RAISE EXCEPTION USING message='থিম নির্বাচন সঠিক নয়।', errcode='22023';
  END IF;

  UPDATE public.platform_settings
  SET default_theme=v_theme,updated_by=auth.uid(),updated_at=now()
  WHERE singleton=true;

  INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,details)
  VALUES(auth.uid(),'default_theme_updated','platform_settings','default_theme',
    jsonb_build_object('theme',v_theme));

  RETURN jsonb_build_object('default_theme',v_theme,'status','updated');
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_get_session_policy()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_limit integer;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING message='শুধু Super Admin Session Policy দেখতে পারবেন।', errcode='42501';
  END IF;
  SELECT max_devices_per_user INTO v_limit
  FROM public.platform_settings WHERE singleton=true;
  RETURN jsonb_build_object('max_devices_per_user',coalesce(v_limit,10),'minimum',1,'maximum',30);
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_set_max_devices_per_user(p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old integer;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING message='শুধু Super Admin Device Limit পরিবর্তন করতে পারবেন।', errcode='42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION USING message='Device Limit ১ থেকে ৩০-এর মধ্যে হতে হবে।', errcode='22023';
  END IF;

  SELECT max_devices_per_user INTO v_old
  FROM public.platform_settings WHERE singleton=true FOR UPDATE;

  UPDATE public.platform_settings
  SET max_devices_per_user=p_limit,updated_by=auth.uid(),updated_at=now()
  WHERE singleton=true;

  INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,details)
  VALUES(auth.uid(),'device_session_limit_updated','platform_settings','max_devices_per_user',
    jsonb_build_object('previous_limit',v_old,'new_limit',p_limit,
      'enforcement','next sign-in, identity refresh or active-session heartbeat'));

  RETURN jsonb_build_object('max_devices_per_user',p_limit,'previous_limit',v_old,'status','updated');
END;
$$;

-- ---------------------------------------------------------------------------
-- 1A) Database-wide session guard. This is stronger than a client-only limit:
--     it protects authenticated RLS reads and the common auth assertion used
--     by SECURITY DEFINER write RPCs. The helper never calls assert_signed_in,
--     avoiding recursion.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.is_current_auth_session_allowed()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_session uuid;
  v_limit integer := 10;
  v_position bigint;
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

  SELECT coalesce(max_devices_per_user,10) INTO v_limit
  FROM public.platform_settings WHERE singleton=true;
  v_limit := greatest(1,least(30,coalesce(v_limit,10)));

  SELECT ranked.position INTO v_position
  FROM (
    SELECT s.id,row_number() OVER (ORDER BY s.created_at ASC,s.id ASC) AS position
    FROM auth.sessions s
    WHERE s.user_id=v_user AND (s.not_after IS NULL OR s.not_after>now())
  ) ranked
  WHERE ranked.id=v_session;

  RETURN coalesce(v_position BETWEEN 1 AND v_limit,false);
END;
$$;

CREATE OR REPLACE FUNCTION private.assert_signed_in()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING message='এই কাজটি করতে আগে লগইন করুন।',errcode='28000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_blocked) THEN
    RAISE EXCEPTION USING message='আপনার অ্যাকাউন্টটি বর্তমানে ব্লক করা হয়েছে।',errcode='42501';
  END IF;
  IF NOT private.is_current_auth_session_allowed() THEN
    RAISE EXCEPTION USING message='এই অ্যাকাউন্টের অনুমোদিত Device/Browser Session সীমা অতিক্রম হয়েছে। এই Session থেকে আবার লগইন করুন অথবা অন্য Session বন্ধ করুন।',errcode='42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.is_current_auth_session_allowed()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id=auth.uid() AND p.role='super_admin' AND NOT p.is_blocked
    )
$$;

CREATE OR REPLACE FUNCTION private.can_access_hostel(p_hostel_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.is_current_auth_session_allowed() AND (
    private.is_super_admin()
    OR private.is_primary_manager(p_hostel_id,p_period_id)
    OR (NOT p_primary_only AND private.is_assistant_manager(p_hostel_id,p_period_id))
    OR (p_allow_archive AND EXISTS (
      SELECT 1 FROM public.archive_edit_permissions a
      JOIN public.hostel_memberships m ON m.id=a.membership_id
      WHERE a.hostel_id=p_hostel_id AND a.period_id=p_period_id
        AND a.membership_id=private.my_membership_id()
        AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>now())
        AND m.status='active' AND m.user_id=auth.uid()
    ))
  )
$$;

-- Existing permissive RLS rules intentionally remain unchanged. These
-- restrictive policies add one mandatory AND condition, including self-read
-- shortcuts that would otherwise bypass can_access_hostel().
DO $run28_session_rls_guards$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'profiles','hostels','hostel_memberships','monthly_periods',
    'period_assistant_managers','daily_meal_days','daily_meal_records',
    'meal_requests','market_entries','market_entry_items','ledger_transactions',
    'khala_money_entries','archive_edit_permissions','archive_period_audit',
    'notifications','platform_settings','platform_access_codes','platform_audit_log',
    'daily_meal_snapshots','meal_late_overrides','platform_retention_policy',
    'platform_notification_preferences','hl_period_summary_snapshots',
    'hl_archived_final_summaries','hostel_pinned_announcements',
    'hostel_access_links','hostel_join_requests'
  ] LOOP
    IF to_regclass('public.'||v_table) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
      EXECUTE format('DROP POLICY IF EXISTS run28_session_limit_guard ON public.%I',v_table);
      EXECUTE format(
        'CREATE POLICY run28_session_limit_guard ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (private.is_current_auth_session_allowed()) WITH CHECK (private.is_current_auth_session_allowed())',
        v_table
      );
    END IF;
  END LOOP;
END;
$run28_session_rls_guards$;

-- Avatar/developer storage reads are authenticated-only in Run1. Apply the same
-- session guard to every authenticated Storage operation covered by its RLS.
DROP POLICY IF EXISTS run28_session_limit_guard ON storage.objects;
CREATE POLICY run28_session_limit_guard ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (private.is_current_auth_session_allowed())
  WITH CHECK (private.is_current_auth_session_allowed());

-- ---------------------------------------------------------------------------
-- 2) Rotate old join codes and enforce exactly 12 uppercase hexadecimal chars.
-- ---------------------------------------------------------------------------
DO $run28_rotate_join_codes$
DECLARE
  v_hostel record;
  v_code text;
  v_rotated integer := 0;
BEGIN
  FOR v_hostel IN
    SELECT id FROM public.hostels
    WHERE join_code IS NULL OR join_code !~ '^[0-9A-F]{12}$'
    ORDER BY id FOR UPDATE
  LOOP
    LOOP
      v_code := upper(encode(extensions.gen_random_bytes(6),'hex'));
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.hostels WHERE join_code=v_code AND id<>v_hostel.id
      );
    END LOOP;

    UPDATE public.hostels SET join_code=v_code,updated_at=now()
    WHERE id=v_hostel.id;
    v_rotated := v_rotated + 1;
  END LOOP;

  IF v_rotated > 0 THEN
    INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,details)
    VALUES(NULL,'join_code_length_upgraded','platform_settings','join_code',
      jsonb_build_object('hostel_count',v_rotated,'new_length',12,
        'format','12 uppercase hexadecimal characters'));
  END IF;
END;
$run28_rotate_join_codes$;

DO $run28_join_code_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.hostels'::regclass
      AND conname='hostels_join_code_12_hex_check'
  ) THEN
    ALTER TABLE public.hostels
      ADD CONSTRAINT hostels_join_code_12_hex_check
      CHECK (join_code ~ '^[0-9A-F]{12}$') NOT VALID;
  END IF;
END;
$run28_join_code_constraint$;
ALTER TABLE public.hostels VALIDATE CONSTRAINT hostels_join_code_12_hex_check;

CREATE OR REPLACE FUNCTION private.generate_hostel_join_code()
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_code text;
BEGIN
  LOOP
    v_code := upper(encode(extensions.gen_random_bytes(6),'hex'));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.hostels WHERE join_code=v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

-- Keep Run1 create_hostel_secure validation, registration gate consumption,
-- membership creation and audit side effects; only the code generator changes.
CREATE OR REPLACE FUNCTION public.create_hostel_secure(p_name text,p_permission_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid;
  v_hostel public.hostels%rowtype;
  v_membership public.hostel_memberships%rowtype;
  v_settings public.platform_settings%rowtype;
  v_code text;
BEGIN
  PERFORM private.assert_signed_in();
  v_user := auth.uid();

  IF private.my_membership_id() IS NOT NULL THEN
    RAISE EXCEPTION USING message='আপনি ইতিমধ্যে একটি মেসে যুক্ত আছেন। নতুন মেস তৈরি করার আগে বর্তমান মেস থেকে বের হতে হবে।',errcode='23505';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name))<2 OR length(btrim(p_name))>120 THEN
    RAISE EXCEPTION USING message='মেসের নাম ২ থেকে ১২০ অক্ষরের মধ্যে হতে হবে।',errcode='22023';
  END IF;

  SELECT * INTO v_settings FROM public.platform_settings WHERE singleton=true;
  IF v_settings.hostel_creation_code_required THEN
    IF NOT private.consume_access_code('hostel_creation',coalesce(p_permission_code,'')) THEN
      RAISE EXCEPTION USING message='মেস তৈরির অনুমতি কোডটি ভুল, মেয়াদোত্তীর্ণ অথবা ব্যবহারসীমা শেষ।',errcode='42501';
    END IF;
  END IF;

  v_code := private.generate_hostel_join_code();
  INSERT INTO public.hostels(name,join_code,created_by)
  VALUES(btrim(p_name),v_code,v_user)
  RETURNING * INTO v_hostel;

  INSERT INTO public.hostel_memberships(hostel_id,user_id,role,status)
  VALUES(v_hostel.id,v_user,'manager','active')
  RETURNING * INTO v_membership;

  INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,details)
  VALUES(v_user,'hostel_created','hostel',v_hostel.id::text,
    jsonb_build_object('name',v_hostel.name));

  RETURN jsonb_build_object('hostel_id',v_hostel.id,'id',v_hostel.id,
    'name',v_hostel.name,'join_code',v_hostel.join_code,
    'membership_id',v_membership.id,'status','created');
END;
$$;

-- Preserve Run22 permissions: primary manager OR assigned assistant manager.
CREATE OR REPLACE FUNCTION public.regenerate_join_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hostel uuid := private.my_hostel_id(); v_code text;
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.assert_hostel_manager(v_hostel,NULL,false,false);
  v_code := private.generate_hostel_join_code();
  UPDATE public.hostels SET join_code=v_code,updated_at=now() WHERE id=v_hostel;
  RETURN v_code;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Authenticated, time-bounded invitation links. No public-view link type.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hostel_access_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id uuid NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  link_type text NOT NULL DEFAULT 'member_invite' CHECK (link_type='member_invite'),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  label text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS hostel_access_links_hostel_created_idx
  ON public.hostel_access_links(hostel_id,created_at DESC);
CREATE INDEX IF NOT EXISTS hostel_access_links_active_expiry_idx
  ON public.hostel_access_links(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.hostel_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id uuid NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_link_id uuid REFERENCES public.hostel_access_links(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  request_note text,
  review_note text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS hostel_join_requests_one_pending_idx
  ON public.hostel_join_requests(hostel_id,user_id) WHERE status='pending';
-- One account may have only one pending hostel request at a time. This prevents
-- parallel invitations from racing into multiple pending membership paths.
CREATE UNIQUE INDEX IF NOT EXISTS hostel_join_requests_one_pending_user_idx
  ON public.hostel_join_requests(user_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS hostel_join_requests_hostel_status_idx
  ON public.hostel_join_requests(hostel_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS hostel_join_requests_user_created_idx
  ON public.hostel_join_requests(user_id,created_at DESC);

ALTER TABLE public.hostel_access_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hostel_join_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hostel_access_links FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.hostel_join_requests FROM PUBLIC,anon,authenticated;

-- Serialize membership transitions per account. The same lock is used when a
-- request is created, a manager approves it, or a user joins/creates normally.
CREATE OR REPLACE FUNCTION private.lock_hostel_membership_transition(p_user_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING message='ব্যবহারকারী যাচাই করা যায়নি।',errcode='28000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hostel-life-membership-transition:'||p_user_id::text,0));
END;
$$;

CREATE OR REPLACE FUNCTION private.assert_no_pending_hostel_join_request(p_user_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.hostel_join_requests r
    WHERE r.user_id=p_user_id AND r.status='pending'
  ) THEN
    RAISE EXCEPTION USING
      message='আপনার একটি Join Request এখনো অপেক্ষমাণ। সিদ্ধান্ত না আসা পর্যন্ত নতুন মেসে Join বা Create করা যাবে না।',
      errcode='23505';
  END IF;
END;
$$;

-- Keep the original create-hostel validation, access-code consumption,
-- manager membership and audit record; additionally prevent a pending invite
-- request from being bypassed through the normal Create path.
CREATE OR REPLACE FUNCTION public.create_hostel_secure(p_name text,p_permission_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid;
  v_hostel public.hostels%rowtype;
  v_membership public.hostel_memberships%rowtype;
  v_settings public.platform_settings%rowtype;
  v_code text;
BEGIN
  PERFORM private.assert_signed_in();
  v_user := auth.uid();
  PERFORM private.lock_hostel_membership_transition(v_user);
  PERFORM private.assert_no_pending_hostel_join_request(v_user);

  IF private.my_membership_id() IS NOT NULL THEN
    RAISE EXCEPTION USING message='আপনি ইতিমধ্যে একটি মেসে যুক্ত আছেন। নতুন মেস তৈরি করার আগে বর্তমান মেস থেকে বের হতে হবে।',errcode='23505';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name))<2 OR length(btrim(p_name))>120 THEN
    RAISE EXCEPTION USING message='মেসের নাম ২ থেকে ১২০ অক্ষরের মধ্যে হতে হবে।',errcode='22023';
  END IF;

  SELECT * INTO v_settings FROM public.platform_settings WHERE singleton=true;
  IF v_settings.hostel_creation_code_required THEN
    IF NOT private.consume_access_code('hostel_creation',coalesce(p_permission_code,'')) THEN
      RAISE EXCEPTION USING message='মেস তৈরির অনুমতি কোডটি ভুল, মেয়াদোত্তীর্ণ অথবা ব্যবহারসীমা শেষ।',errcode='42501';
    END IF;
  END IF;

  v_code := private.generate_hostel_join_code();
  INSERT INTO public.hostels(name,join_code,created_by)
  VALUES(btrim(p_name),v_code,v_user)
  RETURNING * INTO v_hostel;

  INSERT INTO public.hostel_memberships(hostel_id,user_id,role,status)
  VALUES(v_hostel.id,v_user,'manager','active')
  RETURNING * INTO v_membership;

  INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,details)
  VALUES(v_user,'hostel_created','hostel',v_hostel.id::text,
    jsonb_build_object('name',v_hostel.name));

  RETURN jsonb_build_object('hostel_id',v_hostel.id,'id',v_hostel.id,
    'name',v_hostel.name,'join_code',v_hostel.join_code,
    'membership_id',v_membership.id,'status','created');
END;
$$;

-- Preserve Run1 join semantics while preventing a pending invitation request
-- from being bypassed with the ordinary 12-character Join Code.
CREATE OR REPLACE FUNCTION public.join_hostel(p_join_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_hostel public.hostels%rowtype;
  v_user uuid;
  v_existing public.hostel_memberships%rowtype;
  v_membership public.hostel_memberships%rowtype;
BEGIN
  PERFORM private.assert_signed_in();
  v_user := auth.uid();
  PERFORM private.lock_hostel_membership_transition(v_user);
  PERFORM private.assert_no_pending_hostel_join_request(v_user);

  IF p_join_code IS NULL OR btrim(p_join_code)='' THEN
    RAISE EXCEPTION USING message='Join Code লিখুন।',errcode='22023';
  END IF;
  SELECT * INTO v_hostel FROM public.hostels
  WHERE upper(join_code)=upper(btrim(p_join_code)) LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='এই Join Code-এর কোনো মেস পাওয়া যায়নি।',errcode='P0002';
  END IF;
  IF v_hostel.platform_status<>'active' THEN
    RAISE EXCEPTION USING message='এই মেসটি বর্তমানে স্থগিত।',errcode='55000';
  END IF;

  SELECT * INTO v_existing FROM public.hostel_memberships
  WHERE user_id=v_user ORDER BY created_at DESC LIMIT 1;
  IF FOUND AND v_existing.hostel_id<>v_hostel.id AND v_existing.status='active' THEN
    RAISE EXCEPTION USING message='আপনি ইতিমধ্যে অন্য একটি মেসে যুক্ত আছেন।',errcode='23505';
  END IF;

  IF FOUND AND v_existing.hostel_id=v_hostel.id THEN
    UPDATE public.hostel_memberships
    SET status='active',deactivated_at=NULL
    WHERE id=v_existing.id RETURNING * INTO v_membership;
  ELSE
    INSERT INTO public.hostel_memberships(hostel_id,user_id,role,status)
    VALUES(v_hostel.id,v_user,'member','active') RETURNING * INTO v_membership;
  END IF;

  RETURN jsonb_build_object('hostel_id',v_hostel.id,'hostel_name',v_hostel.name,
    'membership_id',v_membership.id,'role',v_membership.role,'status',v_membership.status);
END;
$$;

CREATE OR REPLACE FUNCTION private.resolve_hostel_invite_link(p_token text)
RETURNS public.hostel_access_links
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_link public.hostel_access_links%rowtype;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT l.* INTO v_link
  FROM public.hostel_access_links l
  JOIN public.hostels h ON h.id=l.hostel_id
  WHERE l.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    AND l.link_type='member_invite'
    AND l.revoked_at IS NULL
    AND l.starts_at<=now()
    AND l.expires_at>now()
    AND h.platform_status='active'
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_link;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_hostel_invite_link_info(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_link public.hostel_access_links%rowtype; v_name text;
BEGIN
  PERFORM private.assert_signed_in();
  v_link := private.resolve_hostel_invite_link(p_token);
  IF v_link.id IS NULL THEN
    RAISE EXCEPTION USING message='Invitation Link ভুল, মেয়াদোত্তীর্ণ অথবা বাতিল করা হয়েছে।',errcode='P0002';
  END IF;
  SELECT name INTO v_name FROM public.hostels WHERE id=v_link.hostel_id;
  RETURN jsonb_build_object('hostel_id',v_link.hostel_id,'hostel_name',v_name,
    'starts_at',v_link.starts_at,'expires_at',v_link.expires_at,'status','active');
END;
$$;

CREATE OR REPLACE FUNCTION public.manager_create_hostel_invite_link(
  p_expires_at timestamptz DEFAULT (now()+interval '7 days'),
  p_label text DEFAULT ''
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_token text;
  v_id uuid;
  v_exp timestamptz := coalesce(p_expires_at,now()+interval '7 days');
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.assert_hostel_manager(v_hostel,NULL,false,false);
  IF v_exp<=now() OR v_exp>now()+interval '30 days' THEN
    RAISE EXCEPTION USING message='Invitation Link-এর মেয়াদ বর্তমান সময় থেকে সর্বোচ্চ ৩০ দিনের মধ্যে হতে হবে।',errcode='22023';
  END IF;

  v_token := encode(extensions.gen_random_bytes(32),'hex');
  INSERT INTO public.hostel_access_links(hostel_id,link_type,token_hash,label,starts_at,expires_at,created_by)
  VALUES(v_hostel,'member_invite',encode(extensions.digest(v_token,'sha256'),'hex'),
    left(coalesce(p_label,''),120),now(),v_exp,auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id',v_id,'token',v_token,'link_type','member_invite','expires_at',v_exp);
END;
$$;

CREATE OR REPLACE FUNCTION public.manager_list_hostel_invite_links()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hostel uuid := private.my_hostel_id(); v_rows jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.assert_hostel_manager(v_hostel,NULL,false,false);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,'label',l.label,'created_at',l.created_at,'starts_at',l.starts_at,
    'expires_at',l.expires_at,'revoked_at',l.revoked_at,
    'status',CASE WHEN l.revoked_at IS NOT NULL THEN 'revoked'
      WHEN l.expires_at<=now() THEN 'expired'
      WHEN l.starts_at>now() THEN 'scheduled' ELSE 'active' END
  ) ORDER BY l.created_at DESC),'[]'::jsonb)
  INTO v_rows FROM public.hostel_access_links l
  WHERE l.hostel_id=v_hostel AND l.link_type='member_invite';
  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.manager_revoke_hostel_invite_link(p_link_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hostel uuid := private.my_hostel_id();
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.assert_hostel_manager(v_hostel,NULL,false,false);
  UPDATE public.hostel_access_links SET revoked_at=coalesce(revoked_at,now())
  WHERE id=p_link_id AND hostel_id=v_hostel AND link_type='member_invite';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='Invitation Link পাওয়া যায়নি।',errcode='P0002';
  END IF;
  RETURN jsonb_build_object('id',p_link_id,'status','revoked');
END;
$$;

CREATE OR REPLACE FUNCTION public.create_hostel_join_request_from_link(
  p_token text,p_request_note text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_link public.hostel_access_links%rowtype;
  v_user uuid := auth.uid();
  v_existing public.hostel_memberships%rowtype;
  v_request public.hostel_join_requests%rowtype;
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.lock_hostel_membership_transition(v_user);
  v_link := private.resolve_hostel_invite_link(p_token);
  IF v_link.id IS NULL THEN
    RAISE EXCEPTION USING message='Invitation Link ভুল, মেয়াদোত্তীর্ণ অথবা বাতিল করা হয়েছে।',errcode='P0002';
  END IF;

  SELECT * INTO v_existing FROM public.hostel_memberships
  WHERE user_id=v_user AND status='active' ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF v_existing.hostel_id=v_link.hostel_id THEN
      RETURN jsonb_build_object('status','already_member','hostel_id',v_link.hostel_id);
    END IF;
    RAISE EXCEPTION USING message='আপনি ইতিমধ্যে অন্য একটি মেসের সক্রিয় সদস্য। নতুন অনুরোধের আগে বর্তমান সদস্যপদ সমাধান করুন।',errcode='23505';
  END IF;

  SELECT * INTO v_request FROM public.hostel_join_requests
  WHERE user_id=v_user AND status='pending' LIMIT 1;
  IF FOUND THEN
    IF v_request.hostel_id<>v_link.hostel_id THEN
      RAISE EXCEPTION USING message='আপনার অন্য একটি মেসে Join Request অপেক্ষমাণ। আগে সেটির সিদ্ধান্তের জন্য অপেক্ষা করুন।',errcode='23505';
    END IF;
    RETURN jsonb_build_object('status','pending','request_id',v_request.id,
      'hostel_id',v_link.hostel_id,
      'hostel_name',(SELECT name FROM public.hostels WHERE id=v_link.hostel_id),
      'created_at',v_request.created_at);
  END IF;

  INSERT INTO public.hostel_join_requests(hostel_id,user_id,access_link_id,request_note,status)
  VALUES(v_link.hostel_id,v_user,v_link.id,left(nullif(btrim(p_request_note),''),500),'pending')
  ON CONFLICT (user_id) WHERE status='pending' DO NOTHING;

  SELECT * INTO v_request FROM public.hostel_join_requests
  WHERE user_id=v_user AND status='pending' LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='যোগদানের অনুরোধ তৈরি করা যায়নি। আবার চেষ্টা করুন।',errcode='P0001';
  END IF;
  IF v_request.hostel_id<>v_link.hostel_id THEN
    RAISE EXCEPTION USING message='আপনার অন্য একটি মেসে Join Request অপেক্ষমাণ। আগে সেটির সিদ্ধান্তের জন্য অপেক্ষা করুন।',errcode='23505';
  END IF;

  RETURN jsonb_build_object('status','pending','request_id',v_request.id,
    'hostel_id',v_link.hostel_id,
    'hostel_name',(SELECT name FROM public.hostels WHERE id=v_link.hostel_id),
    'created_at',v_request.created_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_hostel_join_request_status(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_link public.hostel_access_links%rowtype;
  v_request public.hostel_join_requests%rowtype;
  v_membership public.hostel_memberships%rowtype;
BEGIN
  PERFORM private.assert_signed_in();
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING message='Invitation Token সঠিক নয়।',errcode='P0002';
  END IF;

  -- The user's own request remains trackable after a link expires/revokes.
  SELECT * INTO v_link FROM public.hostel_access_links
  WHERE token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    AND link_type='member_invite' LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='এই Invitation-এর অনুরোধের তথ্য পাওয়া যায়নি।',errcode='P0002';
  END IF;

  SELECT * INTO v_membership FROM public.hostel_memberships
  WHERE hostel_id=v_link.hostel_id AND user_id=auth.uid() AND status='active' LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status','approved','membership_id',v_membership.id,'hostel_id',v_link.hostel_id);
  END IF;

  SELECT * INTO v_request FROM public.hostel_join_requests
  WHERE hostel_id=v_link.hostel_id AND user_id=auth.uid()
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_submitted');
  END IF;

  RETURN jsonb_build_object('status',v_request.status,'request_id',v_request.id,
    'created_at',v_request.created_at,'reviewed_at',v_request.reviewed_at,
    'review_note',v_request.review_note);
END;
$$;

CREATE OR REPLACE FUNCTION public.manager_list_hostel_join_requests()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hostel uuid := private.my_hostel_id(); v_rows jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.assert_hostel_manager(v_hostel,NULL,false,false);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'user_id',r.user_id,'full_name',p.full_name,'created_at',r.created_at,
    'request_note',r.request_note,'status',r.status,'link_type','member_invite',
    'link_label',l.label
  ) ORDER BY r.created_at ASC),'[]'::jsonb)
  INTO v_rows
  FROM public.hostel_join_requests r
  JOIN public.profiles p ON p.id=r.user_id
  LEFT JOIN public.hostel_access_links l ON l.id=r.access_link_id
  WHERE r.hostel_id=v_hostel AND r.status='pending' AND NOT p.is_blocked;
  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.manager_review_hostel_join_request(
  p_request_id uuid,p_approve boolean,p_review_note text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_request public.hostel_join_requests%rowtype;
  v_membership public.hostel_memberships%rowtype;
  v_request_user uuid;
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.assert_hostel_manager(v_hostel,NULL,false,false);

  SELECT user_id INTO v_request_user FROM public.hostel_join_requests
  WHERE id=p_request_id AND hostel_id=v_hostel;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='যোগদানের অনুরোধটি পাওয়া যায়নি।',errcode='P0002';
  END IF;
  PERFORM private.lock_hostel_membership_transition(v_request_user);

  SELECT * INTO v_request FROM public.hostel_join_requests
  WHERE id=p_request_id AND hostel_id=v_hostel FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='যোগদানের অনুরোধটি পাওয়া যায়নি।',errcode='P0002';
  END IF;
  IF v_request.status<>'pending' THEN
    RAISE EXCEPTION USING message='এই অনুরোধটি ইতিমধ্যে পর্যালোচনা করা হয়েছে।',errcode='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id=v_request.user_id AND is_blocked) THEN
    RAISE EXCEPTION USING message='এই অ্যাকাউন্টটি বর্তমানে ব্লক করা আছে।',errcode='42501';
  END IF;

  IF coalesce(p_approve,false) THEN
    IF NOT EXISTS (SELECT 1 FROM public.hostels WHERE id=v_hostel AND platform_status='active') THEN
      RAISE EXCEPTION USING message='এই মেস বর্তমানে সক্রিয় নয়; Join Request অনুমোদন করা যাবে না।',errcode='55000';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.hostel_memberships
      WHERE user_id=v_request.user_id AND status='active' AND hostel_id<>v_hostel
    ) THEN
      RAISE EXCEPTION USING message='ব্যবহারকারী ইতিমধ্যে অন্য একটি মেসের সক্রিয় সদস্য।',errcode='23505';
    END IF;

    SELECT * INTO v_membership FROM public.hostel_memberships
    WHERE hostel_id=v_hostel AND user_id=v_request.user_id
    LIMIT 1 FOR UPDATE;

    IF FOUND THEN
      IF v_membership.status<>'active' THEN
        -- Never restore an old elevated role through a new invite approval.
        UPDATE public.hostel_memberships
        SET status='active',role='member',deactivated_at=NULL,updated_at=now()
        WHERE id=v_membership.id RETURNING * INTO v_membership;
        DELETE FROM public.period_assistant_managers WHERE membership_id=v_membership.id;
        UPDATE public.archive_edit_permissions
        SET revoked_at=coalesce(revoked_at,now())
        WHERE membership_id=v_membership.id AND revoked_at IS NULL;
      END IF;
      -- If already active in this hostel, preserve the existing role/permissions.
    ELSE
      INSERT INTO public.hostel_memberships(hostel_id,user_id,role,status)
      VALUES(v_hostel,v_request.user_id,'member','active')
      RETURNING * INTO v_membership;
    END IF;

    UPDATE public.hostel_join_requests
    SET status='approved',review_note=left(nullif(btrim(p_review_note),''),500),
        reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    WHERE id=v_request.id;
    RETURN jsonb_build_object('status','approved','request_id',v_request.id,'membership_id',v_membership.id);
  END IF;

  UPDATE public.hostel_join_requests
  SET status='rejected',review_note=left(nullif(btrim(p_review_note),''),500),
      reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
  WHERE id=v_request.id;
  RETURN jsonb_build_object('status','rejected','request_id',v_request.id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Server-enforced maximum concurrent Supabase Auth sessions per account.
--
-- Counts unique auth.sessions ids (not tabs). The oldest N sessions are kept;
-- a newer session above the configured cap is denied. Existing sessions are
-- rechecked on app initialization/identity refresh and active-session heartbeat.
-- This does NOT use IP or User-Agent as identity and never deletes other sessions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hl_enforce_my_session_limit()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_session uuid;
  v_max integer := 10;
  v_total integer := 0;
  v_position bigint;
  v_hostel uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION USING message='এই কাজটি করতে আগে লগইন করুন।',errcode='28000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=v_user AND p.is_blocked) THEN
    RAISE EXCEPTION USING message='আপনার অ্যাকাউন্টটি বর্তমানে ব্লক করা হয়েছে।',errcode='42501';
  END IF;
  BEGIN
    v_session := nullif(auth.jwt()->>'session_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_session := NULL;
  END;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'reason','session_id_missing','max_devices_per_user',10);
  END IF;

  -- Serialize concurrent sign-ins for the same account before ranking sessions.
  PERFORM pg_advisory_xact_lock(hashtextextended('hostel-life-session-policy:'||v_user::text,0));

  SELECT coalesce(max_devices_per_user,10) INTO v_max
  FROM public.platform_settings WHERE singleton=true;
  v_max := greatest(1,least(30,coalesce(v_max,10)));

  SELECT count(*) INTO v_total
  FROM auth.sessions s
  WHERE s.user_id=v_user AND (s.not_after IS NULL OR s.not_after>now());

  SELECT ranked.position INTO v_position
  FROM (
    SELECT s.id,row_number() OVER (ORDER BY s.created_at ASC,s.id ASC) AS position
    FROM auth.sessions s
    WHERE s.user_id=v_user AND (s.not_after IS NULL OR s.not_after>now())
  ) ranked
  WHERE ranked.id=v_session;

  IF v_position IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'reason','session_not_found',
      'max_devices_per_user',v_max,'active_sessions',v_total);
  END IF;

  IF v_position>v_max THEN
    SELECT hostel_id INTO v_hostel FROM public.hostel_memberships
    WHERE user_id=v_user AND status='active' ORDER BY created_at DESC LIMIT 1;

    IF NOT EXISTS (
      SELECT 1 FROM private.hl_activity_events e
      WHERE e.actor_user_id=v_user
        AND e.event_type='auth.session_limit_denied'
        AND e.target_id=v_session::text
        AND e.created_at>now()-interval '1 day'
    ) THEN
      INSERT INTO private.hl_activity_events(
        hostel_id,actor_user_id,subject_user_id,event_type,source_table,target_id,metadata
      ) VALUES (
        v_hostel,v_user,v_user,'auth.session_limit_denied','auth.sessions',v_session::text,
        jsonb_build_object('maximum_sessions',v_max,'counted_sessions',v_total,'session_position',v_position)
      );
    END IF;

    RETURN jsonb_build_object('allowed',false,'reason','session_limit_exceeded',
      'max_devices_per_user',v_max,'active_sessions',v_total,'session_position',v_position);
  END IF;

  RETURN jsonb_build_object('allowed',true,'max_devices_per_user',v_max,
    'active_sessions',v_total,'session_position',v_position);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Explicit least-privilege grants. The only anonymous RPC retained is the
--    existing redacted global platform-settings endpoint; no hostel, invite,
--    membership, financial, security or dashboard data is exposed to anon.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION private.generate_hostel_join_code() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.lock_hostel_membership_transition(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.assert_no_pending_hostel_join_request(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.resolve_hostel_invite_link(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.is_current_auth_session_allowed() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.is_current_auth_session_allowed() TO authenticated;

REVOKE ALL ON FUNCTION public.get_platform_public_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_public_settings() TO anon,authenticated;

REVOKE ALL ON FUNCTION public.platform_admin_set_default_theme(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_get_session_policy() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_set_max_devices_per_user(integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_hostel_invite_link_info(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.manager_create_hostel_invite_link(timestamptz,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.manager_list_hostel_invite_links() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.manager_revoke_hostel_invite_link(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.create_hostel_join_request_from_link(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_my_hostel_join_request_status(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.manager_list_hostel_join_requests() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.manager_review_hostel_join_request(uuid,boolean,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.hl_enforce_my_session_limit() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.create_hostel_secure(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.regenerate_join_code() FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.platform_admin_set_default_theme(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_session_policy() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_set_max_devices_per_user(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hostel_invite_link_info(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_create_hostel_invite_link(timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_list_hostel_invite_links() TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_revoke_hostel_invite_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_hostel_join_request_from_link(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_hostel_join_request_status(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_list_hostel_join_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_review_hostel_join_request(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hl_enforce_my_session_limit() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_hostel_secure(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_join_code() TO authenticated;

COMMIT;
