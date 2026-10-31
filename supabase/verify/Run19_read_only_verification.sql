-- READ-ONLY verification for Run19_member_month_lifecycle_rules.sql.
-- This script does not insert, update, delete, or alter database objects.

-- 1) Expected lifecycle RPCs and the new private helper should exist.
WITH expected(signature, routine) AS (
  VALUES
    ('public.start_new_month(date)', to_regprocedure('public.start_new_month(date)')),
    ('public.deactivate_member(uuid)', to_regprocedure('public.deactivate_member(uuid)')),
    ('public.close_current_month(boolean)', to_regprocedure('public.close_current_month(boolean)')),
    ('public.get_month_close_preflight()', to_regprocedure('public.get_month_close_preflight()')),
    ('private.apply_request_days_for_finalized_day_ids(uuid,uuid[])', to_regprocedure('private.apply_request_days_for_finalized_day_ids(uuid,uuid[])')),
    ('public.create_meal_correction_request(date,date,jsonb,uuid)', to_regprocedure('public.create_meal_correction_request(date,date,jsonb,uuid)')),
    ('public.edit_my_approved_meal_request(uuid,date,date,jsonb)', to_regprocedure('public.edit_my_approved_meal_request(uuid,date,date,jsonb)'))
)
SELECT signature, routine IS NOT NULL AS exists
FROM expected
ORDER BY signature;

-- 2) The two lifecycle validation triggers should be attached and enabled.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  p.proname AS trigger_function,
  t.tgenabled AS enabled_state
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_proc p ON p.oid=t.tgfoid
WHERE n.nspname='public'
  AND c.relname IN ('monthly_periods','meal_requests')
  AND t.tgname IN ('hl_b_guard_period_dates','hl_b_guard_meal_request_dates')
  AND NOT t.tgisinternal
ORDER BY c.relname,t.tgname;

-- 3) These private helpers must not be executable directly by anon/authenticated.
SELECT
  has_function_privilege('anon','private.hl_b_guard_period_dates()','EXECUTE') AS anon_can_execute_period_guard,
  has_function_privilege('authenticated','private.hl_b_guard_period_dates()','EXECUTE') AS authenticated_can_execute_period_guard,
  has_function_privilege('anon','private.hl_b_guard_meal_request_dates()','EXECUTE') AS anon_can_execute_request_guard,
  has_function_privilege('authenticated','private.hl_b_guard_meal_request_dates()','EXECUTE') AS authenticated_can_execute_request_guard,
  has_function_privilege('anon','private.apply_request_days_for_finalized_day_ids(uuid,uuid[])','EXECUTE') AS anon_can_execute_special_apply_helper,
  has_function_privilege('authenticated','private.apply_request_days_for_finalized_day_ids(uuid,uuid[])','EXECUTE') AS authenticated_can_execute_special_apply_helper;

-- 4) No hostel should have more than one running period.
SELECT hostel_id, count(*) AS running_period_count
FROM public.monthly_periods
WHERE status='running'
GROUP BY hostel_id
HAVING count(*)>1;
