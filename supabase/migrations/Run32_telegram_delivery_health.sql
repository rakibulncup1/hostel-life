-- Hostel Life Run32: Super Admin-only Telegram delivery diagnostics.
-- Read-only inspection of the existing Run31 delivery pipeline. No user or
-- notification data is modified by this migration or its diagnostic RPC.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '45s';

DO $preflight$
BEGIN
  IF to_regclass('public.platform_notification_provider_settings') IS NULL
     OR to_regclass('public.user_notification_channels') IS NULL
     OR to_regclass('public.notification_delivery_batches') IS NULL
     OR to_regclass('public.notification_delivery_outbox') IS NULL
     OR to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'Run32 preflight failed: apply Run31_notification_hub_and_telegram_delivery.sql first. No changes applied.';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'platform_notification_provider_settings'
         AND column_name = 'singleton'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'platform_notification_provider_settings'
         AND column_name = 'active_provider'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'platform_notification_provider_settings'
         AND column_name = 'telegram_bot_username'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'user_notification_channels'
         AND column_name IN ('provider', 'enabled')
       GROUP BY table_name
       HAVING count(DISTINCT column_name) = 2
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'notification_delivery_batches'
         AND column_name IN ('id', 'outbox_ids', 'status', 'last_error_code', 'created_at', 'updated_at', 'delivered_at')
       GROUP BY table_name
       HAVING count(DISTINCT column_name) = 7
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'notification_delivery_outbox'
         AND column_name IN ('status', 'created_at')
       GROUP BY table_name
       HAVING count(DISTINCT column_name) = 2
     ) THEN
    RAISE EXCEPTION 'Run32 preflight failed: Run31 tables exist but required columns do not match. No changes applied.';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.platform_admin_get_telegram_delivery_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_provider text := 'disabled';
  v_bot_username text := '';
  v_connected bigint := 0;
  v_database_webhook_ready boolean := false;
  v_pending bigint := 0;
  v_processing bigint := 0;
  v_delivered bigint := 0;
  v_partial bigint := 0;
  v_failed bigint := 0;
  v_skipped bigint := 0;
  v_latest_status text;
  v_latest_error text;
  v_latest_created_at timestamptz;
  v_outbox_pending bigint := 0;
  v_outbox_failed bigint := 0;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE = 'শুধু Super Admin Telegram Delivery Health দেখতে পারবেন।', ERRCODE = '42501';
  END IF;

  SELECT COALESCE(s.active_provider, 'disabled'), COALESCE(s.telegram_bot_username, '')
    INTO v_provider, v_bot_username
  FROM public.platform_notification_provider_settings s
  WHERE s.singleton = true;
  v_provider := COALESCE(v_provider, 'disabled');
  v_bot_username := COALESCE(v_bot_username, '');

  SELECT count(*) INTO v_connected
  FROM public.user_notification_channels c
  WHERE c.provider = 'telegram' AND c.enabled = true;

  -- Supabase Dashboard Database Webhooks use supabase_functions.http_request.
  -- This verifies the trigger exists without exposing headers or stored secrets.
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'notification_delivery_batches'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
      AND (t.tgtype::integer & 4) = 4 -- INSERT event is required
      AND pn.nspname = 'supabase_functions'
      AND p.proname = 'http_request'
  ) INTO v_database_webhook_ready;

  SELECT
    count(*) FILTER (WHERE b.status = 'pending'),
    count(*) FILTER (WHERE b.status = 'processing'),
    count(*) FILTER (WHERE b.status = 'delivered'),
    count(*) FILTER (WHERE b.status = 'partial'),
    count(*) FILTER (WHERE b.status = 'failed'),
    count(*) FILTER (WHERE b.status = 'skipped')
  INTO v_pending, v_processing, v_delivered, v_partial, v_failed, v_skipped
  FROM public.notification_delivery_batches b
  WHERE b.created_at >= now() - interval '7 days';

  SELECT b.status, b.last_error_code, b.created_at
    INTO v_latest_status, v_latest_error, v_latest_created_at
  FROM public.notification_delivery_batches b
  ORDER BY b.created_at DESC
  LIMIT 1;

  SELECT
    count(*) FILTER (WHERE o.status IN ('pending', 'processing')),
    count(*) FILTER (WHERE o.status = 'failed')
  INTO v_outbox_pending, v_outbox_failed
  FROM public.notification_delivery_outbox o
  WHERE o.created_at >= now() - interval '7 days';

  RETURN jsonb_build_object(
    'provider_enabled', v_provider = 'telegram',
    'provider', v_provider,
    'bot_username', v_bot_username,
    'connected_users', v_connected,
    'database_webhook_ready', v_database_webhook_ready,
    'window_days', 7,
    'batches', jsonb_build_object(
      'pending', COALESCE(v_pending, 0),
      'processing', COALESCE(v_processing, 0),
      'delivered', COALESCE(v_delivered, 0),
      'partial', COALESCE(v_partial, 0),
      'failed', COALESCE(v_failed, 0),
      'skipped', COALESCE(v_skipped, 0),
      'latest_status', v_latest_status,
      'latest_error_code', v_latest_error,
      'latest_created_at', v_latest_created_at
    ),
    'outbox', jsonb_build_object(
      'pending_or_processing', COALESCE(v_outbox_pending, 0),
      'failed', COALESCE(v_outbox_failed, 0)
    ),
    'generated_at', now()
  );
END
$function$;

REVOKE ALL ON FUNCTION public.platform_admin_get_telegram_delivery_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_telegram_delivery_health() TO authenticated;

-- Aggregate batch list for Super Admin drill-down. No recipient IDs, chat IDs,
-- notification titles, or message bodies are returned.
CREATE OR REPLACE FUNCTION public.platform_admin_list_telegram_delivery_batches(
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_status text := NULLIF(lower(btrim(COALESCE(p_status, ''))), 'all');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_offset integer := LEAST(GREATEST(COALESCE(p_offset, 0), 0), 5000);
  v_total bigint := 0;
  v_items jsonb := '[]'::jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE = 'শুধু Super Admin Telegram Delivery Batch দেখতে পারবেন।', ERRCODE = '42501';
  END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('pending', 'processing', 'delivered', 'partial', 'failed', 'skipped') THEN
    RAISE EXCEPTION USING MESSAGE = 'সঠিক Delivery Status নির্বাচন করুন।', ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.notification_delivery_batches b
  WHERE b.created_at >= now() - interval '7 days'
    AND (v_status IS NULL OR b.status = v_status);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', page.id,
      'status', page.status,
      'created_at', page.created_at,
      'updated_at', page.updated_at,
      'delivered_at', page.delivered_at,
      'last_error_code', page.last_error_code,
      'recipient_count', page.recipient_count
    ) ORDER BY page.created_at DESC
  ), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT b.id, b.status, b.created_at, b.updated_at, b.delivered_at,
      b.last_error_code, COALESCE(cardinality(b.outbox_ids), 0) AS recipient_count
    FROM public.notification_delivery_batches b
    WHERE b.created_at >= now() - interval '7 days'
      AND (v_status IS NULL OR b.status = v_status)
    ORDER BY b.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) AS page;

  RETURN jsonb_build_object(
    'items', v_items,
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'window_days', 7
  );
END
$function$;

REVOKE ALL ON FUNCTION public.platform_admin_list_telegram_delivery_batches(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_telegram_delivery_batches(text, integer, integer) TO authenticated;

COMMIT;
