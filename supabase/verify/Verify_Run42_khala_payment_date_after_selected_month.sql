-- Read-only verification for Run42_khala_payment_date_after_selected_month.sql
-- This script does not insert, update, delete, or change permissions.

DO $verify$
DECLARE
  v_add text;
  v_update text;
  v_trigger_count integer;
BEGIN
  IF to_regprocedure('public.manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)') IS NULL
     OR to_regprocedure('public._hl_original_manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)') IS NULL
     OR to_regprocedure('public.manager_update_khala_money(uuid,uuid,numeric,date,text)') IS NULL THEN
    RAISE EXCEPTION 'Run42 verification failed: expected Khala RPC signatures are missing.';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure('public._hl_original_manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)'))
    INTO v_add;
  SELECT pg_get_functiondef(to_regprocedure('public.manager_update_khala_money(uuid,uuid,numeric,date,text)'))
    INTO v_update;

  IF position('v_today' IN v_add)=0 OR position('p_payment_date' IN v_add)=0
     OR position('v_today' IN v_update)=0 OR position('p_payment_date' IN v_update)=0 THEN
    RAISE EXCEPTION 'Run42 verification failed: payment-date guards are not present in both write functions.';
  END IF;

  IF v_add ~* 'p_payment_date\s*>\s*COALESCE\s*\('
     OR v_update ~* 'p_payment_date\s*>\s*COALESCE\s*\(' THEN
    RAISE EXCEPTION 'Run42 verification failed: a month-end payment-date ceiling is still present.';
  END IF;

  IF position('can_manage_khala_period' IN v_add)=0
     OR position('can_manage_khala_period' IN v_update)=0 THEN
    RAISE EXCEPTION 'Run42 verification failed: period-level permission checks are missing.';
  END IF;

  IF position('archive_period_audit' IN v_add)=0
     OR position('archive_period_audit' IN v_update)=0 THEN
    RAISE EXCEPTION 'Run42 verification failed: Khala audit writes are missing.';
  END IF;

  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger t
  WHERE t.tgrelid='public.khala_money_entries'::regclass
    AND t.tgname='hl_preserve_khala_recipient_on_insert'
    AND t.tgfoid='private.hl_preserve_khala_recipient()'::regprocedure
    AND NOT t.tgisinternal
    AND t.tgenabled<>'D';
  IF v_trigger_count<>1 THEN
    RAISE EXCEPTION 'Run42 verification failed: recipient-preservation trigger is missing or duplicated.';
  END IF;
END
$verify$;

SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS result_type,
       p.prosecdef AS security_definer,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
WHERE p.oid IN (
  to_regprocedure('public.manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)'),
  to_regprocedure('public._hl_original_manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)'),
  to_regprocedure('public.manager_update_khala_money(uuid,uuid,numeric,date,text)')
)
ORDER BY p.proname;

SELECT (pg_catalog.now() AT TIME ZONE 'Asia/Dhaka')::date AS dhaka_business_date,
       'Payment date: selected period start_date through Bangladesh today; period_id stays the selected accounting month.' AS expected_rule;
