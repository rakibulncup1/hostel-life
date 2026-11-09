-- HOSTEL LIFE RUN40 PRE-FLIGHT (READ ONLY)
-- This query only checks existing database objects. It performs no writes/DDL.
-- Proceed only when every returned row has status READY.
WITH required_tables(table_schema,table_name) AS (VALUES
  ('public','market_entries'),('public','ledger_transactions'),('public','notifications'),
  ('public','platform_notification_preferences'),('public','daily_meal_records'),
  ('public','daily_meal_days'),('public','archive_period_audit'),('public','meal_requests'),
  ('public','monthly_periods'),('public','hostel_memberships'),('public','profiles'),
  ('private','hl_security_events')
),
required_columns(table_schema,table_name,column_name) AS (VALUES
  ('public','market_entries','status'),
  ('public','market_entries','buyer_membership_id'),
  ('public','market_entries','buyer_name_snapshot'),
  ('public','market_entries','credit_to_buyer'),
  ('public','market_entries','created_by'),
  ('public','market_entries','hostel_id'),
  ('public','market_entries','entry_date'),
  ('public','ledger_transactions','status'),
  ('public','ledger_transactions','ledger_type'),
  ('public','ledger_transactions','member_id'),
  ('public','ledger_transactions','member_name_snapshot'),
  ('public','ledger_transactions','amount'),
  ('public','ledger_transactions','created_by'),
  ('public','ledger_transactions','entry_date'),
  ('public','ledger_transactions','description'),
  ('public','ledger_transactions','hostel_id'),
  ('public','notifications','hostel_id'),
  ('public','notifications','recipient_user_id'),
  ('public','notifications','title'),
  ('public','notifications','body'),
  ('public','notifications','created_by'),
  ('public','notifications','notification_kind'),
  ('public','platform_notification_preferences','singleton'),
  ('public','platform_notification_preferences','market_activity_enabled'),
  ('public','platform_notification_preferences','ledger_activity_enabled'),
  ('public','daily_meal_records','daily_meal_day_id'),
  ('public','daily_meal_records','member_id'),
  ('public','daily_meal_records','cancelled'),
  ('public','daily_meal_records','member_name_snapshot'),
  ('public','daily_meal_records','finalized_by'),
  ('public','daily_meal_records','finalized_at'),
  ('public','daily_meal_records','final_breakfast'),
  ('public','daily_meal_records','final_lunch'),
  ('public','daily_meal_records','final_dinner'),
  ('public','daily_meal_days','id'),
  ('public','daily_meal_days','hostel_id'),
  ('public','daily_meal_days','period_id'),
  ('public','daily_meal_days','meal_date'),
  ('public','daily_meal_days','status'),
  ('public','daily_meal_days','finalized_at'),
  ('public','archive_period_audit','hostel_id'),
  ('public','archive_period_audit','period_id'),
  ('public','archive_period_audit','actor_user_id'),
  ('public','archive_period_audit','action'),
  ('public','archive_period_audit','summary'),
  ('public','archive_period_audit','details'),
  ('public','archive_period_audit','created_at'),
  ('public','meal_requests','hostel_id'),
  ('public','meal_requests','period_id'),
  ('public','meal_requests','membership_id'),
  ('public','meal_requests','status'),
  ('public','meal_requests','days'),
  ('public','meal_requests','reviewed_by'),
  ('public','meal_requests','reviewed_at'),
  ('public','meal_requests','submitted_at'),
  ('public','monthly_periods','id'),
  ('public','monthly_periods','hostel_id'),
  ('public','monthly_periods','status'),
  ('public','monthly_periods','start_date'),
  ('public','monthly_periods','end_date'),
  ('public','hostel_memberships','id'),
  ('public','hostel_memberships','hostel_id'),
  ('public','hostel_memberships','user_id'),
  ('public','hostel_memberships','joined_at'),
  ('public','hostel_memberships','deactivated_at'),
  ('public','profiles','id'),
  ('public','profiles','full_name'),
  ('public','profiles','is_blocked'),
  ('private','hl_security_events','event_type'),
  ('private','hl_security_events','ip_address'),
  ('private','hl_security_events','identity_fingerprint'),
  ('private','hl_security_events','attempt_email'),
  ('private','hl_security_events','user_agent'),
  ('private','hl_security_events','request_origin'),
  ('private','hl_security_events','country_code'),
  ('private','hl_security_events','city'),
  ('private','hl_security_events','region'),
  ('private','hl_security_events','region_code'),
  ('private','hl_security_events','created_at')
),
required_functions(item,signature) AS (VALUES
  ('private.assert_signed_in()','private.assert_signed_in()'),
  ('private.my_hostel_id()','private.my_hostel_id()'),
  ('private.assert_hostel_manager(uuid,uuid,boolean,boolean)','private.assert_hostel_manager(uuid,uuid,boolean,boolean)'),
  ('private.hl_notify_market_insert()','private.hl_notify_market_insert()'),
  ('private.hl_notify_ledger_insert()','private.hl_notify_ledger_insert()')
),
checks AS (
  SELECT 'table'::text AS kind, table_schema||'.'||table_name AS item,
    to_regclass(format('%I.%I',table_schema,table_name)) IS NOT NULL AS ready
  FROM required_tables
  UNION ALL
  SELECT 'column', table_schema||'.'||table_name||'.'||column_name,
    EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema=required_columns.table_schema
        AND c.table_name=required_columns.table_name
        AND c.column_name=required_columns.column_name)
  FROM required_columns
  UNION ALL
  SELECT 'column','public.market_entries.total_amount',EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='market_entries' AND column_name='total_amount')
  UNION ALL
  SELECT 'column','public.daily_meal_records.finalization_source',EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='daily_meal_records' AND column_name='finalization_source')
  UNION ALL
  SELECT 'column','private.hl_security_events.attempt_email',EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='hl_security_events' AND column_name='attempt_email')
  UNION ALL
  SELECT 'function',item,to_regprocedure(signature) IS NOT NULL FROM required_functions
  UNION ALL
  SELECT 'constraint','private.hl_security_events.hl_security_events_event_type_run39_check',
    EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid=to_regclass('private.hl_security_events')
        AND conname='hl_security_events_event_type_run39_check')
)
SELECT kind,item,CASE WHEN ready THEN 'READY' ELSE 'MISSING' END AS status
FROM checks
ORDER BY CASE kind WHEN 'table' THEN 1 WHEN 'function' THEN 2 WHEN 'column' THEN 3 ELSE 4 END,item;
