-- Run93: allow trusted Google-authenticated new accounts without the platform
-- Registration Access Code. Email/password signup keeps the original gate.
-- The provider marker is in raw_app_meta_data, which is managed by Supabase Auth;
-- user-editable raw_user_meta_data is deliberately not used for this exception.
-- Mess Join Code and hostel-creation permission-code checks are not changed.

BEGIN;

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
  v_is_google_provider boolean;
BEGIN
  SELECT * INTO v_settings
  FROM public.platform_settings
  WHERE singleton = true;

  -- Supabase Auth sets this trusted provider value after validating Google's
  -- ID token. Do not trust a provider string from raw_user_meta_data.
  v_is_google_provider := COALESCE(NEW.raw_app_meta_data ->> 'provider', '') = 'google';
  v_code := COALESCE(NEW.raw_user_meta_data ->> 'permission_code', '');

  IF COALESCE(v_settings.registration_code_required, false)
    AND NOT v_is_google_provider
    AND NOT private.consume_access_code('registration', v_code) THEN
    RAISE EXCEPTION USING
      message = 'রেজিস্ট্রেশনের অনুমতি কোডটি ভুল, মেয়াদোত্তীর্ণ অথবা ব্যবহারসীমা শেষ।',
      errcode = '42501';
  END IF;

  v_avatar := NULL;
  IF v_is_google_provider THEN
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
