-- HOSTEL LIFE — FIX-05 READ-ONLY PREFLIGHT
-- Purpose: verify that the existing report/history RPC dependencies are present.
-- IMPORTANT: this file is read-only. It does not create, alter, delete, or update anything.

select
  n.nspname as routine_schema,
  p.proname as routine_name,
  pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
    'get_market_history',
    'get_market_detail',
    'get_account_history_v2',
    'get_khala_money_history',
    'get_previous_months',
    'get_archived_month_detail',
    'get_member_directory'
  )
order by p.proname, arguments;

select
  routine_schema,
  routine_name,
  privilege_type,
  grantee
from information_schema.routine_privileges
where routine_schema='public'
  and routine_name in (
    'get_market_history',
    'get_market_detail',
    'get_account_history_v2',
    'get_khala_money_history',
    'get_previous_months',
    'get_archived_month_detail',
    'get_member_directory'
  )
  and grantee='authenticated'
  and privilege_type='EXECUTE'
order by routine_name;
