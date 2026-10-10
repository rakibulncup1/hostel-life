-- ================================================================
-- HOSTEL LIFE — STABILIZATION-01 VERIFICATION (READ ONLY)
-- Run after HOSTEL_LIFE_STABILIZATION_01.sql succeeds.
-- No data is modified.
-- ================================================================

-- 1) Required stabilization functions
select n.nspname as routine_schema,
       p.proname as routine_name,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private')
  and (
    (n.nspname='public' and p.proname in (
      'get_member_directory_v2',
      'get_running_period_context',
      'get_khala_entry_periods_v2',
      'get_month_close_preflight'
    ))
    or
    (n.nspname='private' and p.proname='start_next_period')
  )
order by n.nspname,p.proname;

-- 2) Execute privileges
select
  has_function_privilege('authenticated','public.get_member_directory_v2()','EXECUTE') as can_member_directory_v2,
  has_function_privilege('authenticated','public.get_running_period_context()','EXECUTE') as can_running_period_context,
  has_function_privilege('authenticated','public.get_khala_entry_periods_v2()','EXECUTE') as can_khala_periods_v2,
  has_function_privilege('authenticated','public.get_month_close_preflight()','EXECUTE') as can_month_close_preflight,
  has_function_privilege('authenticated','public.get_month_management_context()','EXECUTE') as can_month_context,
  has_function_privilege('authenticated','public.close_current_month(boolean)','EXECUTE') as can_close_month,
  has_function_privilege('authenticated','public.start_new_month(date)','EXECUTE') as can_start_new_month;

-- 3) Current user's period/membership diagnostic
select public.get_running_period_context() as running_period_context;

-- 4) Current member directory count + status breakdown
select
  count(*) as member_count,
  count(*) filter (where member_status='active') as active_member_count,
  count(*) filter (where member_status='inactive') as inactive_member_count,
  count(*) filter (where role='manager') as manager_count
from public.get_member_directory_v2();

-- 5) Current running-period count (should normally be 0 or 1; >1 means legacy inconsistency)
select
  hostel_id,
  count(*) as running_period_count
from public.monthly_periods
where status='running'
  and hostel_id=private.current_hostel_id(true)
group by hostel_id;

-- 6) Month-close preflight (manager only; errors for non-primary users are expected)
select public.get_month_close_preflight() as month_close_preflight;

-- 7) Khala periods visible to the current operational manager
select * from public.get_khala_entry_periods_v2();

-- ================================================================
-- EXPECTED
-- 1) All four stabilization public functions + private.start_next_period exist.
-- 2) All listed authenticated execute privileges are true.
-- 3) running_period_context has period=null OR one valid running period.
-- 4) member directory returns your full hostel member list, including inactive members.
-- 5) running_period_count should be exactly 1 while a month is active.
-- 6) primary manager gets a JSON preflight with future_active_request_count and overlap_pair_count.
-- 7) primary/assistant manager gets current Khala period while a running month exists.
-- ================================================================
