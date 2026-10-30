-- Hostel Life: preserve selected khala recipient on FUTURE entries.
-- Existing unidentified entries are deliberately NOT rewritten.
-- Run once in Supabase SQL Editor after taking a backup.
BEGIN;

DO $preflight$
DECLARE p record; v_names text[]; v_types text[];
BEGIN
  SELECT oid, proname, proargnames, proargtypes, pronargs, proretset,
         pg_get_function_result(oid) AS result_type
  INTO p
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'manager_add_khala_money_for_period'
    AND pronargs = 5;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'অজানা manager_add_khala_money_for_period signature; কোনো পরিবর্তন করা হয়নি। মূল RPC definition যাচাই প্রয়োজন।';
  END IF;
  SELECT array_agg(format_type(p.proargtypes[i], NULL) ORDER BY i)
    INTO v_types FROM generate_series(0,4) i;
  v_names := p.proargnames[1:5];
  IF v_names IS DISTINCT FROM ARRAY['p_period_id','p_member_id','p_amount','p_payment_date','p_description']::text[]
     OR v_types[1] <> 'uuid' OR v_types[2] <> 'uuid'
     OR v_types[3] NOT IN ('numeric','double precision','real')
     OR v_types[4] <> 'date' OR v_types[5] <> 'text'
     OR p.proretset OR p.result_type NOT IN ('jsonb','json','uuid','text','boolean','integer','bigint') THEN
    RAISE EXCEPTION 'খালার টাকার RPC signature অপ্রত্যাশিত (% / % / %); কোনো পরিবর্তন করা হয়নি।', v_names, v_types, p.result_type;
  END IF;
  IF to_regclass('public.khala_money_entries') IS NULL OR
     NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='khala_money_entries' AND column_name='member_id') THEN
    RAISE EXCEPTION 'খালার টাকার member_id column পাওয়া যায়নি; কোনো পরিবর্তন করা হয়নি।';
  END IF;
  IF to_regprocedure('public._hl_original_manager_add_khala_money_for_period(uuid,uuid,numeric,date,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'আগে থেকেই wrapped version পাওয়া গেছে; পুনরায় চালাবেন না।';
  END IF;
END
$preflight$;

-- Only the khala entry transaction supplies this scoped setting.
-- Do not use a shared/session-level parameter: these are transaction-local.
CREATE OR REPLACE FUNCTION private.hl_preserve_khala_recipient()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $trg$
DECLARE v_member_id uuid; v_context text;
BEGIN
  v_context := NULLIF(current_setting('hl.khala_recipient_member_id', true), '');
  IF v_context IS NULL THEN RETURN NEW; END IF;
  v_member_id := v_context::uuid;
  IF NEW.member_id IS NOT NULL AND NEW.member_id IS DISTINCT FROM v_member_id THEN
    RAISE EXCEPTION USING message='খালার টাকার প্রাপক সদস্যের তথ্য মিলছে না।', errcode='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.hostel_memberships m
    WHERE m.id = v_member_id AND m.hostel_id = NEW.hostel_id
  ) THEN
    RAISE EXCEPTION USING message='নির্বাচিত সদস্য এই মেসের নয়।', errcode='22023';
  END IF;
  NEW.member_id := v_member_id;
  RETURN NEW;
END
$trg$;

DROP TRIGGER IF EXISTS hl_preserve_khala_recipient_on_insert ON public.khala_money_entries;
CREATE TRIGGER hl_preserve_khala_recipient_on_insert
BEFORE INSERT ON public.khala_money_entries
FOR EACH ROW EXECUTE FUNCTION private.hl_preserve_khala_recipient();

-- Preserve the original RPC logic/validation (no replacement of accounting rules).
-- Rename the five-argument RPC and install a thin wrapper with identical arguments.
DO $wrap$
DECLARE p record; v_sig text; v_old_ident text; v_sql text; v_ret text; v_amount_type text;
BEGIN
  SELECT oid, pg_get_function_identity_arguments(oid) AS ident,
         pg_get_function_result(oid) AS ret,
         format_type(proargtypes[2],NULL) AS amount_type
    INTO p FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proname='manager_add_khala_money_for_period' AND pronargs=5;
  IF NOT FOUND THEN RAISE EXCEPTION 'মূল খালার টাকা RPC পাওয়া যায়নি।'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname='manager_add_khala_money_for_period' AND pronargs<>5) THEN
    RAISE EXCEPTION 'একাধিক RPC overload পাওয়া গেছে; নিরাপত্তার জন্য বন্ধ করা হয়েছে।';
  END IF;
  v_amount_type := p.amount_type;
  v_ret := p.ret;
  EXECUTE format('ALTER FUNCTION public.manager_add_khala_money_for_period(%s) RENAME TO _hl_original_manager_add_khala_money_for_period', p.ident);
  -- Signature explicitly keeps the named parameters expected by the deployed frontend.
  v_sql := format($make$
    CREATE FUNCTION public.manager_add_khala_money_for_period(
      p_period_id uuid, p_member_id uuid, p_amount %s, p_payment_date date, p_description text
    ) RETURNS %s LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $body$
    DECLARE v_result %s; v_prior text;
    BEGIN
      IF p_member_id IS NULL THEN
        RAISE EXCEPTION USING message='খালার টাকার প্রাপক নির্বাচন করুন।',errcode='22023';
      END IF;
      v_prior := current_setting('hl.khala_recipient_member_id',true);
      PERFORM set_config('hl.khala_recipient_member_id',p_member_id::text,true);
      BEGIN
        v_result := public._hl_original_manager_add_khala_money_for_period(
          p_period_id,p_member_id,p_amount,p_payment_date,p_description
        );
      EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('hl.khala_recipient_member_id',COALESCE(v_prior,''),true);
        RAISE;
      END;
      PERFORM set_config('hl.khala_recipient_member_id',COALESCE(v_prior,''),true);
      RETURN v_result;
    END $body$;
  $make$,v_amount_type,v_ret,v_ret);
  EXECUTE v_sql;
  EXECUTE format('REVOKE ALL ON FUNCTION public._hl_original_manager_add_khala_money_for_period(%s) FROM PUBLIC, anon, authenticated', p.ident);
  EXECUTE format('REVOKE ALL ON FUNCTION public.manager_add_khala_money_for_period(%s) FROM PUBLIC, anon', p.ident);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.manager_add_khala_money_for_period(%s) TO authenticated', p.ident);
END
$wrap$;

COMMIT;

-- Read-only check after installation:
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS signature,
       pg_get_function_result(p.oid) AS returns
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  AND p.proname IN ('manager_add_khala_money_for_period','_hl_original_manager_add_khala_money_for_period')
ORDER BY proname;
-- Old RECIPIENT_NOT_SAVED entries need a separately verified member mapping;
-- this script intentionally makes no historical balance or ownership changes.
