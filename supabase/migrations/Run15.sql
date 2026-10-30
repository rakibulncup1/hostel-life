-- Incremental, targeted correction: manager_set_meal_entries(jsonb).
-- Run only after backing up the database. Does not rewrite existing meal rows in bulk.
-- The installed function definition was supplied by the project owner on 2026-10-29.
BEGIN;
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
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.assert_hostel_manager(v_hostel, NULL, true, false);
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

    -- Manager entries are for already finalized, past dates in the running period.
    IF v_date >= (now() AT TIME ZONE 'Asia/Dhaka')::date THEN
      RAISE EXCEPTION USING message='আজ বা ভবিষ্যতের দিন এখানে ফাইনাল এন্ট্রি করা যাবে না।',errcode='55000';
    END IF;
    SELECT * INTO v_period FROM public.monthly_periods
      WHERE hostel_id=v_hostel AND status='running'
        AND v_date BETWEEN start_date AND end_date LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING message='একটি বা একাধিক তারিখ চলমান মাসের বাইরে।',errcode='22023';
    END IF;
    SELECT * INTO v_day FROM public.daily_meal_days
      WHERE hostel_id=v_hostel AND period_id=v_period.id AND meal_date=v_date
      FOR UPDATE;
    IF NOT FOUND OR v_day.status <> 'finalized' THEN
      RAISE EXCEPTION USING message='শুধু চূড়ান্ত হওয়া দিনের মিল পরিবর্তন করা যাবে।',errcode='55000';
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
      CASE WHEN v_record.id IS NULL THEN 'পূর্ববর্তী দিনে নতুন চূড়ান্ত মিল এন্ট্রি করা হয়েছে'
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
END
$function$;
COMMIT;
