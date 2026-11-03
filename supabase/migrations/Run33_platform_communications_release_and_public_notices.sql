-- Run33: compact platform communications, release notes, scheduled window/site notices,
-- and Telegram/WhatsApp contact details in the existing hostel member directory.
-- One singleton row is used. No per-user impressions, history table, cron job, or new bucket.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
BEGIN
  IF to_regclass('public.platform_settings') IS NULL
     OR to_regclass('public.platform_notification_provider_settings') IS NULL
     OR to_regclass('public.user_notification_channels') IS NULL
     OR to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('public.hostels') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('auth.users') IS NULL
     OR to_regclass('private.hl_login_sessions') IS NULL
     OR to_regclass('private.hl_user_presence') IS NULL
     OR to_regclass('storage.objects') IS NULL
     OR to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.is_super_admin()') IS NULL
     OR to_regprocedure('public.get_platform_public_settings()') IS NULL
     OR to_regprocedure('public.platform_admin_list_hostel_members_v3(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Run33 preflight failed: expected Run1/Run27/Run31 platform, storage, and Telegram objects are missing. No changes applied.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_settings' AND column_name='singleton')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_settings' AND column_name='default_theme')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_settings' AND column_name='updated_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_notification_provider_settings' AND column_name='singleton')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_notification_provider_settings' AND column_name='active_provider')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hostels' AND column_name='id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hostel_memberships' AND column_name='id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hostel_memberships' AND column_name='user_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hostel_memberships' AND column_name='hostel_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hostel_memberships' AND column_name='role')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hostel_memberships' AND column_name='status')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hostel_memberships' AND column_name='joined_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='full_name')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='phone')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='avatar_url')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='is_blocked')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='flags')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_login_sessions' AND column_name='user_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_login_sessions' AND column_name='hostel_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_login_sessions' AND column_name='logged_in_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_login_sessions' AND column_name='last_seen_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_login_sessions' AND column_name='last_logout_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_login_sessions' AND column_name='ip_address')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_login_sessions' AND column_name='created_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_user_presence' AND column_name='user_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_user_presence' AND column_name='last_login_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_user_presence' AND column_name='last_seen_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_user_presence' AND column_name='last_logout_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_user_presence' AND column_name='last_active_hostel_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_user_presence' AND column_name='last_login_ip')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_user_presence' AND column_name='login_count')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_notification_channels' AND column_name='user_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_notification_channels' AND column_name='provider_username')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_notification_channels' AND column_name='enabled')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_notification_channels' AND column_name='provider')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='objects' AND column_name='updated_at')
     OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='developer-assets' AND public=true) THEN
    RAISE EXCEPTION 'Run33 preflight failed: Telegram channel columns or public developer-assets bucket are unavailable. No changes applied.';
  END IF;
END
$preflight$;

-- A single row keeps configuration storage very small on the Supabase Free plan.
CREATE TABLE IF NOT EXISTS public.platform_communications (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  release_notes text[] NOT NULL DEFAULT ARRAY[]::text[],
  release_notes_published boolean NOT NULL DEFAULT false,
  release_notes_revision uuid NOT NULL DEFAULT gen_random_uuid(),
  release_notes_published_at timestamptz,
  window_notice_enabled boolean NOT NULL DEFAULT false,
  window_notice_title text NOT NULL DEFAULT '',
  window_notice_body text NOT NULL DEFAULT '',
  window_notice_starts_at timestamptz,
  window_notice_ends_at timestamptz,
  window_notice_frequency text NOT NULL DEFAULT 'once_per_device'
    CHECK (window_notice_frequency IN ('once_per_device','once_per_day','once_per_app_open')),
  window_notice_revision uuid NOT NULL DEFAULT gen_random_uuid(),
  site_notice_enabled boolean NOT NULL DEFAULT false,
  site_notice_mode text NOT NULL DEFAULT 'message' CHECK (site_notice_mode IN ('message','image')),
  site_notice_title text NOT NULL DEFAULT '',
  site_notice_body text NOT NULL DEFAULT '',
  site_notice_image_path text,
  site_notice_starts_at timestamptz,
  site_notice_ends_at timestamptz,
  site_notice_frequency text NOT NULL DEFAULT 'once_per_device'
    CHECK (site_notice_frequency IN ('once_per_device','once_per_day','once_per_app_open')),
  site_notice_revision uuid NOT NULL DEFAULT gen_random_uuid(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_communications_site_image_path_check
    CHECK (site_notice_image_path IS NULL OR site_notice_image_path = 'platform-communications/maintenance-banner.jpg')
);
INSERT INTO public.platform_communications(singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.platform_communications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_communications FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.platform_admin_get_communications()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='শুধু Super Admin প্রকাশনা পরিচালনা করতে পারবেন।', ERRCODE='42501';
  END IF;
  SELECT to_jsonb(c) || jsonb_build_object(
    'site_notice_image_updated_at', (
      SELECT o.updated_at FROM storage.objects o
      WHERE o.bucket_id='developer-assets' AND o.name=c.site_notice_image_path
      LIMIT 1
    )
  ) INTO v_result
  FROM public.platform_communications c WHERE c.singleton=true;
  RETURN COALESCE(v_result, '{}'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_save_communications(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_notes text[] := ARRAY[]::text[];
  v_notes_published boolean := false;
  v_window jsonb := COALESCE(p_payload->'window_notice','{}'::jsonb);
  v_site jsonb := COALESCE(p_payload->'site_notice','{}'::jsonb);
  v_window_enabled boolean := false;
  v_window_title text := '';
  v_window_body text := '';
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_window_frequency text := 'once_per_device';
  v_site_enabled boolean := false;
  v_site_mode text := 'message';
  v_site_title text := '';
  v_site_body text := '';
  v_site_start timestamptz;
  v_site_end timestamptz;
  v_site_frequency text := 'once_per_device';
  v_old public.platform_communications%ROWTYPE;
  v_saved public.platform_communications%ROWTYPE;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='শুধু Super Admin প্রকাশনা পরিবর্তন করতে পারবেন।', ERRCODE='42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_window) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_site) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING MESSAGE='প্রকাশনার তথ্য সঠিক ফরম্যাটে নেই।', ERRCODE='22023';
  END IF;
  IF p_payload ? 'release_notes' AND jsonb_typeof(p_payload->'release_notes') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING MESSAGE='আপডেটের তালিকা সঠিক নয়।', ERRCODE='22023';
  END IF;

  SELECT COALESCE(array_agg(q.note ORDER BY q.ordinality), ARRAY[]::text[])
  INTO v_notes
  FROM (
    SELECT btrim(value) AS note, ordinality
    FROM jsonb_array_elements_text(COALESCE(p_payload->'release_notes','[]'::jsonb)) WITH ORDINALITY
  ) q
  WHERE q.note <> '';
  IF cardinality(v_notes) > 30 OR EXISTS (SELECT 1 FROM unnest(v_notes) n WHERE length(n) > 240) THEN
    RAISE EXCEPTION USING MESSAGE='সর্বোচ্চ ৩০টি আপডেট লিখুন; প্রতিটি ২৪০ অক্ষরের মধ্যে রাখুন।', ERRCODE='22023';
  END IF;
  v_notes_published := COALESCE((p_payload->>'release_notes_published')::boolean,false);
  IF v_notes_published AND cardinality(v_notes)=0 THEN
    RAISE EXCEPTION USING MESSAGE='প্রকাশের আগে অন্তত একটি আপডেট যোগ করুন।', ERRCODE='22023';
  END IF;

  v_window_enabled := COALESCE((v_window->>'enabled')::boolean,false);
  v_window_title := left(btrim(COALESCE(v_window->>'title','')),160);
  v_window_body := left(btrim(COALESCE(v_window->>'body','')),1200);
  v_window_start := NULLIF(btrim(COALESCE(v_window->>'starts_at','')),'')::timestamptz;
  v_window_end := NULLIF(btrim(COALESCE(v_window->>'ends_at','')),'')::timestamptz;
  v_window_frequency := COALESCE(NULLIF(v_window->>'frequency',''),'once_per_device');
  IF v_window_frequency NOT IN ('once_per_device','once_per_day','once_per_app_open') THEN
    RAISE EXCEPTION USING MESSAGE='উইন্ডো নোটিশের প্রদর্শন-নিয়ম সঠিক নয়।', ERRCODE='22023';
  END IF;
  IF v_window_enabled AND v_window_title='' AND v_window_body='' THEN
    RAISE EXCEPTION USING MESSAGE='উইন্ডো নোটিশ চালু করতে শিরোনাম বা বার্তা লিখুন।', ERRCODE='22023';
  END IF;
  IF v_window_start IS NOT NULL AND v_window_end IS NOT NULL AND v_window_end <= v_window_start THEN
    RAISE EXCEPTION USING MESSAGE='উইন্ডো নোটিশের শেষ সময় শুরুর সময়ের পরে হতে হবে।', ERRCODE='22023';
  END IF;

  v_site_enabled := COALESCE((v_site->>'enabled')::boolean,false);
  v_site_mode := COALESCE(NULLIF(v_site->>'mode',''),'message');
  v_site_title := left(btrim(COALESCE(v_site->>'title','')),160);
  v_site_body := left(btrim(COALESCE(v_site->>'body','')),1200);
  v_site_start := NULLIF(btrim(COALESCE(v_site->>'starts_at','')),'')::timestamptz;
  v_site_end := NULLIF(btrim(COALESCE(v_site->>'ends_at','')),'')::timestamptz;
  v_site_frequency := COALESCE(NULLIF(v_site->>'frequency',''),'once_per_device');
  IF v_site_mode NOT IN ('message','image') THEN
    RAISE EXCEPTION USING MESSAGE='ওয়েবসাইট বার্তার ধরন সঠিক নয়।', ERRCODE='22023';
  END IF;
  IF v_site_frequency NOT IN ('once_per_device','once_per_day','once_per_app_open') THEN
    RAISE EXCEPTION USING MESSAGE='ওয়েবসাইট বার্তার প্রদর্শন-নিয়ম সঠিক নয়।', ERRCODE='22023';
  END IF;
  IF v_site_enabled AND v_site_mode='message' AND v_site_title='' AND v_site_body='' THEN
    RAISE EXCEPTION USING MESSAGE='বার্তা চালু করতে শিরোনাম বা বিবরণ লিখুন।', ERRCODE='22023';
  END IF;
  IF v_site_enabled AND v_site_mode='image' AND NOT EXISTS (
    SELECT 1 FROM storage.objects WHERE bucket_id='developer-assets'
      AND name='platform-communications/maintenance-banner.jpg'
  ) THEN
    RAISE EXCEPTION USING MESSAGE='প্রথমে ব্যানার ছবি আপলোড করুন।', ERRCODE='22023';
  END IF;
  IF v_site_start IS NOT NULL AND v_site_end IS NOT NULL AND v_site_end <= v_site_start THEN
    RAISE EXCEPTION USING MESSAGE='ওয়েবসাইট বার্তার শেষ সময় শুরুর সময়ের পরে হতে হবে।', ERRCODE='22023';
  END IF;

  SELECT * INTO v_old FROM public.platform_communications WHERE singleton=true FOR UPDATE;
  UPDATE public.platform_communications SET
    release_notes = v_notes,
    release_notes_published = v_notes_published,
    release_notes_published_at = CASE WHEN v_notes_published THEN COALESCE(v_old.release_notes_published_at, now()) ELSE NULL END,
    release_notes_revision = CASE WHEN v_old.release_notes IS DISTINCT FROM v_notes OR v_old.release_notes_published IS DISTINCT FROM v_notes_published THEN gen_random_uuid() ELSE v_old.release_notes_revision END,
    window_notice_enabled = v_window_enabled,
    window_notice_title = v_window_title,
    window_notice_body = v_window_body,
    window_notice_starts_at = v_window_start,
    window_notice_ends_at = v_window_end,
    window_notice_frequency = v_window_frequency,
    window_notice_revision = CASE WHEN ROW(v_old.window_notice_enabled,v_old.window_notice_title,v_old.window_notice_body,v_old.window_notice_starts_at,v_old.window_notice_ends_at,v_old.window_notice_frequency)
      IS DISTINCT FROM ROW(v_window_enabled,v_window_title,v_window_body,v_window_start,v_window_end,v_window_frequency) THEN gen_random_uuid() ELSE v_old.window_notice_revision END,
    site_notice_enabled = v_site_enabled,
    site_notice_mode = v_site_mode,
    site_notice_title = v_site_title,
    site_notice_body = v_site_body,
    site_notice_image_path = CASE WHEN v_site_mode='image' THEN 'platform-communications/maintenance-banner.jpg' ELSE NULL END,
    site_notice_starts_at = v_site_start,
    site_notice_ends_at = v_site_end,
    site_notice_frequency = v_site_frequency,
    site_notice_revision = CASE WHEN ROW(v_old.site_notice_enabled,v_old.site_notice_mode,v_old.site_notice_title,v_old.site_notice_body,v_old.site_notice_image_path,v_old.site_notice_starts_at,v_old.site_notice_ends_at,v_old.site_notice_frequency)
      IS DISTINCT FROM ROW(v_site_enabled,v_site_mode,v_site_title,v_site_body,CASE WHEN v_site_mode='image' THEN 'platform-communications/maintenance-banner.jpg' ELSE NULL END,v_site_start,v_site_end,v_site_frequency) THEN gen_random_uuid() ELSE v_old.site_notice_revision END,
    updated_by = auth.uid(), updated_at = now()
  WHERE singleton=true
  RETURNING * INTO v_saved;

  RETURN jsonb_build_object(
    'status','saved',
    'release_notes_published',v_saved.release_notes_published,
    'release_notes_revision',v_saved.release_notes_revision,
    'window_notice_revision',v_saved.window_notice_revision,
    'site_notice_revision',v_saved.site_notice_revision,
    'updated_at',v_saved.updated_at
  );
END
$function$;

-- Keep the existing public-settings RPC (and its five-minute client cache) as the
-- single read path for public release notes and scheduled notices.
CREATE OR REPLACE FUNCTION public.get_platform_public_settings()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'announcement_enabled', s.announcement_enabled,
      'announcement_title', s.announcement_title,
      'announcement_body', s.announcement_body,
      'registration_code_required', s.registration_code_required,
      'hostel_creation_code_required', s.hostel_creation_code_required,
      'developer_name', s.developer_name,
      'developer_title', s.developer_title,
      'developer_photo_url', s.developer_photo_url,
      'developer_email', s.developer_email,
      'developer_phone', s.developer_phone,
      'developer_portfolio_url', s.developer_portfolio_url,
      'default_theme', s.default_theme,
      'telegram_enabled', EXISTS (
        SELECT 1 FROM public.platform_notification_provider_settings ps
        WHERE ps.singleton = true AND ps.active_provider = 'telegram'
      ),
      'communications', COALESCE((
        SELECT jsonb_build_object(
          'release_notes_published', c.release_notes_published,
          'release_notes', CASE WHEN c.release_notes_published THEN to_jsonb(c.release_notes) ELSE '[]'::jsonb END,
          'release_notes_revision', c.release_notes_revision,
          'window_notice', CASE WHEN c.window_notice_enabled THEN jsonb_build_object(
            'enabled', true, 'title', c.window_notice_title, 'body', c.window_notice_body,
            'starts_at', c.window_notice_starts_at, 'ends_at', c.window_notice_ends_at,
            'frequency', c.window_notice_frequency, 'revision', c.window_notice_revision
          ) ELSE jsonb_build_object('enabled', false) END,
          'site_notice', CASE WHEN c.site_notice_enabled THEN jsonb_build_object(
            'enabled', true, 'mode', c.site_notice_mode, 'title', c.site_notice_title,
            'body', c.site_notice_body, 'image_path', c.site_notice_image_path,
            'image_updated_at', (SELECT o.updated_at FROM storage.objects o WHERE o.bucket_id='developer-assets' AND o.name=c.site_notice_image_path LIMIT 1),
            'starts_at', c.site_notice_starts_at, 'ends_at', c.site_notice_ends_at,
            'frequency', c.site_notice_frequency, 'revision', c.site_notice_revision
          ) ELSE jsonb_build_object('enabled', false) END
        ) FROM public.platform_communications c WHERE c.singleton=true
      ), jsonb_build_object(
        'release_notes_published',false,'release_notes','[]'::jsonb,
        'window_notice',jsonb_build_object('enabled',false),
        'site_notice',jsonb_build_object('enabled',false)
      )),
      'updated_at', s.updated_at
    )
    FROM public.platform_settings s WHERE s.singleton = true
  ), '{}'::jsonb)
$$;

-- Extend the existing single hostel-scoped member query; no per-member extra RPC.
CREATE OR REPLACE FUNCTION public.platform_admin_list_hostel_members_v3(p_hostel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
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
    'presence_recorded',EXISTS(SELECT 1 FROM private.hl_login_sessions ls WHERE ls.user_id=m.user_id AND ls.hostel_id=m.hostel_id),
    'telegram_connected',EXISTS(SELECT 1 FROM public.user_notification_channels c WHERE c.user_id=m.user_id AND c.provider='telegram' AND c.enabled=true),
    'telegram_username',(SELECT NULLIF(btrim(c.provider_username),'') FROM public.user_notification_channels c WHERE c.user_id=m.user_id AND c.provider='telegram' AND c.enabled=true LIMIT 1)
  ) ORDER BY p.full_name),'[]'::jsonb)
  INTO v_result
  FROM public.hostel_memberships m
  JOIN public.profiles p ON p.id=m.user_id
  WHERE m.hostel_id=p_hostel_id;
  RETURN v_result;
END
$function$;

-- Reuse the already-public developer-assets bucket and a single fixed object path.
-- Upsert replaces that same object; no timestamped filenames or storage accumulation.
DROP POLICY IF EXISTS hostel_life_platform_notice_image_insert ON storage.objects;
CREATE POLICY hostel_life_platform_notice_image_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='developer-assets' AND private.is_super_admin() AND name='platform-communications/maintenance-banner.jpg');
DROP POLICY IF EXISTS hostel_life_platform_notice_image_update ON storage.objects;
CREATE POLICY hostel_life_platform_notice_image_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='developer-assets' AND private.is_super_admin() AND name='platform-communications/maintenance-banner.jpg')
WITH CHECK (bucket_id='developer-assets' AND private.is_super_admin() AND name='platform-communications/maintenance-banner.jpg');

REVOKE ALL ON FUNCTION public.platform_admin_get_communications() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_save_communications(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_platform_public_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_admin_list_hostel_members_v3(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_communications() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_save_communications(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_public_settings() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_hostel_members_v3(uuid) TO authenticated;

COMMIT;
