-- Hostel Life Run91: Google identity profile completion gate.
-- New Google identities must add a mobile number before accessing hostel data.
-- Existing email/password users are intentionally unaffected.
-- Registration Access Code enforcement remains unchanged for every new account.

BEGIN;

CREATE OR REPLACE FUNCTION private.is_google_oauth_identity()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google'
      OR COALESCE((auth.jwt() -> 'app_metadata' -> 'providers') ? 'google', false)
$$;

CREATE OR REPLACE FUNCTION private.has_required_google_mobile()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT private.is_google_oauth_identity()
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND length(regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g')) BETWEEN 8 AND 15
      )
$$;

CREATE OR REPLACE FUNCTION private.assert_identity_session()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING message = 'এই কাজটি করতে আগে লগইন করুন।', errcode = '28000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_blocked) THEN
    RAISE EXCEPTION USING message = 'আপনার অ্যাকাউন্টটি বর্তমানে ব্লক করা হয়েছে।', errcode = '42501';
  END IF;
  IF NOT private.is_current_auth_session_allowed() THEN
    RAISE EXCEPTION USING message = 'নিরাপত্তার কারণে এই Login Session বন্ধ করা হয়েছে বা এর নির্ধারিত সময় শেষ হয়েছে। আবার লগইন করুন।', errcode = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.is_google_oauth_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.has_required_google_mobile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.assert_identity_session() FROM PUBLIC, anon, authenticated;

-- This bootstrap-friendly assertion is used only by profile/phone completion
-- RPCs. All normal application RPCs continue to use assert_signed_in().
CREATE OR REPLACE FUNCTION private.assert_signed_in()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.assert_identity_session();
  IF NOT private.has_required_google_mobile() THEN
    RAISE EXCEPTION USING message = 'অ্যাপ ব্যবহারের আগে Google account-এর জন্য একটি বৈধ মোবাইল নম্বর যোগ করুন।', errcode = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.has_required_google_mobile()
    AND private.is_current_auth_session_allowed()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin' AND NOT p.is_blocked
    )
$$;

CREATE OR REPLACE FUNCTION private.can_access_hostel(p_hostel_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.has_required_google_mobile()
    AND private.is_current_auth_session_allowed()
    AND (
      EXISTS (
        SELECT 1
        FROM public.hostel_memberships m
        JOIN public.profiles p ON p.id = m.user_id
        JOIN public.hostels h ON h.id = m.hostel_id
        WHERE m.user_id = auth.uid()
          AND m.hostel_id = p_hostel_id
          AND m.status = 'active'
          AND NOT p.is_blocked
          AND h.platform_status = 'active'
      )
      OR private.is_super_admin()
    )
$$;

CREATE OR REPLACE FUNCTION private.can_manage_hostel(
  p_hostel_id uuid,
  p_period_id uuid DEFAULT NULL,
  p_primary_only boolean DEFAULT false,
  p_allow_archive boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.has_required_google_mobile()
    AND private.is_current_auth_session_allowed()
    AND (
      private.is_super_admin()
      OR EXISTS (
        SELECT 1
        FROM public.monthly_periods mp
        WHERE mp.hostel_id = p_hostel_id
          AND mp.status = 'running'
          AND (p_period_id IS NULL OR mp.id = p_period_id)
          AND (
            EXISTS (
              SELECT 1
              FROM public.hostel_memberships m
              JOIN public.profiles p ON p.id = m.user_id
              WHERE m.id = mp.primary_manager_membership_id
                AND m.user_id = auth.uid()
                AND m.status = 'active'
                AND NOT p.is_blocked
            )
            OR (NOT p_primary_only AND EXISTS (
              SELECT 1
              FROM public.period_assistant_managers a
              JOIN public.hostel_memberships m ON m.id = a.membership_id
              JOIN public.profiles p ON p.id = m.user_id
              WHERE a.period_id = mp.id
                AND m.user_id = auth.uid()
                AND m.status = 'active'
                AND NOT p.is_blocked
            ))
          )
      )
      OR (p_period_id IS NULL AND EXISTS (
        SELECT 1
        FROM public.hostel_memberships m
        JOIN public.profiles p ON p.id = m.user_id
        WHERE m.hostel_id = p_hostel_id
          AND m.user_id = auth.uid()
          AND m.role = 'manager'
          AND m.status = 'active'
          AND NOT p.is_blocked
          AND NOT EXISTS (
            SELECT 1 FROM public.monthly_periods mp
            WHERE mp.hostel_id = p_hostel_id AND mp.status = 'running'
          )
      ))
      OR (p_allow_archive AND EXISTS (
        SELECT 1
        FROM public.archive_edit_permissions a
        JOIN public.hostel_memberships m ON m.id = a.membership_id
        WHERE a.hostel_id = p_hostel_id
          AND a.period_id = p_period_id
          AND a.membership_id = private.my_membership_id()
          AND a.revoked_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > now())
          AND m.status = 'active'
          AND m.user_id = auth.uid()
      ))
    )
$$;

-- Permit only the signed-in user to read their own incomplete profile so the
-- callback can display Google name/email/avatar and collect the mobile number.
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v jsonb;
BEGIN
  PERFORM private.assert_identity_session();
  SELECT jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'phone', p.phone,
    'avatar_url', p.avatar_url,
    'role', p.role,
    'is_blocked', p.is_blocked,
    'created_at', p.created_at,
    'updated_at', p.updated_at
  )
  INTO v
  FROM public.profiles p
  WHERE p.id = auth.uid();
  RETURN v;
END;
$$;

-- Do not disclose a hostel membership/join code until the required mobile
-- number is present. Keep the current Run49 join-code visibility semantics.
CREATE OR REPLACE FUNCTION public.get_my_membership()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v jsonb;
BEGIN
  PERFORM private.assert_identity_session();
  IF NOT private.has_required_google_mobile() THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'membership_id', m.id,
    'id', m.id,
    'user_id', m.user_id,
    'hostel_id', m.hostel_id,
    'hostel_name', h.name,
    'hostel_status', h.platform_status,
    'join_code', CASE
      WHEN m.role = 'manager' OR EXISTS (
        SELECT 1
        FROM public.monthly_periods mp
        WHERE mp.hostel_id = h.id
          AND mp.status = 'running'
          AND (
            mp.primary_manager_membership_id = m.id
            OR EXISTS (
              SELECT 1
              FROM public.period_assistant_managers a
              WHERE a.period_id = mp.id
                AND a.hostel_id = h.id
                AND a.membership_id = m.id
            )
          )
      ) THEN h.join_code
      ELSE NULL
    END,
    'meal_count_modes', COALESCE(h.meal_count_modes,
      '{"breakfast":"half","lunch":"full","dinner":"full"}'::jsonb),
    'role', m.role,
    'status', m.status,
    'member_status', m.status,
    'member_name', p.full_name,
    'full_name', p.full_name,
    'phone', p.phone,
    'joined_at', m.joined_at
  )
  INTO v
  FROM public.hostel_memberships m
  JOIN public.hostels h ON h.id = m.hostel_id
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.user_id = auth.uid()
    AND m.status = 'active'
    AND NOT p.is_blocked
  ORDER BY m.created_at DESC
  LIMIT 1;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_operational_role()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hostel uuid;
  v_member uuid;
  v_period public.monthly_periods%ROWTYPE;
  v_primary boolean := false;
  v_assistant boolean := false;
BEGIN
  PERFORM private.assert_identity_session();
  IF NOT private.has_required_google_mobile() THEN
    RETURN jsonb_build_object('is_primary_manager', false, 'is_assistant_manager', false, 'can_manage_month', false);
  END IF;

  v_hostel := private.my_hostel_id();
  v_member := private.my_membership_id();
  IF v_hostel IS NULL OR v_member IS NULL THEN
    RETURN jsonb_build_object('is_primary_manager', false, 'is_assistant_manager', false, 'can_manage_month', false);
  END IF;

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE hostel_id = v_hostel AND status = 'running'
  ORDER BY start_date DESC
  LIMIT 1;

  IF FOUND THEN
    v_primary := v_period.primary_manager_membership_id = v_member;
    v_assistant := EXISTS (
      SELECT 1 FROM public.period_assistant_managers a
      WHERE a.period_id = v_period.id AND a.membership_id = v_member
    );
  ELSE
    SELECT role = 'manager' INTO v_primary
    FROM public.hostel_memberships WHERE id = v_member;
  END IF;

  RETURN jsonb_build_object(
    'is_primary_manager', COALESCE(v_primary, false),
    'is_assistant_manager', COALESCE(v_assistant, false),
    'can_manage_month', COALESCE(v_primary, false),
    'period_id', v_period.id
  );
END;
$$;

-- This RPC is intentionally the one bootstrap exception: it permits a Google
-- user to add the required phone while all normal app RPCs remain gated.
CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_full_name text,
  p_phone text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v jsonb;
  v_phone_digits text;
BEGIN
  PERFORM private.assert_identity_session();
  IF p_full_name IS NULL OR length(btrim(p_full_name)) < 2 OR length(btrim(p_full_name)) > 100 THEN
    RAISE EXCEPTION USING message = 'নাম কমপক্ষে ২ এবং সর্বোচ্চ ১০০ অক্ষরের হতে হবে।', errcode = '22023';
  END IF;

  IF private.is_google_oauth_identity() THEN
    v_phone_digits := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
    IF length(v_phone_digits) NOT BETWEEN 8 AND 15 THEN
      RAISE EXCEPTION USING message = 'Google account সম্পূর্ণ করতে ৮–১৫ সংখ্যার একটি মোবাইল নম্বর দিন।', errcode = '22023';
    END IF;
  END IF;

  UPDATE public.profiles
  SET full_name = btrim(p_full_name),
      phone = NULLIF(btrim(p_phone), ''),
      avatar_url = NULLIF(btrim(p_avatar_url), '')
  WHERE id = auth.uid()
  RETURNING jsonb_build_object(
    'id', id, 'full_name', full_name, 'phone', phone,
    'avatar_url', avatar_url, 'role', role
  ) INTO v;

  IF v IS NULL THEN
    RAISE EXCEPTION USING message = 'প্রোফাইল পাওয়া যায়নি। আবার লগইন করুন।', errcode = 'P0002';
  END IF;
  RETURN v;
END;
$$;

-- Keep profile bootstrap possible for the current user only. Existing app RPCs
-- and RLS data access remain gated by assert_signed_in/can_access_hostel.
REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_membership() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_operational_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_my_profile(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_membership() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_operational_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, text, text) TO authenticated;


-- Preserve the original registration-code enforcement. This update only imports
-- a Google-hosted profile image into the existing avatar_url field; it does not
-- exempt Google registrations from the access-code policy.
CREATE OR REPLACE FUNCTION private.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_settings public.platform_settings%ROWTYPE;
  v_code text;
  v_avatar text;
BEGIN
  SELECT * INTO v_settings
  FROM public.platform_settings
  WHERE singleton = true;

  v_code := COALESCE(NEW.raw_user_meta_data ->> 'permission_code', '');
  IF COALESCE(v_settings.registration_code_required, false)
    AND NOT private.consume_access_code('registration', v_code) THEN
    RAISE EXCEPTION USING
      message = 'রেজিস্ট্রেশনের অনুমতি কোডটি ভুল, মেয়াদোত্তীর্ণ অথবা ব্যবহারসীমা শেষ।',
      errcode = '42501';
  END IF;

  v_avatar := NULL;
  IF COALESCE(NEW.raw_app_meta_data ->> 'provider', '') = 'google' THEN
    v_avatar := COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', NEW.raw_user_meta_data ->> 'picture');
    IF v_avatar !~* '^https://([a-z0-9-]+\.)*googleusercontent\.com/' THEN
      v_avatar := NULL;
    END IF;
  END IF;

  INSERT INTO public.profiles(id, full_name, phone, avatar_url, role)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''), NULLIF(btrim(NEW.raw_user_meta_data ->> 'name'), ''), 'সদস্য'),
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'phone'), ''),
    v_avatar,
    'user'
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
      avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
      updated_at = now();

  RETURN NEW;
END;
$$;

COMMIT;
