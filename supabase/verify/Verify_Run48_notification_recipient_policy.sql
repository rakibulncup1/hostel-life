-- READ-ONLY verification for Run48_notification_recipient_policy_and_telegram_format.sql
-- This script never inserts, updates or deletes application data.

SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'delivery_metadata' AND data_type = 'jsonb'
  ) AS delivery_metadata_column_ready,
  to_regprocedure('private.hl_notify_market_insert()') IS NOT NULL AS market_notification_function_ready,
  to_regprocedure('private.hl_notify_ledger_insert()') IS NOT NULL AS ledger_notification_function_ready,
  to_regprocedure('private.hl_notify_khala_insert()') IS NOT NULL AS khala_notification_function_ready,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'notifications'
      AND t.tgname = 'hl_enqueue_notification_delivery_trg' AND NOT t.tgisinternal AND t.tgenabled <> 'D'
  ) AS telegram_outbox_trigger_enabled,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'market_entries'
      AND t.tgname = 'hl_market_notification_total_upd' AND NOT t.tgisinternal AND t.tgenabled <> 'D'
  ) AS market_notification_trigger_enabled,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'ledger_transactions'
      AND t.tgname = 'hl_ledger_notification_ins' AND NOT t.tgisinternal AND t.tgenabled <> 'D'
  ) AS ledger_notification_trigger_enabled,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'khala_money_entries'
      AND t.tgname = 'hl_khala_notification_ins' AND NOT t.tgisinternal AND t.tgenabled <> 'D'
  ) AS khala_notification_trigger_enabled;

-- Function-definition markers: recipient targeting for cash deposit and khala,
-- hostel-wide fanout for market, and no UPDATE notifications for finance rows.
SELECT
  position('NEW.member_id' IN pg_catalog.pg_get_functiondef('private.hl_notify_ledger_insert()'::regprocedure)) > 0
    AND position('v_member_user_id' IN pg_catalog.pg_get_functiondef('private.hl_notify_ledger_insert()'::regprocedure)) > 0
    AS deposit_has_member_target,
  position('v_member_user_id' IN pg_catalog.pg_get_functiondef('private.hl_notify_khala_insert()'::regprocedure)) > 0
    AS khala_has_member_target,
  position('m.status = ''active''' IN pg_catalog.pg_get_functiondef('private.hl_notify_market_insert()'::regprocedure)) > 0
    AS market_keeps_hostel_broadcast,
  position('delivery_metadata' IN pg_catalog.pg_get_functiondef('private.hl_notify_market_insert()'::regprocedure)) > 0
    AS market_telegram_details_enabled,
  position('notification_delivery_outbox' IN pg_catalog.pg_get_functiondef('private.hl_enqueue_notification_delivery()'::regprocedure)) > 0
    AS existing_telegram_outbox_hook_preserved;

-- Delivery metadata is not part of the existing user inbox RPC payload.
SELECT position('delivery_metadata' IN pg_catalog.pg_get_functiondef('public.get_notifications(integer)'::regprocedure)) = 0
  AS provider_metadata_not_exposed_by_inbox_rpc;
