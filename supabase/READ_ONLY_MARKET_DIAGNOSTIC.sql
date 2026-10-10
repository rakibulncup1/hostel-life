-- HOSTEL LIFE: READ-ONLY MARKET DIAGNOSTIC
-- Run only if Market Entry/Market History still fails after FEATURE_RECOVERY_V1 is applied.
-- This script does not modify tables, functions, policies, data, or grants.
-- Export the single result set as CSV and share it for diagnosis.

WITH
market_functions AS (
  SELECT jsonb_agg(jsonb_build_object(
    'schema', n.nspname,
    'function', p.proname,
    'identity_arguments', pg_get_function_identity_arguments(p.oid),
    'return_type', pg_get_function_result(p.oid),
    'security_definer', p.prosecdef,
    'search_path', p.proconfig,
    'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'definition', pg_get_functiondef(p.oid)
  ) ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS payload
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public','private')
    AND p.proname IN ('create_market_entry','manager_update_market_entry','manager_void_market_entry',
                      'get_market_history_v2','get_market_detail_v2','get_running_period_context',
                      'get_member_directory','get_member_directory_v2','get_member_directory_v3','get_member_directory_v4')
),
market_tables AS (
  SELECT jsonb_agg(jsonb_build_object(
    'schema', n.nspname,
    'table', c.relname,
    'rls_enabled', c.relrowsecurity,
    'rls_forced', c.relforcerowsecurity,
    'estimated_rows', GREATEST(c.reltuples, 0)::bigint,
    'columns', (SELECT jsonb_agg(jsonb_build_object(
        'name', col.column_name, 'type', col.data_type, 'nullable', col.is_nullable,
        'default', col.column_default
      ) ORDER BY col.ordinal_position)
      FROM information_schema.columns col
      WHERE col.table_schema=n.nspname AND col.table_name=c.relname),
    'policies', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', pol.policyname, 'command', pol.cmd, 'roles', pol.roles,
        'using', pol.qual, 'with_check', pol.with_check
      ) ORDER BY pol.policyname),'[]'::jsonb)
      FROM pg_policies pol WHERE pol.schemaname=n.nspname AND pol.tablename=c.relname),
    'triggers', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', t.tgname, 'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid, true)
      ) ORDER BY t.tgname),'[]'::jsonb)
      FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
    'constraints', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', con.conname, 'type', con.contype, 'validated', con.convalidated,
        'definition', pg_get_constraintdef(con.oid, true)
      ) ORDER BY con.conname),'[]'::jsonb)
      FROM pg_constraint con WHERE con.conrelid=c.oid)
  ) ORDER BY c.relname) AS payload
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
    AND c.relname IN ('market_entries','market_items','ledger_transactions','monthly_periods','hostel_memberships')
),
market_counts AS (
  SELECT jsonb_build_object(
    'active_market_entries', (SELECT count(*) FROM public.market_entries WHERE status='active'),
    'void_market_entries', (SELECT count(*) FROM public.market_entries WHERE status='void'),
    'all_market_entries', (SELECT count(*) FROM public.market_entries),
    'all_market_items', (SELECT count(*) FROM public.market_items),
    'active_item_total', (SELECT COALESCE(sum(mi.amount),0) FROM public.market_items mi JOIN public.market_entries me ON me.id=mi.market_entry_id WHERE me.status='active'),
    'active_entry_total', (SELECT COALESCE(sum(me.total_amount),0) FROM public.market_entries me WHERE me.status='active'),
    'running_periods', (SELECT count(*) FROM public.monthly_periods WHERE status='running'),
    'periods', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'label',label,'status',status,'start_date',start_date,'end_date',end_date,'hostel_id',hostel_id) ORDER BY start_date DESC),'[]'::jsonb) FROM public.monthly_periods),
    'market_entry_period_nulls', (SELECT count(*) FROM public.market_entries WHERE period_id IS NULL),
    'market_item_parent_missing', (SELECT count(*) FROM public.market_items mi LEFT JOIN public.market_entries me ON me.id=mi.market_entry_id WHERE me.id IS NULL)
  ) AS payload
),
market_acls AS (
  SELECT jsonb_agg(jsonb_build_object(
    'table', table_name, 'grantee', grantee, 'privilege', privilege_type
  ) ORDER BY table_name, grantee, privilege_type) AS payload
  FROM information_schema.role_table_grants
  WHERE table_schema='public' AND table_name IN ('market_entries','market_items','ledger_transactions')
    AND grantee IN ('anon','authenticated','PUBLIC')
),
market_indexes AS (
  SELECT jsonb_agg(jsonb_build_object(
    'table', t.relname, 'index', i.relname, 'valid', ix.indisvalid,
    'ready', ix.indisready, 'unique', ix.indisunique, 'definition', pg_get_indexdef(i.oid)
  ) ORDER BY t.relname,i.relname) AS payload
  FROM pg_index ix JOIN pg_class t ON t.oid=ix.indrelid JOIN pg_class i ON i.oid=ix.indexrelid
  JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relname IN ('market_entries','market_items','ledger_transactions')
)
SELECT 'MARKET_FUNCTIONS'::text AS section, 'public/private market and member RPCs'::text AS object_key, COALESCE(payload,'[]'::jsonb) AS payload FROM market_functions
UNION ALL SELECT 'MARKET_TABLES_SECURITY','tables / RLS / policies / triggers / constraints',COALESCE(payload,'[]'::jsonb) FROM market_tables
UNION ALL SELECT 'MARKET_COUNTS_AND_PERIODS','business counts and period IDs',payload FROM market_counts
UNION ALL SELECT 'MARKET_TABLE_GRANTS','table privileges',COALESCE(payload,'[]'::jsonb) FROM market_acls
UNION ALL SELECT 'MARKET_INDEXES','market/ledger indexes',COALESCE(payload,'[]'::jsonb) FROM market_indexes
ORDER BY section;
