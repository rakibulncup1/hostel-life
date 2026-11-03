-- Hostel Life Run31: notification inbox extension, targeted platform messages,
-- optional Telegram linking and asynchronous delivery outbox.
-- No polling, no third-party work until a recipient explicitly links Telegram.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
BEGIN
  IF to_regclass('public.notifications') IS NULL
     OR to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.hostels') IS NULL
     OR to_regclass('public.platform_settings') IS NULL
     OR to_regclass('public.platform_audit_log') IS NULL
     OR to_regclass('public.hostel_pinned_announcements') IS NULL
     OR to_regprocedure('private.is_super_admin()') IS NULL
     OR to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('public.get_notifications(integer)') IS NULL
     OR to_regprocedure('public.get_platform_public_settings()') IS NULL THEN
    RAISE EXCEPTION 'Run31 preflight failed: required notification/platform objects are missing. No changes applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='announcement_batch_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_settings' AND column_name='default_theme')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_settings' AND column_name='updated_by') THEN
    RAISE EXCEPTION 'Run31 preflight failed: Run21/Run28 notification or theme columns are missing. No changes applied.';
  END IF;
  IF to_regprocedure('extensions.digest(bytea,text)') IS NULL
     OR to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION 'Run31 preflight failed: pgcrypto functions are unavailable in schema extensions. No changes applied.';
  END IF;
END
$preflight$;

-- Keep a category on the existing inbox rows. Existing notification producers
-- continue working; the default makes future INSERTs Telegram-aware automatically.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS notification_kind text NOT NULL DEFAULT 'activity';

CREATE TABLE IF NOT EXISTS public.platform_notification_provider_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  active_provider text NOT NULL DEFAULT 'disabled',
  telegram_bot_username text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  outbox_pruned_at timestamptz,
  CONSTRAINT platform_notification_provider_supported
    CHECK (active_provider IN ('disabled','telegram'))
);
INSERT INTO public.platform_notification_provider_settings(singleton, active_provider)
VALUES (true, 'disabled') ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_notification_channels (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  channel_address text NOT NULL,
  provider_user_id text,
  provider_username text,
  enabled boolean NOT NULL DEFAULT true,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider),
  CONSTRAINT user_notification_channels_provider_address_unique UNIQUE (provider, channel_address)
);

CREATE TABLE IF NOT EXISTS public.notification_link_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_link_tokens_user_idx
  ON public.notification_link_tokens(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_link_tokens_expiry_idx
  ON public.notification_link_tokens(expires_at);

CREATE TABLE IF NOT EXISTS public.notification_delivery_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','delivered','failed','skipped')),
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, provider)
);
CREATE INDEX IF NOT EXISTS notification_delivery_outbox_status_idx
  ON public.notification_delivery_outbox(status, created_at)
  WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS notification_delivery_outbox_retention_idx
  ON public.notification_delivery_outbox(created_at)
  WHERE status IN ('delivered','failed','skipped');

-- One webhook event can carry all recipients from a single bulk INSERT statement.
-- The array contains outbox UUIDs only; it never duplicates message content or chat IDs.
CREATE TABLE IF NOT EXISTS public.notification_delivery_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_ids uuid[] NOT NULL CHECK (cardinality(outbox_ids) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','delivered','partial','failed','skipped')),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS notification_delivery_batches_retention_idx
  ON public.notification_delivery_batches(created_at)
  WHERE status IN ('delivered','partial','failed','skipped');

ALTER TABLE public.platform_notification_provider_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notification_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_notification_provider_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.user_notification_channels FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.notification_link_tokens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.notification_delivery_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.notification_delivery_batches FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_notification_provider_settings TO service_role;
GRANT ALL ON public.user_notification_channels TO service_role;
GRANT ALL ON public.notification_link_tokens TO service_role;
GRANT ALL ON public.notification_delivery_outbox TO service_role;
GRANT ALL ON public.notification_delivery_batches TO service_role;

-- User-facing Telegram status: a single authenticated RPC, no direct table access.
CREATE OR REPLACE FUNCTION public.get_my_telegram_notification_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_settings public.platform_notification_provider_settings%ROWTYPE;
  v_channel public.user_notification_channels%ROWTYPE;
  v_connected boolean := false;
BEGIN
  PERFORM private.assert_signed_in();
  SELECT * INTO v_settings FROM public.platform_notification_provider_settings WHERE singleton = true;
  SELECT * INTO v_channel FROM public.user_notification_channels
  WHERE user_id = auth.uid() AND provider = 'telegram' AND enabled = true;
  v_connected := FOUND;
  RETURN jsonb_build_object(
    'active_provider', COALESCE(v_settings.active_provider, 'disabled'),
    'telegram_enabled', COALESCE(v_settings.active_provider = 'telegram', false),
    'bot_username', COALESCE(v_settings.telegram_bot_username, ''),
    'connected', v_connected,
    'connected_at', CASE WHEN v_connected THEN v_channel.connected_at ELSE NULL END,
    'provider_username', CASE WHEN v_connected THEN v_channel.provider_username ELSE NULL END
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.create_my_telegram_link()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_settings public.platform_notification_provider_settings%ROWTYPE;
  v_token text;
  v_expiry timestamptz := now() + interval '10 minutes';
BEGIN
  PERFORM private.assert_signed_in();
  SELECT * INTO v_settings FROM public.platform_notification_provider_settings WHERE singleton = true;
  IF NOT FOUND OR v_settings.active_provider <> 'telegram' OR btrim(v_settings.telegram_bot_username) = '' THEN
    RAISE EXCEPTION USING MESSAGE = 'Telegram সংযোগ এখনো Super Admin চালু করেননি।', ERRCODE = '55000';
  END IF;

  -- Remove expired codes globally and replace this account's previous code.
  -- The expiry index keeps this cleanup bounded without a scheduled job.
  DELETE FROM public.notification_link_tokens WHERE expires_at <= now() OR user_id = auth.uid();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.notification_link_tokens(token_hash, user_id, expires_at)
  VALUES (encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'), auth.uid(), v_expiry);

  RETURN jsonb_build_object(
    'token', v_token,
    'bot_username', regexp_replace(v_settings.telegram_bot_username, '^@', ''),
    'expires_at', v_expiry
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.unlink_my_telegram_notification()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_count integer := 0;
BEGIN
  PERFORM private.assert_signed_in();
  DELETE FROM public.user_notification_channels
  WHERE user_id = auth.uid() AND provider = 'telegram';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  DELETE FROM public.notification_link_tokens WHERE user_id = auth.uid();
  RETURN jsonb_build_object('status', 'success', 'unlinked', v_count > 0);
END
$function$;

-- Called only by the server-side Telegram webhook using the service-role key.
CREATE OR REPLACE FUNCTION public.complete_telegram_notification_link(
  p_token_hash text,
  p_chat_id text,
  p_telegram_user_id text,
  p_username text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'Only the verified Telegram webhook may complete a link.', ERRCODE = '42501';
  END IF;
  IF p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_chat_id IS NULL OR length(p_chat_id) > 32
     OR p_telegram_user_id IS NULL OR length(p_telegram_user_id) > 32 THEN
    RAISE EXCEPTION USING MESSAGE = 'Telegram link request is invalid.', ERRCODE = '22023';
  END IF;

  SELECT t.user_id INTO v_user_id
  FROM public.notification_link_tokens t
  WHERE t.token_hash = p_token_hash AND t.used_at IS NULL AND t.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('linked', false, 'code', 'LINK_EXPIRED_OR_INVALID');
  END IF;

  UPDATE public.notification_link_tokens SET used_at = now() WHERE token_hash = p_token_hash AND used_at IS NULL;
  BEGIN
    INSERT INTO public.user_notification_channels(
      user_id, provider, channel_address, provider_user_id, provider_username, enabled, connected_at, updated_at
    ) VALUES (
      v_user_id, 'telegram', p_chat_id, p_telegram_user_id, nullif(left(p_username, 128), ''), true, now(), now()
    )
    ON CONFLICT (user_id, provider) DO UPDATE SET
      channel_address = EXCLUDED.channel_address,
      provider_user_id = EXCLUDED.provider_user_id,
      provider_username = EXCLUDED.provider_username,
      enabled = true,
      connected_at = now(),
      updated_at = now();
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION USING MESSAGE = 'এই Telegram অ্যাকাউন্টটি অন্য একটি Hostel Life অ্যাকাউন্টের সঙ্গে যুক্ত আছে।', ERRCODE = '23505';
  END;

  DELETE FROM public.notification_link_tokens WHERE user_id = v_user_id;
  RETURN jsonb_build_object('linked', true, 'user_id', v_user_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_get_notification_settings()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_settings public.platform_notification_provider_settings%ROWTYPE; v_connected bigint;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE = 'Only Super Admin can view notification provider settings.', ERRCODE = '42501'; END IF;
  SELECT * INTO v_settings FROM public.platform_notification_provider_settings WHERE singleton = true;
  SELECT count(*) INTO v_connected FROM public.user_notification_channels WHERE provider = 'telegram' AND enabled = true;
  RETURN jsonb_build_object(
    'active_provider', COALESCE(v_settings.active_provider, 'disabled'),
    'telegram_enabled', COALESCE(v_settings.active_provider = 'telegram', false),
    'telegram_bot_username', COALESCE(v_settings.telegram_bot_username, ''),
    'connected_users', v_connected,
    'updated_at', v_settings.updated_at
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_update_notification_settings(
  p_telegram_enabled boolean,
  p_telegram_bot_username text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_username text := regexp_replace(btrim(COALESCE(p_telegram_bot_username, '')), '^@', '');
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE = 'Only Super Admin can update notification provider settings.', ERRCODE = '42501'; END IF;
  IF length(v_username) > 32 OR (v_username <> '' AND v_username !~ '^[A-Za-z0-9_]{5,32}$') THEN
    RAISE EXCEPTION USING MESSAGE = 'Telegram Bot Username সঠিক নয়। @ ছাড়া ৫–৩২ অক্ষর দিন।', ERRCODE = '22023';
  END IF;
  IF COALESCE(p_telegram_enabled, false) AND v_username = '' THEN
    RAISE EXCEPTION USING MESSAGE = 'Telegram চালু করতে Bot Username দিতে হবে।', ERRCODE = '22023';
  END IF;
  INSERT INTO public.platform_notification_provider_settings(singleton, active_provider, telegram_bot_username, updated_by, updated_at)
  VALUES (true, CASE WHEN COALESCE(p_telegram_enabled, false) THEN 'telegram' ELSE 'disabled' END, v_username, auth.uid(), now())
  ON CONFLICT (singleton) DO UPDATE SET
    active_provider = EXCLUDED.active_provider,
    telegram_bot_username = EXCLUDED.telegram_bot_username,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();
  INSERT INTO public.platform_audit_log(actor_user_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'notification_provider_updated', 'notification_provider', 'telegram',
    jsonb_build_object('enabled', COALESCE(p_telegram_enabled, false), 'bot_username', v_username));
  RETURN public.platform_admin_get_notification_settings();
END
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_send_targeted_message(
  p_hostel_id uuid,
  p_title text,
  p_body text,
  p_recipient_user_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_title text := btrim(COALESCE(p_title, ''));
  v_body text := btrim(COALESCE(p_body, ''));
  v_requested integer := 0;
  v_eligible integer := 0;
  v_sent integer := 0;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION USING MESSAGE = 'Only Super Admin can send platform messages.', ERRCODE = '42501'; END IF;
  IF p_hostel_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.hostels h WHERE h.id = p_hostel_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'সঠিক মেস নির্বাচন করুন।', ERRCODE = 'P0002';
  END IF;
  IF v_title = '' OR length(v_title) > 160 OR v_body = '' OR length(v_body) > 3000 THEN
    RAISE EXCEPTION USING MESSAGE = 'শিরোনাম ১–১৬০ এবং বার্তা ১–৩০০০ অক্ষরের মধ্যে হতে হবে।', ERRCODE = '22023';
  END IF;
  IF p_recipient_user_ids IS NOT NULL THEN
    SELECT count(DISTINCT requested.user_id) INTO v_requested
    FROM unnest(p_recipient_user_ids) AS requested(user_id);
    IF v_requested = 0 THEN RAISE EXCEPTION USING MESSAGE = 'অন্তত একজন সদস্য নির্বাচন করুন।', ERRCODE = '22023'; END IF;
  END IF;

  SELECT count(DISTINCT m.user_id) INTO v_eligible
  FROM public.hostel_memberships m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.hostel_id = p_hostel_id AND m.status = 'active' AND NOT COALESCE(p.is_blocked, false)
    AND (p_recipient_user_ids IS NULL OR m.user_id = ANY(p_recipient_user_ids));

  IF v_eligible = 0 THEN RAISE EXCEPTION USING MESSAGE = 'নির্বাচিত মেসে সক্রিয় প্রাপক পাওয়া যায়নি।', ERRCODE = 'P0002'; END IF;
  IF p_recipient_user_ids IS NOT NULL AND v_eligible <> v_requested THEN
    RAISE EXCEPTION USING MESSAGE = 'নির্বাচিত এক বা একাধিক ব্যবহারকারী এই মেসের সক্রিয় সদস্য নন। কোনো বার্তা পাঠানো হয়নি।', ERRCODE = '42501';
  END IF;

  INSERT INTO public.notifications(hostel_id, recipient_user_id, title, body, created_by, notification_kind)
  SELECT p_hostel_id, m.user_id, v_title, v_body, auth.uid(), 'platform_message'
  FROM public.hostel_memberships m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.hostel_id = p_hostel_id AND m.status = 'active' AND NOT COALESCE(p.is_blocked, false)
    AND (p_recipient_user_ids IS NULL OR m.user_id = ANY(p_recipient_user_ids));
  GET DIAGNOSTICS v_sent = ROW_COUNT;

  INSERT INTO public.platform_audit_log(actor_user_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'platform_message_sent', 'hostel', p_hostel_id::text,
    jsonb_build_object('recipient_count', v_sent));

  RETURN jsonb_build_object('status', 'success', 'sent_count', v_sent, 'hostel_id', p_hostel_id);
END
$function$;

-- Extend the existing cached public-settings response with one non-sensitive
-- feature flag. This reuses the existing request; it exposes no bot username,
-- Telegram chat id, token, or per-user connection state.
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
      'updated_at', s.updated_at
    )
    FROM public.platform_settings s WHERE s.singleton = true
  ), '{}'::jsonb)
$$;

-- Preserve the existing pinned-manager notice behavior while classifying it
-- explicitly so the shared inbox and Telegram adapter can label it correctly.
CREATE OR REPLACE FUNCTION public.manager_send_notification(p_title text, p_body text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_count integer := 0;
  v_title text := btrim(COALESCE(p_title, ''));
  v_body text := btrim(COALESCE(p_body, ''));
  v_batch_id uuid := gen_random_uuid();
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.assert_hostel_manager(v_hostel, NULL, false, false);
  IF v_title = '' OR length(v_title) > 160 THEN
    RAISE EXCEPTION USING MESSAGE = 'নোটিশের শিরোনাম ১ থেকে ১৬০ অক্ষরের হতে হবে।', ERRCODE = '22023';
  END IF;
  IF v_body = '' OR length(v_body) > 3000 THEN
    RAISE EXCEPTION USING MESSAGE = 'নোটিশের বিবরণ ১ থেকে ৩০০০ অক্ষরের হতে হবে।', ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('hostel-life-pinned-notice:' || v_hostel::text, 0));
  INSERT INTO public.hostel_pinned_announcements(
    hostel_id, announcement_batch_id, title, body, created_by, created_at, updated_at
  ) VALUES (v_hostel, v_batch_id, v_title, v_body, auth.uid(), now(), now())
  ON CONFLICT (hostel_id) DO UPDATE SET
    announcement_batch_id = EXCLUDED.announcement_batch_id,
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    created_by = EXCLUDED.created_by,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

  INSERT INTO public.notifications(
    hostel_id, recipient_user_id, title, body, created_by, announcement_batch_id, notification_kind
  )
  SELECT v_hostel, m.user_id, v_title, v_body, auth.uid(), v_batch_id, 'manager_message'
  FROM public.hostel_memberships m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.hostel_id = v_hostel AND m.status = 'active' AND NOT p.is_blocked;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'এই মেসে নোটিশ পাওয়ার মতো কোনো সক্রিয় সদস্য পাওয়া যায়নি।', ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('status', 'success', 'sent_count', v_count, 'is_pinned', true, 'announcement_batch_id', v_batch_id);
END
$function$;

-- Replace the existing read RPC to include the message category in the same
-- inbox query. AppShell uses its existing first-load/realtime refresh; no polling added.
CREATE OR REPLACE FUNCTION public.get_notifications(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_hostel uuid := private.my_hostel_id(); v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'notification_id', n.id, 'id', n.id, 'title', n.title, 'body', n.body,
    'created_at', n.created_at, 'seen_at', n.seen_at, 'is_seen', n.seen_at IS NOT NULL,
    'created_by', n.created_by, 'announcement_batch_id', n.announcement_batch_id,
    'notification_kind', n.notification_kind,
    'is_pinned', EXISTS (
      SELECT 1 FROM public.hostel_pinned_announcements a
      WHERE a.hostel_id = n.hostel_id AND a.announcement_batch_id = n.announcement_batch_id
    )
  ) ORDER BY n.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT * FROM public.notifications
    WHERE hostel_id = v_hostel AND recipient_user_id = auth.uid() AND deleted_at IS NULL
    -- Keep unseen platform/system messages inside the existing 50-row fetch
    -- even if ordinary activity has accumulated since the user last logged in.
    ORDER BY (notification_kind IN ('platform_message', 'system_notice') AND seen_at IS NULL) DESC,
             created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  ) n;
  RETURN v_result;
END
$function$;

-- The global banner remains a single platform setting. Only a real enabled
-- content change creates per-user inbox messages (and therefore optional Telegram delivery).
CREATE OR REPLACE FUNCTION private.hl_notify_global_platform_notice()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NEW.announcement_enabled
     AND (OLD.announcement_enabled IS DISTINCT FROM NEW.announcement_enabled
       OR OLD.announcement_title IS DISTINCT FROM NEW.announcement_title
       OR OLD.announcement_body IS DISTINCT FROM NEW.announcement_body)
     AND (btrim(COALESCE(NEW.announcement_title, '')) <> '' OR btrim(COALESCE(NEW.announcement_body, '')) <> '') THEN
    INSERT INTO public.notifications(hostel_id, recipient_user_id, title, body, created_by, notification_kind)
    SELECT DISTINCT ON (m.user_id) m.hostel_id, m.user_id,
      COALESCE(NULLIF(btrim(NEW.announcement_title), ''), 'Hostel Life ঘোষণা'),
      COALESCE(NEW.announcement_body, ''), NEW.updated_by, 'system_notice'
    FROM public.hostel_memberships m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.status = 'active' AND NOT COALESCE(p.is_blocked, false)
    ORDER BY m.user_id, m.created_at DESC;
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS hl_notify_global_platform_notice_trg ON public.platform_settings;
CREATE TRIGGER hl_notify_global_platform_notice_trg
AFTER UPDATE OF announcement_enabled, announcement_title, announcement_body
ON public.platform_settings FOR EACH ROW
EXECUTE FUNCTION private.hl_notify_global_platform_notice();

-- One universal statement-level hook covers current and future notification rows.
-- A bulk INSERT (e.g. Super Admin message/global notice) creates one delivery batch,
-- so the Database Webhook invokes the Edge Function once for the whole recipient set.
CREATE OR REPLACE FUNCTION private.hl_enqueue_notification_delivery()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_provider text;
  v_outbox_ids uuid[];
BEGIN
  SELECT s.active_provider INTO v_provider
  FROM public.platform_notification_provider_settings s WHERE s.singleton = true;
  IF COALESCE(v_provider, 'disabled') = 'telegram' THEN
    WITH inserted AS (
      INSERT INTO public.notification_delivery_outbox(notification_id, recipient_user_id, provider)
      SELECT n.id, n.recipient_user_id, 'telegram'
      FROM new_notifications n
      JOIN public.user_notification_channels c
        ON c.user_id = n.recipient_user_id AND c.provider = 'telegram' AND c.enabled = true
      ON CONFLICT (notification_id, provider) DO NOTHING
      RETURNING id
    )
    SELECT array_agg(id) INTO v_outbox_ids FROM inserted;

    IF COALESCE(cardinality(v_outbox_ids), 0) > 0 THEN
      -- Keep each Webhook invocation bounded: 100 direct recipients per batch.
      -- Large hostel-wide notices are split into multiple bounded batches.
      INSERT INTO public.notification_delivery_batches(outbox_ids)
      SELECT array_agg(chunk.id ORDER BY chunk.ordinality)
      FROM (
        SELECT ids.id, ids.ordinality,
               ((ids.ordinality - 1) / 100)::integer AS batch_number
        FROM unnest(v_outbox_ids) WITH ORDINALITY AS ids(id, ordinality)
      ) AS chunk
      GROUP BY chunk.batch_number;
    END IF;
  END IF;

  -- Bounded metadata cleanup runs at most once per day, on notification traffic.
  -- No cron job, polling, or additional external API request is required.
  UPDATE public.platform_notification_provider_settings
  SET outbox_pruned_at = now()
  WHERE singleton = true
    AND (outbox_pruned_at IS NULL OR outbox_pruned_at < now() - interval '1 day');
  IF FOUND THEN
    UPDATE public.notification_delivery_outbox
    SET status = 'failed', last_error_code = 'DELIVERY_EXPIRED', updated_at = now()
    WHERE status IN ('pending','processing') AND created_at < now() - interval '7 days';
    DELETE FROM public.notification_delivery_outbox
    WHERE created_at < now() - interval '7 days' AND status IN ('delivered','failed','skipped');
    UPDATE public.notification_delivery_batches
    SET status = 'failed', last_error_code = 'DELIVERY_EXPIRED', updated_at = now()
    WHERE status IN ('pending','processing') AND created_at < now() - interval '7 days';
    DELETE FROM public.notification_delivery_batches
    WHERE created_at < now() - interval '7 days' AND status IN ('delivered','partial','failed','skipped');
    DELETE FROM public.notification_link_tokens WHERE expires_at <= now();
  END IF;
  RETURN NULL;
END
$function$;
DROP TRIGGER IF EXISTS hl_enqueue_notification_delivery_trg ON public.notifications;
CREATE TRIGGER hl_enqueue_notification_delivery_trg
AFTER INSERT ON public.notifications
REFERENCING NEW TABLE AS new_notifications
FOR EACH STATEMENT
EXECUTE FUNCTION private.hl_enqueue_notification_delivery();

REVOKE ALL ON FUNCTION public.get_my_telegram_notification_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_my_telegram_link() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlink_my_telegram_notification() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_telegram_notification_link(text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_get_notification_settings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_update_notification_settings(boolean,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_send_targeted_message(uuid,text,text,uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.hl_notify_global_platform_notice() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.hl_enqueue_notification_delivery() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_telegram_notification_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_my_telegram_link() TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_my_telegram_notification() TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_telegram_notification_link(text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_notification_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_update_notification_settings(boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_send_targeted_message(uuid,text,text,uuid[]) TO authenticated;

COMMIT;
