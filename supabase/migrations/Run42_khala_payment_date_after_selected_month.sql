-- Hostel Life — Run42: Khala payment date can be later than the selected accounting month.
--
-- Purpose:
--   Keep a Khala payment attached to the month selected by the manager (period_id),
--   while allowing the actual payment_date to be any day from that period's start
--   through the current Bangladesh date. A late payment for a previous month is
--   therefore recorded against that previous month, using the actual payment day.
--
-- Safety:
--   * No table, column, index, constraint, RLS policy, trigger, or historical row is changed.
--   * The exact-period can_manage_khala_period authorization remains mandatory.
--   * Active same-hostel member validation, amount validation and audit rows remain.
--   * Future dates are rejected using Asia/Dhaka business date.
--   * The Run16 wrapper remains in place and continues to set the recipient snapshot context.
--   * Existing closed-month khala_entry_end_date remains an eligibility/period-list field;
--     it is no longer misused as the upper bound of the actual payment date.
--
-- Apply once after the existing Run39 / Run16 / Run20 Khala RPC chain is installed.
-- Take a Supabase backup first. This script is transactional and aborts before changes
-- if the deployed schema or wrapper is not the expected version.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $preflight$
DECLARE
  v_add_wrapper text;
  v_add_wrapper_security_definer boolean;
  v_add_wrapper_result text;
  v_add_inner_result text;
  v_add_wrapper_owner oid;
  v_add_inner_owner oid;
  v_update_result text;
  v_add_argument_names text[];
  v_add_inner_security_definer boolean;
  v_update_security_definer boolean;
  v_trigger_count integer;
BEGIN
  IF to_regclass('public.monthly_periods') IS NULL
     OR to_regclass('public.khala_money_entries') IS NULL
     OR to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.archive_period_audit') IS NULL THEN
    RAISE EXCEPTION 'Run42 preflight: required Khala/accounting table is missing. No change applied.';
  END IF;

  IF to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.can_manage_khala_period(uuid,uuid)') IS NULL
     OR to_regprocedure('private.hl_preserve_khala_recipient()') IS NULL
     OR to_regprocedure('public.get_khala_entry_periods_v2()') IS NULL
     OR to_regprocedure('public.get_khala_entry_members_v2(uuid)') IS NULL
     OR to_regprocedure('public.manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)') IS NULL
     OR to_regprocedure('public._hl_original_manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)') IS NULL
     OR to_regprocedure('public.manager_update_khala_money(uuid,uuid,numeric,date,text)') IS NULL
     OR to_regprocedure('public.manager_void_khala_money(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Run42 preflight: expected Run16/Run20/Run39 Khala helpers or RPC signatures are missing. No change applied.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'manager_add_khala_money_for_period',
        '_hl_original_manager_add_khala_money_for_period',
        'manager_update_khala_money'
      )
      AND p.pronargs <> 5
  ) THEN
    RAISE EXCEPTION 'Run42 preflight: unexpected overload exists for a Khala write RPC. No change applied.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='monthly_periods'
      AND column_name='start_date' AND data_type='date'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='monthly_periods'
      AND column_name='khala_entry_end_date' AND data_type='date'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='khala_money_entries'
      AND column_name='payment_date' AND data_type='date'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='khala_money_entries'
      AND column_name='period_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='khala_money_entries'
      AND column_name='hostel_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='khala_money_entries'
      AND column_name='member_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='khala_money_entries'
      AND column_name='amount' AND data_type='numeric'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='khala_money_entries'
      AND column_name='updated_by' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='khala_money_entries'
      AND column_name='updated_at' AND data_type='timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'Run42 preflight: Khala/monthly-period columns or types differ from the expected Run39 schema. No change applied.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='monthly_periods'
      AND column_name='id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='monthly_periods'
      AND column_name='hostel_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='monthly_periods'
      AND column_name='end_date' AND data_type='date'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='monthly_periods'
      AND column_name='closed_by' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='khala_money_entries'
      AND column_name='id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='khala_money_entries'
      AND column_name='member_name_snapshot'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='khala_money_entries'
      AND column_name='description'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='khala_money_entries'
      AND column_name='status'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='khala_money_entries'
      AND column_name='created_by' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='archive_period_audit'
      AND column_name='hostel_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='archive_period_audit'
      AND column_name='period_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='archive_period_audit'
      AND column_name='actor_user_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='archive_period_audit'
      AND column_name='action'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='archive_period_audit'
      AND column_name='summary'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='hostel_memberships'
      AND column_name='id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='hostel_memberships'
      AND column_name='hostel_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='hostel_memberships'
      AND column_name='user_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='hostel_memberships'
      AND column_name='status'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='full_name'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='archive_period_audit'
      AND column_name='details' AND data_type='jsonb'
  ) THEN
    RAISE EXCEPTION 'Run42 preflight: member/profile/audit columns are incomplete. No change applied.';
  END IF;

  -- Refuse to proceed if a custom CHECK constraint would still block post-period
  -- payment dates. Never drop or weaken such a constraint automatically.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid='public.khala_money_entries'::regclass
      AND c.contype='c'
      AND pg_get_constraintdef(c.oid) ILIKE '%payment_date%'
  ) THEN
    RAISE EXCEPTION 'Run42 preflight: a table CHECK constraint references payment_date. Review it manually; no constraint will be changed automatically.';
  END IF;

  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger t
  WHERE t.tgrelid='public.khala_money_entries'::regclass
    AND t.tgname='hl_preserve_khala_recipient_on_insert'
    AND t.tgfoid='private.hl_preserve_khala_recipient()'::regprocedure
    AND NOT t.tgisinternal
    AND t.tgenabled <> 'D';
  IF v_trigger_count <> 1 THEN
    RAISE EXCEPTION 'Run42 preflight: active Run16/Run20 recipient-preservation trigger is not present exactly once. No change applied.';
  END IF;

  SELECT p.prosecdef INTO v_add_wrapper_security_definer
  FROM pg_proc p
  WHERE p.oid=to_regprocedure('public.manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)');
  SELECT p.prosecdef INTO v_add_inner_security_definer
  FROM pg_proc p
  WHERE p.oid=to_regprocedure('public._hl_original_manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)');
  SELECT p.prosecdef INTO v_update_security_definer
  FROM pg_proc p
  WHERE p.oid=to_regprocedure('public.manager_update_khala_money(uuid,uuid,numeric,date,text)');

  IF NOT COALESCE(v_add_wrapper_security_definer,false)
     OR NOT COALESCE(v_add_inner_security_definer,false)
     OR NOT COALESCE(v_update_security_definer,false) THEN
    RAISE EXCEPTION 'Run42 preflight: Khala write RPC security-definer configuration differs from the expected secured deployment. No change applied.';
  END IF;

  SELECT pg_get_function_result(p.oid),p.proargnames,p.proowner
    INTO v_add_wrapper_result,v_add_argument_names,v_add_wrapper_owner
  FROM pg_proc p
  WHERE p.oid=to_regprocedure('public.manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)');
  SELECT pg_get_function_result(p.oid),p.proowner
    INTO v_add_inner_result,v_add_inner_owner
  FROM pg_proc p
  WHERE p.oid=to_regprocedure('public._hl_original_manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)');
  SELECT pg_get_function_result(p.oid) INTO v_update_result
  FROM pg_proc p
  WHERE p.oid=to_regprocedure('public.manager_update_khala_money(uuid,uuid,numeric,date,text)');
  IF v_add_wrapper_result<>'jsonb' OR v_add_inner_result<>'jsonb' OR v_update_result<>'jsonb'
     OR v_add_argument_names[1:5] IS DISTINCT FROM ARRAY['p_period_id','p_member_id','p_amount','p_payment_date','p_description']::text[] THEN
    RAISE EXCEPTION 'Run42 preflight: Khala RPC return types or named arguments differ from the expected frontend contract. No change applied.';
  END IF;
  IF v_add_wrapper_owner IS DISTINCT FROM v_add_inner_owner THEN
    RAISE EXCEPTION 'Run42 preflight: recipient-safe wrapper and its inner RPC have different owners. Refusing to change inner-function privileges.';
  END IF;
  IF NOT has_function_privilege('authenticated',to_regprocedure('public.manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)'),'EXECUTE')
     OR NOT has_function_privilege('authenticated',to_regprocedure('public.manager_update_khala_money(uuid,uuid,numeric,date,text)'),'EXECUTE') THEN
    RAISE EXCEPTION 'Run42 preflight: authenticated role cannot execute the public Khala write RPCs. No change applied.';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure('public.manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)'))
    INTO v_add_wrapper;
  IF position('_hl_original_manager_add_khala_money_for_period' IN v_add_wrapper)=0
     OR position('hl.khala_recipient_member_id' IN v_add_wrapper)=0
     OR position('set_config' IN lower(v_add_wrapper))=0 THEN
    RAISE EXCEPTION 'Run42 preflight: the Run16 recipient-safe add wrapper is not intact. No change applied.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name='Asia/Dhaka') THEN
    RAISE EXCEPTION 'Run42 preflight: Asia/Dhaka timezone is unavailable. No change applied.';
  END IF;
END
$preflight$;

-- Keep the existing Run16 wrapper intact. It sets a transaction-local recipient ID
-- and calls this private-by-grant inner implementation. The selected period_id is
-- still the accounting month; payment_date may be later than the calendar month.
CREATE OR REPLACE FUNCTION public._hl_original_manager_add_khala_money_for_period(
  p_period_id uuid,
  p_member_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_period public.monthly_periods%ROWTYPE;
  v_member public.hostel_memberships%ROWTYPE;
  v_member_name text;
  v_row public.khala_money_entries%ROWTYPE;
  v_today date := (pg_catalog.now() AT TIME ZONE 'Asia/Dhaka')::date;
  v_period_month_end date;
BEGIN
  PERFORM private.assert_signed_in();

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE id=p_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='মাসের তথ্য পাওয়া যায়নি।',ERRCODE='P0002';
  END IF;

  IF NOT private.can_manage_khala_period(v_period.hostel_id,v_period.id) THEN
    RAISE EXCEPTION USING MESSAGE='এই নির্দিষ্ট মাসে খালার টাকা যোগ বা সংশোধনের অনুমতি নেই।',ERRCODE='42501';
  END IF;

  IF p_amount IS NULL OR p_amount<=0 OR p_amount>100000000 THEN
    RAISE EXCEPTION USING MESSAGE='খালার টাকার পরিমাণ সঠিক নয়।',ERRCODE='22023';
  END IF;

  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='প্রকৃত প্রদানের তারিখ নির্বাচন করুন।',ERRCODE='22023';
  END IF;
  IF p_payment_date<v_period.start_date THEN
    RAISE EXCEPTION USING MESSAGE='প্রদানের তারিখ নির্বাচিত কাজের মাস শুরুর আগের হতে পারবে না।',ERRCODE='22023';
  END IF;
  IF p_payment_date>v_today THEN
    RAISE EXCEPTION USING MESSAGE='প্রদানের তারিখ বাংলাদেশ সময় অনুযায়ী আজকের দিনের পরের হতে পারবে না।',ERRCODE='22023';
  END IF;

  -- Informational only: the entry remains attached to p_period_id even when paid
  -- after month-end. khala_entry_end_date continues to describe that month, not
  -- the latest possible real-world payment date.
  v_period_month_end := COALESCE(v_period.khala_entry_end_date,v_period.end_date);

  SELECT * INTO v_member
  FROM public.hostel_memberships
  WHERE id=p_member_id
    AND hostel_id=v_period.hostel_id
    AND status='active';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='সক্রিয় সদস্যের তথ্য পাওয়া যায়নি।',ERRCODE='P0002';
  END IF;

  SELECT NULLIF(pg_catalog.btrim(p.full_name),'')
  INTO v_member_name
  FROM public.profiles p
  WHERE p.id=v_member.user_id;

  INSERT INTO public.khala_money_entries(
    hostel_id,period_id,member_id,member_name_snapshot,payment_date,amount,description,created_by
  ) VALUES (
    v_period.hostel_id,v_period.id,p_member_id,COALESCE(v_member_name,'সদস্য'),
    p_payment_date,round(p_amount,2),NULLIF(pg_catalog.btrim(p_description),''),auth.uid()
  ) RETURNING * INTO v_row;

  INSERT INTO public.archive_period_audit(
    hostel_id,period_id,actor_user_id,action,summary,details
  ) VALUES (
    v_period.hostel_id,v_period.id,auth.uid(),'insert:khala_money','খালার টাকা যোগ করা হয়েছে',
    pg_catalog.jsonb_build_object(
      'entry_id',v_row.id,
      'member_id',p_member_id,
      'amount',v_row.amount,
      'payment_date',v_row.payment_date,
      'manager_at_close',v_period.closed_by,
      'accounting_period_end',v_period_month_end,
      'payment_date_after_period_end',v_row.payment_date>v_period_month_end
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'entry_id',v_row.id,'id',v_row.id,'period_id',v_row.period_id,
    'amount',v_row.amount,'payment_date',v_row.payment_date,'status','active'
  );
END;
$function$;

-- Update uses the entry's immutable period_id for accounting and authorization.
-- Only the real payment_date window is extended; amount/member/status/audit checks stay.
CREATE OR REPLACE FUNCTION public.manager_update_khala_money(
  p_entry_id uuid,
  p_member_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row public.khala_money_entries%ROWTYPE;
  v_member public.hostel_memberships%ROWTYPE;
  v_period public.monthly_periods%ROWTYPE;
  v_member_name text;
  v_today date := (pg_catalog.now() AT TIME ZONE 'Asia/Dhaka')::date;
  v_period_month_end date;
BEGIN
  PERFORM private.assert_signed_in();

  SELECT * INTO v_row
  FROM public.khala_money_entries
  WHERE id=p_entry_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='খালার টাকার এন্ট্রি পাওয়া যায়নি।',ERRCODE='P0002';
  END IF;

  IF NOT private.can_manage_khala_period(v_row.hostel_id,v_row.period_id) THEN
    RAISE EXCEPTION USING MESSAGE='এই নির্দিষ্ট মাসের এন্ট্রি সম্পাদনার অনুমতি নেই।',ERRCODE='42501';
  END IF;

  IF v_row.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION USING MESSAGE='বাতিল এন্ট্রি সম্পাদনা করা যাবে না।',ERRCODE='55000';
  END IF;

  IF p_member_id IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_amount>100000000 THEN
    RAISE EXCEPTION USING MESSAGE='সদস্য ও টাকার পরিমাণ সঠিকভাবে দিন।',ERRCODE='22023';
  END IF;

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE id=v_row.period_id AND hostel_id=v_row.hostel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='খালার টাকার কাজের মাস পাওয়া যায়নি।',ERRCODE='P0002';
  END IF;

  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='প্রকৃত প্রদানের তারিখ নির্বাচন করুন।',ERRCODE='22023';
  END IF;
  IF p_payment_date<v_period.start_date THEN
    RAISE EXCEPTION USING MESSAGE='প্রদানের তারিখ নির্বাচিত কাজের মাস শুরুর আগের হতে পারবে না।',ERRCODE='22023';
  END IF;
  IF p_payment_date>v_today THEN
    RAISE EXCEPTION USING MESSAGE='প্রদানের তারিখ বাংলাদেশ সময় অনুযায়ী আজকের দিনের পরের হতে পারবে না।',ERRCODE='22023';
  END IF;

  SELECT * INTO v_member
  FROM public.hostel_memberships
  WHERE id=p_member_id
    AND hostel_id=v_row.hostel_id
    AND status='active';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='নির্বাচিত সক্রিয় সদস্য পাওয়া যায়নি।',ERRCODE='P0002';
  END IF;

  SELECT NULLIF(pg_catalog.btrim(p.full_name),'')
  INTO v_member_name
  FROM public.profiles p
  WHERE p.id=v_member.user_id;

  v_period_month_end := COALESCE(v_period.khala_entry_end_date,v_period.end_date);

  UPDATE public.khala_money_entries
  SET member_id=p_member_id,
      member_name_snapshot=COALESCE(v_member_name,'সদস্য'),
      amount=round(p_amount,2),
      payment_date=p_payment_date,
      description=NULLIF(pg_catalog.btrim(p_description),''),
      updated_by=auth.uid(),
      updated_at=pg_catalog.clock_timestamp()
  WHERE id=v_row.id;

  INSERT INTO public.archive_period_audit(
    hostel_id,period_id,actor_user_id,action,summary,details
  ) VALUES (
    v_row.hostel_id,v_row.period_id,auth.uid(),'update:khala_money','খালার টাকার এন্ট্রি সংশোধন করা হয়েছে',
    pg_catalog.jsonb_build_object(
      'entry_id',v_row.id,
      'old_member_id',v_row.member_id,
      'new_member_id',p_member_id,
      'old_amount',v_row.amount,
      'new_amount',round(p_amount,2),
      'old_payment_date',v_row.payment_date,
      'new_payment_date',p_payment_date,
      'manager_at_close',v_period.closed_by,
      'accounting_period_end',v_period_month_end,
      'payment_date_after_period_end',p_payment_date>v_period_month_end
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'entry_id',v_row.id,'period_id',v_row.period_id,
    'amount',round(p_amount,2),'payment_date',p_payment_date,'status','active'
  );
END;
$function$;

-- The internal add implementation must remain callable only through the Run16 wrapper.
REVOKE ALL ON FUNCTION public._hl_original_manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.manager_update_khala_money(uuid,uuid,numeric,date,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manager_update_khala_money(uuid,uuid,numeric,date,text)
  TO authenticated;

COMMENT ON FUNCTION public._hl_original_manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)
  IS 'Khala payment_date may be any day from the selected period start through Asia/Dhaka today; period_id remains the selected accounting month. Invoke through the Run16 recipient-safe wrapper only.';
COMMENT ON FUNCTION public.manager_update_khala_money(uuid,uuid,numeric,date,text)
  IS 'Khala payment_date may be any day from the original selected period start through Asia/Dhaka today; period_id is not changed.';

COMMIT;

-- Read-only post-deployment verification: expected signatures and grants.
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
       'Payment date must be between selected period start_date and dhaka_business_date; period_id remains unchanged.' AS rule;
