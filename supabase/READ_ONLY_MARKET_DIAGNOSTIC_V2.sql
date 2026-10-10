-- HOSTEL LIFE — MARKET ENTRY / EDIT READ-ONLY DIAGNOSTIC V2
-- This file contains SELECT-only diagnostics. It does not call application RPCs,
-- and does not create/alter/drop objects or change rows/permissions.
-- Export the result set as CSV only if market entry/edit still fails after frontend update.

WITH
runtime_info AS (
  SELECT jsonb_build_object(
    'server_version', current_setting('server_version'),
    'database', current_database(),
    'current_user', current_user,
    'transaction_read_only', current_setting('transaction_read_only'),
    'captured_at_utc', now() AT TIME ZONE 'UTC',
    'note', 'SELECT-only diagnostic. This does not prove browser RPC succeeds.'
  ) AS payload
),
market_functions AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema', n.nspname,
    'name', p.proname,
    'identity_arguments', pg_get_function_identity_arguments(p.oid),
    'return_type', pg_get_function_result(p.oid),
    'owner', pg_get_userbyid(p.proowner),
    'security_definer', p.prosecdef,
    'settings', p.proconfig,
    'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'definition', pg_get_functiondef(p.oid)
  ) ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb) AS payload
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public','private')
    AND p.proname IN (
      'create_market_entry','manager_update_market_entry','manager_void_market_entry',
      'get_market_history','get_market_history_v2','get_market_detail','get_market_detail_v2',
      'get_account_history_v2','period_for_hostel_date','can_manage_period','is_manager',
      'current_membership_id','current_hostel_id','audit_archive_period_changes',
      'after_notification_insert','seed_notification_states','set_updated_at'
    )
),
market_relations AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema', n.nspname,
    'table', c.relname,
    'rls_enabled', c.relrowsecurity,
    'rls_forced', c.relforcerowsecurity,
    'estimated_rows', GREATEST(c.reltuples, 0)::bigint,
    'columns', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', col.column_name, 'type', col.data_type, 'nullable', col.is_nullable,
      'default', col.column_default
    ) ORDER BY col.ordinal_position), '[]'::jsonb)
      FROM information_schema.columns col
      WHERE col.table_schema = n.nspname AND col.table_name = c.relname),
    'policies', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', pol.policyname, 'command', pol.cmd, 'roles', pol.roles,
      'using', pol.qual, 'with_check', pol.with_check
    ) ORDER BY pol.policyname), '[]'::jsonb)
      FROM pg_policies pol WHERE pol.schemaname = n.nspname AND pol.tablename = c.relname),
    'triggers', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', t.tgname, 'enabled', t.tgenabled,
      'definition', pg_get_triggerdef(t.oid, true)
    ) ORDER BY t.tgname), '[]'::jsonb)
      FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
    'constraints', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', con.conname, 'type', con.contype, 'validated', con.convalidated,
      'definition', pg_get_constraintdef(con.oid, true)
    ) ORDER BY con.conname), '[]'::jsonb)
      FROM pg_constraint con WHERE con.conrelid = c.oid)
  ) ORDER BY n.nspname, c.relname), '[]'::jsonb) AS payload
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r','p')
    AND c.relname IN (
      'market_entries','market_items','ledger_transactions','monthly_periods',
      'hostel_memberships','profiles','notifications','notification_states'
    )
),
market_acl AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'type', 'table', 'schema', table_schema, 'object', table_name,
    'grantee', grantee, 'privilege', privilege_type, 'grantable', is_grantable
  ) ORDER BY table_name, grantee, privilege_type), '[]'::jsonb) AS payload
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('market_entries','market_items','ledger_transactions','notifications','notification_states')
    AND grantee IN ('anon','authenticated','PUBLIC')
),
market_routine_acl AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema', routine_schema, 'routine', routine_name, 'grantee', grantee,
    'privilege', privilege_type, 'grantable', is_grantable,
    'specific_name', specific_name
  ) ORDER BY routine_schema, routine_name, grantee), '[]'::jsonb) AS payload
  FROM information_schema.routine_privileges
  WHERE routine_schema IN ('public','private')
    AND routine_name IN (
      'create_market_entry','manager_update_market_entry','manager_void_market_entry',
      'get_market_history_v2','get_market_detail_v2','get_account_history_v2',
      'seed_notification_states','after_notification_insert'
    )
),
market_integrity AS (
  SELECT jsonb_build_object(
    'active_entries', (SELECT count(*) FROM public.market_entries WHERE status = 'active'),
    'void_entries', (SELECT count(*) FROM public.market_entries WHERE status = 'void'),
    'all_entries', (SELECT count(*) FROM public.market_entries),
    'all_items', (SELECT count(*) FROM public.market_items),
    'active_item_total', (SELECT COALESCE(sum(mi.amount),0)::numeric(14,2)
      FROM public.market_items mi JOIN public.market_entries me ON me.id = mi.market_entry_id
      WHERE me.status = 'active'),
    'active_header_total', (SELECT COALESCE(sum(me.total_amount),0)::numeric(14,2)
      FROM public.market_entries me WHERE me.status = 'active'),
    'active_total_mismatches', (SELECT count(*)
      FROM public.market_entries me
      LEFT JOIN (SELECT market_entry_id, COALESCE(sum(amount),0) AS items_total
        FROM public.market_items GROUP BY market_entry_id) mi ON mi.market_entry_id = me.id
      WHERE me.status = 'active' AND COALESCE(mi.items_total,0) <> me.total_amount),
    'items_without_parent', (SELECT count(*) FROM public.market_items mi
      LEFT JOIN public.market_entries me ON me.id = mi.market_entry_id WHERE me.id IS NULL),
    'entries_without_period', (SELECT count(*) FROM public.market_entries WHERE period_id IS NULL),
    'running_periods', (SELECT count(*) FROM public.monthly_periods WHERE status = 'running'),
    'periods', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'hostel_id', hostel_id, 'label', label, 'status', status,
      'start_date', start_date, 'end_date', end_date,
      'primary_manager_membership_id', primary_manager_membership_id
    ) ORDER BY start_date DESC), '[]'::jsonb) FROM public.monthly_periods)
  ) AS payload
),
latest_entries AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'market_entry_id', me.id,
    'period_id', me.period_id,
    'hostel_id', me.hostel_id,
    'entry_date', me.entry_date,
    'status', me.status,
    'buyer_membership_id', me.buyer_membership_id,
    'buyer_name', pr.full_name,
    'total_amount', me.total_amount,
    'items_total', COALESCE(items.items_total,0),
    'item_count', COALESCE(items.item_count,0),
    'created_at', me.created_at,
    'updated_at', me.updated_at,
    'credit_to_buyer', me.credit_to_buyer,
    'created_by', me.created_by
  ) ORDER BY me.created_at DESC), '[]'::jsonb) AS payload
  FROM (
    SELECT * FROM public.market_entries ORDER BY created_at DESC LIMIT 30
  ) me
  LEFT JOIN public.hostel_memberships hm ON hm.id = me.buyer_membership_id
  LEFT JOIN public.profiles pr ON pr.id = hm.user_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(mi.amount),0) AS items_total, count(*) AS item_count
    FROM public.market_items mi WHERE mi.market_entry_id = me.id
  ) items ON true
)
SELECT 'RUNTIME'::text AS report_section, 'connection and readonly scope'::text AS object_key, payload FROM runtime_info
UNION ALL SELECT 'MARKET_FUNCTION_DEFINITIONS', 'market RPCs and related helpers', payload FROM market_functions
UNION ALL SELECT 'MARKET_TABLE_SECURITY', 'columns / policies / triggers / constraints', payload FROM market_relations
UNION ALL SELECT 'MARKET_TABLE_GRANTS', 'relevant table privileges', payload FROM market_acl
UNION ALL SELECT 'MARKET_ROUTINE_GRANTS', 'relevant function privileges', payload FROM market_routine_acl
UNION ALL SELECT 'MARKET_DATA_INTEGRITY', 'counts / totals / periods', payload FROM market_integrity
UNION ALL SELECT 'LATEST_MARKET_ENTRIES', 'last 30 entries and item-total comparison', payload FROM latest_entries
ORDER BY report_section;
