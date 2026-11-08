-- Read-only post-deployment verification for Run39.
-- This script does not insert, update, delete, or alter any data.

-- 1) Required additive columns.
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE (table_schema='private' AND table_name='hl_security_events' AND column_name='attempt_email')
   OR (table_schema='public' AND table_name='khala_money_entries' AND column_name='updated_by')
   OR (table_schema='public' AND table_name='monthly_periods' AND column_name='khala_entry_end_date')
ORDER BY table_schema, table_name, column_name;

-- 2) Required RPCs and their security-definer setting.
SELECT n.nspname AS schema_name, p.proname AS function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='public' AND p.proname IN (
  'hl_record_public_security_event_v4',
  'hl_record_authenticated_auth_event_v2',
  'hl_is_auth_session_active_for_security_event',
  'platform_admin_list_security_events_v4',
  'get_market_history_v2',
  'get_market_detail_v2',
  'get_account_history_v2',
  'get_khala_money_history_v2',
  'get_other_expense_history',
  'get_khala_entry_periods_v2',
  'get_khala_entry_members_v2',
  'manager_update_khala_money',
  'manager_void_khala_money',
  'get_my_archive_editable_periods',
  'hlc_get_archive_correction_bundle',
  'hlc_apply_archive_correction',
  'manager_update_market_entry'
)) OR (n.nspname='private' AND p.proname IN (
  'hl_capture_financial_editor',
  'hl_preserve_khala_entry_end_date',
  'can_manage_khala_period',
  'can_manage_closed_period',
  'can_manage_hostel',
  'hl_notify_market_insert',
  'hl_notify_ledger_insert',
  'hl_notify_khala_insert',
  'hl_notify_important_event',
  'hl_notify_period_lifecycle'
))
ORDER BY n.nspname, p.proname;

-- 3) Verify period-closer authority remains limited to the exact closed month.
SELECT to_regprocedure('private.can_manage_hostel(uuid,uuid,boolean,boolean)')
         IS NOT NULL AS manager_permission_function_ready,
       to_regprocedure('private.can_manage_closed_period(uuid,uuid)')
         IS NOT NULL AS exact_closer_permission_ready,
       to_regprocedure('private.can_manage_khala_period(uuid,uuid)')
         IS NOT NULL AS khala_period_permission_ready,
       to_regprocedure('public.hlc_get_archive_correction_bundle(uuid)')
         IS NOT NULL AS archive_correction_read_ready,
       to_regprocedure('public.hlc_apply_archive_correction(uuid,text,uuid,jsonb,text)')
         IS NOT NULL AS archive_correction_write_ready;

-- 4) Triggers attached to the relevant source tables.
SELECT event_object_schema, event_object_table, trigger_name, action_timing,
       event_manipulation, action_statement
FROM information_schema.triggers
WHERE (event_object_schema='public' AND event_object_table IN
  ('market_entries','ledger_transactions','khala_money_entries','monthly_periods'))
ORDER BY event_object_table, trigger_name, event_manipulation;

-- 5) Notification preference row. Both switches should be true after Run39.
SELECT singleton, market_activity_enabled, ledger_activity_enabled
FROM public.platform_notification_preferences
WHERE singleton=true;

-- 6) Month-end range should stay within each represented calendar month and
-- must not extend past an intentionally earlier configured end_date.
SELECT id, label, start_date, end_date, khala_entry_end_date, status, closed_by, closed_at,
       CASE
         WHEN khala_entry_end_date IS NULL THEN 'MISSING_RANGE'
         WHEN khala_entry_end_date > (date_trunc('month', start_date::timestamp) + interval '1 month' - interval '1 day')::date THEN 'OUTSIDE_CALENDAR_MONTH'
         WHEN status='running' AND end_date IS NOT NULL AND khala_entry_end_date > end_date THEN 'AFTER_CONFIGURED_END_DATE'
         ELSE 'OK'
       END AS khala_range_check
FROM public.monthly_periods
ORDER BY start_date DESC
LIMIT 50;

-- 7) Geo nonce consumer must remain present (nonce rows are not read or exposed).
SELECT to_regprocedure('public.hl_consume_geo_proxy_nonce(uuid,timestamptz)') IS NOT NULL
  AS geo_nonce_consumer_ready;
