-- Hostel Life Run23: allow today's manager final-meal entry after 21:00 Dhaka.
-- Fixes the Run22 date guard and adds safe lazy finalization when pg_cron is unavailable/delayed.
-- No table, column, RLS, trigger, or historical-row changes. Apply once after Run22.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.manager_set_meal_entries(jsonb)') IS NULL
     OR to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.my_hostel_id()') IS NULL
     OR to_regprocedure('private.assert_hostel_manager(uuid,uuid,boolean,boolean)') IS NULL
     OR to_regprocedure('private.ensure_period_days(uuid)') IS NULL
     OR to_regprocedure('private.finalize_due_days(uuid,uuid)') IS NULL
     OR to_regprocedure('private.is_valid_meal(numeric)') IS NULL THEN
    RAISE EXCEPTION 'Run23 stopped: required Run22 manager or meal-finalization functions are missing; no changes applied.';
  END IF;
  IF to_regclass('public.monthly_periods') IS NULL
     OR to_regclass('public.daily_meal_days') IS NULL
     OR to_regclass('public.daily_meal_records') IS NULL
     OR to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.archive_period_audit') IS NULL THEN
    RAISE EXCEPTION 'Run23 stopped: required meal tables are missing; no changes applied.';
  END IF;
  IF position('assert_hostel_manager' IN pg_get_functiondef('public.manager_set_meal_entries(jsonb)'::regprocedure)) = 0
     OR position('v_period.id, false, false' IN pg_get_functiondef('public.manager_set_meal_entries(jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Run23 stopped: installed manager_set_meal_entries is not the expected Run22 assistant-manager version; no changes applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='daily_meal_days' AND column_name='finalizes_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='daily_meal_days' AND column_name='status')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='daily_meal_records' AND column_name='final_breakfast') THEN
    RAISE EXCEPTION 'Run23 stopped: expected final-meal columns are missing; no changes applied.';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.manager_set_meal_entries(p_entries jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_item jsonb;
  v_hostel uuid := private.my_hostel_id();
  v_period public.monthly_periods%ROWTYPE;
  v_day public.daily_meal_days%ROWTYPE;
  v_record public.daily_meal_records%ROWTYPE;
  v_member public.hostel_memberships%ROWTYPE;
  v_member_name text;
  v_member_id uuid;
  v_date date;
  v_b numeric;
  v_l numeric;
  v_d numeric;
  v_saved integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_record_id uuid;
  v_seen text[] := ARRAY[]::text[];
  v_key text;
  v_dhaka_now timestamp without time zone;
  v_dhaka_today date;
  v_finalized_period_id uuid;
BEGIN
  -- Authenticate first; manager scope is checked against the exact running period below.
  PERFORM private.assert_signed_in();
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION USING message='সংরক্ষণের জন্য মিলের তথ্য নেই।', errcode='22023';
  END IF;
  IF jsonb_array_length(p_entries) > 100 THEN
    RAISE EXCEPTION USING message='একবারে সর্বোচ্চ ১০০টি এন্ট্রি সংরক্ষণ করুন।', errcode='22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
    IF jsonb_typeof(v_item) <> 'object' OR
       COALESCE(v_item->>'member_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
       COALESCE(v_item->>'meal_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION USING message='সদস্য বা তারিখ সঠিক নয়।', errcode='22023';
    END IF;
    v_member_id := (v_item->>'member_id')::uuid;
    v_date := (v_item->>'meal_date')::date;
    v_key := v_member_id::text || ':' || v_date::text;
    IF v_key = ANY(v_seen) THEN
      RAISE EXCEPTION USING message='একই সদস্য ও দিনের একাধিক এন্ট্রি রয়েছে।',errcode='22023';
    END IF;
    v_seen := array_append(v_seen,v_key);
    IF NOT (v_item ? 'breakfast' AND v_item ? 'lunch' AND v_item ? 'dinner') OR
       NOT private.is_valid_meal((v_item->>'breakfast')::numeric) OR
       NOT private.is_valid_meal((v_item->>'lunch')::numeric) OR
       NOT private.is_valid_meal((v_item->>'dinner')::numeric) THEN
      RAISE EXCEPTION USING message='মিলের পরিমাণ সঠিক নয়।',errcode='22023';
    END IF;
    v_b := (v_item->>'breakfast')::numeric;
    v_l := (v_item->>'lunch')::numeric;
    v_d := (v_item->>'dinner')::numeric;

    -- Use the Bangladesh calendar explicitly. Today becomes eligible only at/after 21:00.
    v_dhaka_now := clock_timestamp() AT TIME ZONE 'Asia/Dhaka';
    v_dhaka_today := v_dhaka_now::date;
    IF v_date > v_dhaka_today THEN
      RAISE EXCEPTION USING message='ভবিষ্যতের দিনের ফাইনাল মিল এন্ট্রি বা সংশোধন করা যাবে না।',errcode='55000';
    END IF;

    SELECT * INTO v_period FROM public.monthly_periods
      WHERE hostel_id=v_hostel AND status='running'
        AND v_date BETWEEN start_date AND end_date LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING message='একটি বা একাধিক তারিখ চলমান মাসের বাইরে।',errcode='22023';
    END IF;
    -- Permit the primary manager and assistants assigned to this exact running period.
    PERFORM private.assert_hostel_manager(v_hostel, v_period.id, false, false);

    IF v_date = v_dhaka_today AND v_dhaka_now::time < TIME '21:00' THEN
      RAISE EXCEPTION USING message='আজকের মিল রাত ৯টার আগে চূড়ান্ত করা যাবে না। রাত ৯টার পর আবার চেষ্টা করুন।',errcode='55000';
    END IF;

    -- Cron is optional. Ensure the expected day rows exist and lazily finalize due
    -- days here as a safe fallback when the scheduled job is absent or delayed.
    IF v_finalized_period_id IS DISTINCT FROM v_period.id THEN
      PERFORM private.ensure_period_days(v_period.id);
      PERFORM private.finalize_due_days(v_hostel, v_period.id);
      v_finalized_period_id := v_period.id;
    END IF;

    SELECT * INTO v_day FROM public.daily_meal_days
      WHERE hostel_id=v_hostel AND period_id=v_period.id AND meal_date=v_date
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING message='নির্বাচিত তারিখের মিল-দিনের রেকর্ড পাওয়া যায়নি। আবার তথ্য লোড করে চেষ্টা করুন।',errcode='P0002';
    END IF;
    IF v_day.status <> 'finalized' THEN
      RAISE EXCEPTION USING message='নির্ধারিত সময় পার হলেও দিনটি সার্ভারে এখনো চূড়ান্ত হয়নি। তথ্য আবার লোড করে চেষ্টা করুন।',errcode='55000';
    END IF;
    IF v_date = v_dhaka_today
       AND (v_day.finalizes_at IS NULL OR v_day.finalizes_at > clock_timestamp()) THEN
      RAISE EXCEPTION USING message='আজকের দিনের নির্ধারিত চূড়ান্ত সময় এখনো শেষ হয়নি। রাত ৯টার পর আবার চেষ্টা করুন।',errcode='55000';
    END IF;
    SELECT * INTO v_member FROM public.hostel_memberships
      WHERE id=v_member_id AND hostel_id=v_hostel AND status='active';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING message='সদস্যটি এই মেসের সক্রিয় সদস্য নন।',errcode='42501';
    END IF;
    SELECT p.full_name INTO v_member_name FROM public.profiles p WHERE p.id=v_member.user_id;
    v_member_name := COALESCE(NULLIF(btrim(v_member_name),''),'সদস্য');
    -- Lock an existing row and do not silently resurrect cancelled records.
    SELECT * INTO v_record FROM public.daily_meal_records
      WHERE daily_meal_day_id=v_day.id AND member_id=v_member_id FOR UPDATE;
    IF FOUND THEN
      IF v_record.cancelled THEN
        RAISE EXCEPTION USING message='এই সদস্যের বাতিল করা রেকর্ড আছে। আগে সেটি যাচাই করুন।',errcode='55000';
      END IF;
      UPDATE public.daily_meal_records
      SET final_breakfast=v_b,final_lunch=v_l,final_dinner=v_d,
          actual_breakfast=v_b,actual_lunch=v_l,actual_dinner=v_d,
          finalization_source='manager_edit',finalized_by=auth.uid(),
          finalized_at=now(),updated_by=auth.uid()
      WHERE id=v_record.id;
      v_record_id := v_record.id;
      v_updated := v_updated + 1;
    ELSE
      INSERT INTO public.daily_meal_records(
        hostel_id,period_id,daily_meal_day_id,member_id,member_name_snapshot,
        planned_breakfast,planned_lunch,planned_dinner,
        actual_breakfast,actual_lunch,actual_dinner,
        final_breakfast,final_lunch,final_dinner,
        finalization_source,finalized_by,finalized_at,updated_by,cancelled
      ) VALUES (
        v_hostel,v_period.id,v_day.id,v_member_id,v_member_name,
        v_b,v_l,v_d,v_b,v_l,v_d,v_b,v_l,v_d,
        'manager_edit',auth.uid(),now(),auth.uid(),false
      ) RETURNING id INTO v_record_id;
      v_inserted := v_inserted + 1;
    END IF;
    INSERT INTO public.archive_period_audit(
      hostel_id,period_id,actor_user_id,action,summary,details
    ) VALUES (
      v_hostel,v_period.id,auth.uid(),'update:final_meal',
      CASE WHEN v_record.id IS NULL AND v_date = v_dhaka_today THEN 'আজকের দিনের নতুন চূড়ান্ত মিল এন্ট্রি করা হয়েছে'
           WHEN v_record.id IS NULL THEN 'পূর্ববর্তী দিনে নতুন চূড়ান্ত মিল এন্ট্রি করা হয়েছে'
           ELSE 'চূড়ান্ত মিল সংশোধন করা হয়েছে' END,
      jsonb_build_object('record_id',v_record_id,'member_id',v_member_id,
        'meal_date',v_date,'values',v_item,
        'operation',CASE WHEN v_record.id IS NULL THEN 'insert' ELSE 'update' END)
    );
    v_saved := v_saved + 1;
    v_record := NULL;
  END LOOP;
  RETURN jsonb_build_object('saved_count',v_saved,'inserted_count',v_inserted,
    'updated_count',v_updated,'status','success');
END;
$function$;

REVOKE ALL ON FUNCTION public.manager_set_meal_entries(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_set_meal_entries(jsonb) TO authenticated;
COMMIT;

-- Read-only verification: inspect the installed rule after applying Run23.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS signature,
       position('v_date > v_dhaka_today' IN pg_get_functiondef(p.oid)) > 0 AS blocks_future_dates,
       position('TIME ''21:00''' IN pg_get_functiondef(p.oid)) > 0 AS enforces_9pm_dhaka,
       position('private.finalize_due_days' IN pg_get_functiondef(p.oid)) > 0 AS lazy_finalization_enabled
FROM pg_proc p
WHERE p.oid = 'public.manager_set_meal_entries(jsonb)'::regprocedure;
