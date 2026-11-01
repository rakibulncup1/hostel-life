-- Hostel Life Run22: allow assigned assistant managers to perform selected running-month operations.
-- Scope: direct final-meal entry/edit on finalized days, plus hostel rename and join-code settings.
-- Does NOT change archive correction, month start/close, manager transfer, member deactivation,
-- assistant assignment, RLS policies, tables, columns, triggers, or meal-finalization rules.
-- Run once in Supabase SQL Editor after Run1–Run21. Take a database backup first.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';

DO $run22_preflight$
BEGIN
  IF to_regprocedure('public.manager_set_meal_entries(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Run22 stopped: public.manager_set_meal_entries(jsonb) is missing. Apply the project meal migrations first.';
  END IF;
  IF to_regprocedure('public.manager_update_hostel(text)') IS NULL
     OR to_regprocedure('public.regenerate_join_code()') IS NULL
     OR to_regprocedure('public.get_my_membership()') IS NULL THEN
    RAISE EXCEPTION 'Run22 stopped: one or more existing hostel settings RPCs are missing.';
  END IF;
  IF to_regprocedure('private.assert_hostel_manager(uuid,uuid,boolean,boolean)') IS NULL
     OR to_regprocedure('private.is_assistant_manager(uuid,uuid)') IS NULL
     OR to_regprocedure('private.my_hostel_id()') IS NULL THEN
    RAISE EXCEPTION 'Run22 stopped: required manager permission helpers are missing.';
  END IF;
  IF to_regclass('public.period_assistant_managers') IS NULL
     OR to_regclass('public.monthly_periods') IS NULL THEN
    RAISE EXCEPTION 'Run22 stopped: assistant-manager period tables are missing.';
  END IF;
END;
$run22_preflight$;

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
    -- Permit the primary manager and assistants assigned to this exact running period.
    PERFORM private.assert_hostel_manager(v_hostel, v_period.id, false, false);
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
END;
$function$;

-- The settings screen must also be able to display the current join code to an
-- assistant explicitly assigned to the active period. Ordinary members still get NULL.
CREATE OR REPLACE FUNCTION public.get_my_membership()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $run22$
DECLARE
  v jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  SELECT jsonb_build_object(
    'membership_id', m.id,
    'id', m.id,
    'user_id', m.user_id,
    'hostel_id', m.hostel_id,
    'hostel_name', h.name,
    'hostel_status', h.platform_status,
    'join_code', CASE
      WHEN m.role = 'manager' OR EXISTS (
        SELECT 1
        FROM public.monthly_periods mp
        WHERE mp.hostel_id = h.id
          AND mp.status = 'running'
          AND (
            mp.primary_manager_membership_id = m.id
            OR EXISTS (
              SELECT 1
              FROM public.period_assistant_managers a
              WHERE a.period_id = mp.id
                AND a.hostel_id = h.id
                AND a.membership_id = m.id
            )
          )
      ) THEN h.join_code
      ELSE NULL
    END,
    'role', m.role,
    'status', m.status,
    'member_status', m.status,
    'member_name', p.full_name,
    'full_name', p.full_name,
    'phone', p.phone,
    'joined_at', m.joined_at
  )
  INTO v
  FROM public.hostel_memberships m
  JOIN public.hostels h ON h.id = m.hostel_id
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.user_id = auth.uid()
    AND m.status = 'active'
    AND NOT p.is_blocked
  ORDER BY m.created_at DESC
  LIMIT 1;
  RETURN v;
END;
$run22$;


CREATE OR REPLACE FUNCTION public.manager_update_hostel(p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $run22$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  -- Current primary manager or assistant assigned to a running period.
  PERFORM private.assert_hostel_manager(v_hostel, NULL, false, false);
  IF p_name IS NULL OR length(btrim(p_name)) < 2 OR length(btrim(p_name)) > 120 THEN
    RAISE EXCEPTION USING message='মেসের নাম ২ থেকে ১২০ অক্ষরের মধ্যে হতে হবে।', errcode='22023';
  END IF;
  UPDATE public.hostels
  SET name = btrim(p_name)
  WHERE id = v_hostel
  RETURNING jsonb_build_object('hostel_id', id, 'id', id, 'name', name, 'updated_at', updated_at)
  INTO v_result;
  RETURN v_result;
END;
$run22$;

CREATE OR REPLACE FUNCTION public.regenerate_join_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $run22$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_code text;
BEGIN
  PERFORM private.assert_signed_in();
  -- Current primary manager or assistant assigned to a running period.
  PERFORM private.assert_hostel_manager(v_hostel, NULL, false, false);
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  WHILE EXISTS (SELECT 1 FROM public.hostels WHERE join_code = v_code) LOOP
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  END LOOP;
  UPDATE public.hostels SET join_code = v_code WHERE id = v_hostel;
  RETURN v_code;
END;
$run22$;

-- Preserve authenticated-only execution for the replaced SECURITY DEFINER RPCs.
REVOKE ALL ON FUNCTION public.manager_set_meal_entries(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_membership() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.manager_update_hostel(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.regenerate_join_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_set_meal_entries(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_membership() TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_update_hostel(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_join_code() TO authenticated;

COMMIT;
