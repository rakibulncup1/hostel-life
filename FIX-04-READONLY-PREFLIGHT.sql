-- Hostel Life FIX-04 — Read-only preflight
-- No data mutation.

select
  to_regprocedure('public.get_account_history_v2(uuid,uuid,integer)') as account_history_v2,
  to_regprocedure('public.get_market_history(uuid,integer)') as market_history,
  to_regprocedure('public.get_market_detail(uuid)') as market_detail,
  to_regprocedure('public.manager_adjust_transaction(uuid,numeric,text)') as adjust_transaction,
  to_regprocedure('public.manager_update_market_entry(uuid,date,uuid,jsonb,boolean,text)') as update_market,
  to_regprocedure('public.manager_void_market_entry(uuid,text)') as void_market,
  to_regprocedure('public.manager_add_deposit(uuid,numeric,date,text)') as add_deposit,
  to_regprocedure('public.manager_add_other_expense(uuid,numeric,date,text)') as add_other_expense,
  to_regprocedure('public.manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)') as add_khala_money;

select
  has_function_privilege('authenticated', 'public.get_account_history_v2(uuid,uuid,integer)', 'EXECUTE') as account_history_execute_for_current_role,
  position('v_manager boolean' in pg_get_functiondef('public.get_account_history_v2(uuid,uuid,integer)'::regprocedure)) > 0 as manager_scope_guard_present;
