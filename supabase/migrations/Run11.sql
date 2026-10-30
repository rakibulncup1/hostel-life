-- 2026-10-28 incremental patch. Run only AFTER 20261027_finishing_reliability.sql.
-- Changes 4 existing RPC bodies without modifying financial tables or past records.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.create_late_meal_request(date,numeric,numeric,numeric,text)') IS NULL
     OR to_regprocedure('public.create_meal_correction_request(date,date,jsonb,uuid)') IS NULL
     OR to_regprocedure('public.edit_my_approved_meal_request(uuid,date,date,jsonb)') IS NULL
     OR to_regprocedure('public.manager_review_correction(uuid,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'আগের Finishing migration-এর RPC পাওয়া যায়নি; SQL পরিবর্তন করা হয়নি।';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.create_late_meal_request(
  p_meal_date date,
  p_breakfast numeric,
  p_lunch numeric,
  p_dinner numeric,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_local_now timestamp without time zone := now() AT TIME ZONE 'Asia/Dhaka';
  v_today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
  v_hostel uuid;
  v_membership uuid;
  v_period public.monthly_periods%ROWTYPE;
  v_days jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  v_hostel := private.my_hostel_id();
  v_membership := private.my_membership_id();
  IF v_local_now::time >= TIME '21:00' AND v_local_now::time < TIME '22:00' THEN
    RAISE EXCEPTION USING message='লেট অনুরোধ রাত ১০টা থেকে পরদিন রাত ৯টার আগে পর্যন্ত দেওয়া যাবে।', errcode='55000';
  END IF;
  IF p_meal_date IS DISTINCT FROM (CASE WHEN v_local_now::time >= TIME '22:00' THEN v_today + 1 ELSE v_today END) THEN
    RAISE EXCEPTION USING message='লেট অনুরোধ শুধু বর্তমান খোলা-থাকা দিনের জন্য দেওয়া যাবে।', errcode='22023';
  END IF;
  SELECT * INTO v_period FROM public.monthly_periods
  WHERE hostel_id = v_hostel AND status = 'running'
    AND p_meal_date >= start_date AND p_meal_date <= end_date
  ORDER BY start_date DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='কোনো উপযুক্ত চলমান মাস নেই অথবা আগামী দিনের তারিখটি মাসের মধ্যে পড়ে না।', errcode='55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.meal_requests r
    CROSS JOIN LATERAL jsonb_array_elements(r.days) d
    WHERE r.hostel_id = v_hostel AND r.period_id = v_period.id
      AND r.membership_id = v_membership AND r.status IN ('submitted','approved')
      AND (d->>'meal_date')::date = p_meal_date
  ) THEN
    RAISE EXCEPTION USING message='এই তারিখের জন্য একটি সক্রিয় মিল অনুরোধ ইতিমধ্যে আছে। অনুরোধের ইতিহাস যাচাই করুন।', errcode='23505';
  END IF;

  IF v_local_now::time < TIME '21:00' AND p_meal_date = v_today AND EXISTS (
    SELECT 1 FROM public.daily_meal_days d WHERE d.period_id = v_period.id AND d.meal_date = p_meal_date AND d.status IN ('finalized','cancelled')
  ) THEN
    RAISE EXCEPTION USING message='এই দিনের মিল ইতিমধ্যে চূড়ান্ত বা বাতিল হয়েছে।',errcode='55000';
  END IF;
  v_days := jsonb_build_array(jsonb_build_object(
    'meal_date', p_meal_date,
    'breakfast', p_breakfast,
    'lunch', p_lunch,
    'dinner', p_dinner
  ));
  RETURN private.create_meal_request_internal(
    v_membership, p_meal_date, p_meal_date, v_days,
    'normal', true, p_reason, 'member', NULL
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.create_meal_correction_request(
  p_start_date date,
  p_end_date date,
  p_days jsonb,
  p_parent_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_hostel uuid;
  v_membership uuid;
  v_parent public.meal_requests%ROWTYPE;
  v_period public.monthly_periods%ROWTYPE;
  v_item jsonb;
  v_date date;
  v_day public.daily_meal_days%ROWTYPE;
  v_min_date date;
  v_max_date date;
  v_now_dhaka timestamp := now() AT TIME ZONE 'Asia/Dhaka';
  v_today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
  v_target date;
BEGIN
  PERFORM private.assert_signed_in();
  IF v_now_dhaka::time >= TIME '21:00' AND v_now_dhaka::time < TIME '22:00' THEN
    RAISE EXCEPTION USING message='সংশোধন আবেদন রাত ৯টা থেকে ১০টার মধ্যে বন্ধ থাকে।',errcode='55000';
  END IF;
  v_target := CASE WHEN v_now_dhaka::time >= TIME '22:00' THEN v_today + 1 ELSE v_today END;
  v_hostel := private.my_hostel_id();
  v_membership := private.my_membership_id();
  IF p_parent_request_id IS NULL THEN
    RAISE EXCEPTION USING message='সংশোধনের জন্য মূল অনুমোদিত অনুরোধটি নির্বাচন করতে হবে।', errcode='22023';
  END IF;
  SELECT * INTO v_parent FROM public.meal_requests
  WHERE id = p_parent_request_id AND hostel_id = v_hostel AND membership_id = v_membership
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='মূল অনুরোধটি পাওয়া যায়নি বা এটি আপনার নয়।', errcode='42501';
  END IF;
  IF v_parent.status <> 'approved' OR v_parent.request_type <> 'normal' OR v_parent.is_late_request THEN
    RAISE EXCEPTION USING message='শুধু নিজের অনুমোদিত সাধারণ অনুরোধের জন্য সংশোধন পাঠানো যাবে।', errcode='42501';
  END IF;
  SELECT * INTO v_period FROM public.monthly_periods
  WHERE id = v_parent.period_id AND hostel_id = v_hostel AND status = 'running';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='সংশোধনের মূল মাসটি আর চলমান নেই।', errcode='55000';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date
     OR p_start_date < v_period.start_date OR p_end_date > v_period.end_date THEN
    RAISE EXCEPTION USING message='সংশোধনের তারিখ চলমান মাসের সীমার বাইরে।', errcode='22023';
  END IF;
  PERFORM private.assert_meal_days(p_days, v_parent.period_id, true);
  SELECT min((value->>'meal_date')::date), max((value->>'meal_date')::date)
  INTO v_min_date, v_max_date FROM jsonb_array_elements(p_days);
  IF v_min_date IS DISTINCT FROM p_start_date OR v_max_date IS DISTINCT FROM p_end_date THEN
    RAISE EXCEPTION USING message='সংশোধনের তারিখের পরিসর নির্বাচিত দিনগুলোর সঙ্গে মিলছে না।', errcode='22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_days) LOOP
    v_date := (v_item->>'meal_date')::date;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_parent.days) parent_day
      WHERE (parent_day->>'meal_date')::date = v_date
    ) THEN
      RAISE EXCEPTION USING message='মূল অনুরোধে নেই এমন দিনের মিল সংশোধন করা যাবে না।', errcode='22023';
    END IF;
    SELECT * INTO v_day FROM public.daily_meal_days
    WHERE period_id = v_parent.period_id AND meal_date = v_date
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING message='সংশোধনের দিনের মিল-তথ্য পাওয়া যায়নি।', errcode='55000';
    END IF;
    IF v_date <> v_target THEN
      RAISE EXCEPTION USING message='শুধু রাত ১০টার সীমা পার হওয়া চলমান মিল-দিন সংশোধন করা যাবে। অন্য ভবিষ্যৎ দিন এডিট করুন।',errcode='55000';
    END IF;
    IF v_day.status = 'cancelled' OR v_day.status = 'finalized' THEN
      RAISE EXCEPTION USING message='বাতিল বা চূড়ান্ত হয়ে যাওয়া দিনের মিল সংশোধন করা যাবে না।', errcode='55000';
    END IF;

  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.meal_requests existing
    WHERE existing.hostel_id = v_hostel AND existing.period_id = v_parent.period_id
      AND existing.membership_id = v_membership AND existing.request_type = 'correction'
      AND existing.parent_request_id = v_parent.id AND existing.status = 'submitted'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(existing.days) old_day
        JOIN jsonb_array_elements(p_days) new_day
          ON (old_day->>'meal_date')::date = (new_day->>'meal_date')::date
      )
  ) THEN
    RAISE EXCEPTION USING message='এই দিনের একটি সংশোধন অনুরোধ ইতিমধ্যে অপেক্ষমাণ। আগে সেটির সিদ্ধান্তের অপেক্ষা করুন।', errcode='23505';
  END IF;

  RETURN private.create_meal_request_internal(
    v_membership, p_start_date, p_end_date, p_days,
    'correction', false, 'সদস্যের সংশোধন অনুরোধ', 'member', v_parent.id
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.edit_my_approved_meal_request(
  p_request_id uuid,
  p_start_date date,
  p_end_date date,
  p_days jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_req public.meal_requests%ROWTYPE;
  v_period public.monthly_periods%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
  v_item jsonb;
  v_date date;
  v_day public.daily_meal_days%ROWTYPE;
  v_preserved_days jsonb := '[]'::jsonb;
  v_effective_days jsonb := '[]'::jsonb;
  v_min_date date;
  v_max_date date;
  v_removed_dates jsonb := '[]'::jsonb;
  v_b numeric;
  v_l numeric;
  v_d numeric;
BEGIN
  PERFORM private.assert_signed_in();
  SELECT * INTO v_req FROM public.meal_requests
  WHERE id = p_request_id AND membership_id = private.my_membership_id()
    AND hostel_id = private.my_hostel_id()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='মিল অনুরোধটি পাওয়া যায়নি বা এটি আপনার নয়।', errcode='42501';
  END IF;
  IF v_req.status <> 'approved' OR v_req.request_type <> 'normal' OR v_req.is_late_request THEN
    RAISE EXCEPTION USING message='শুধু নিজের অনুমোদিত সাধারণ মিল অনুরোধ সম্পাদনা করা যাবে।', errcode='42501';
  END IF;
  SELECT * INTO v_period FROM public.monthly_periods
  WHERE id = v_req.period_id AND hostel_id = v_req.hostel_id AND status = 'running';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='এই মাসটি আর চলমান নেই।', errcode='55000';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date
     OR p_start_date <= v_today OR p_end_date > v_period.end_date THEN
    RAISE EXCEPTION USING message='সরাসরি এডিটের জন্য আগামী দিনের বৈধ তারিখ দিন।', errcode='22023';
  END IF;
  PERFORM private.assert_meal_days(p_days, v_req.period_id, false);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_days) LOOP
    v_date := (v_item->>'meal_date')::date;
    IF v_date = v_today + 1 AND (now() AT TIME ZONE 'Asia/Dhaka')::time >= TIME '22:00' THEN
      RAISE EXCEPTION USING message='আগামী দিনের রাত ১০টার সীমা শেষ; সংশোধন আবেদন ব্যবহার করুন।',errcode='55000';
    END IF;
    IF v_date <= v_today OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_req.days) old_day
      WHERE (old_day->>'meal_date')::date = v_date
    ) THEN
      RAISE EXCEPTION USING message='শুধু মূল অনুরোধের ভবিষ্যৎ দিনগুলো সরাসরি এডিট করা যাবে।', errcode='22023';
    END IF;
    SELECT * INTO v_day FROM public.daily_meal_days
    WHERE period_id = v_req.period_id AND meal_date = v_date;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING message='এই দিনের মিল-তথ্য পাওয়া যায়নি। আবার সিঙ্ক করুন।', errcode='55000';
    END IF;
    IF v_day.status = 'finalized' OR (v_day.cutoff_at IS NOT NULL AND v_day.cutoff_at <= now()) THEN
      RAISE EXCEPTION USING message='এই দিনের সময়সীমা শেষ হয়েছে; সরাসরি এডিট করা যাবে না।', errcode='55000';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.meal_requests other_request
    CROSS JOIN LATERAL jsonb_array_elements(other_request.days) other_day
    JOIN LATERAL jsonb_array_elements(p_days) new_day
      ON (other_day->>'meal_date')::date = (new_day->>'meal_date')::date
    WHERE other_request.id <> v_req.id AND other_request.hostel_id = v_req.hostel_id
      AND other_request.period_id = v_req.period_id AND other_request.membership_id = v_req.membership_id
      AND other_request.status IN ('submitted','approved')
  ) THEN
    RAISE EXCEPTION USING message='একই দিনের জন্য অন্য একটি সক্রিয় অনুরোধ আছে। আগে সেটি যাচাই করুন।', errcode='23505';
  END IF;

  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'meal_date')::date), '[]'::jsonb)
  INTO v_preserved_days
  FROM (
    SELECT old_day.value AS item
    FROM jsonb_array_elements(v_req.days) old_day(value)
    LEFT JOIN public.daily_meal_days d
      ON d.period_id = v_req.period_id AND d.meal_date = (old_day.value->>'meal_date')::date
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_days) new_day
      WHERE (new_day->>'meal_date')::date = (old_day.value->>'meal_date')::date
    )
    AND (
      (old_day.value->>'meal_date')::date <= v_today
      OR ((old_day.value->>'meal_date')::date = v_today + 1 AND (now() AT TIME ZONE 'Asia/Dhaka')::time >= TIME '22:00')
      OR d.id IS NULL OR d.status IN ('finalized','cancelled')
      OR (d.cutoff_at IS NOT NULL AND d.cutoff_at <= now())
    )
  ) protected;

  SELECT COALESCE(jsonb_agg(day ORDER BY (day->>'meal_date')::date), '[]'::jsonb)
  INTO v_effective_days
  FROM (
    SELECT value AS day FROM jsonb_array_elements(p_days)
    UNION ALL
    SELECT value AS day FROM jsonb_array_elements(v_preserved_days)
  ) combined;
  SELECT min((value->>'meal_date')::date), max((value->>'meal_date')::date)
  INTO v_min_date, v_max_date FROM jsonb_array_elements(v_effective_days);

  SELECT COALESCE(jsonb_agg(old_day.value->>'meal_date' ORDER BY (old_day.value->>'meal_date')::date), '[]'::jsonb)
  INTO v_removed_dates
  FROM jsonb_array_elements(v_req.days) old_day(value)
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_effective_days) keep_day
    WHERE (keep_day->>'meal_date')::date = (old_day.value->>'meal_date')::date
  );

  UPDATE public.daily_meal_records r
  SET cancelled = true, updated_by = auth.uid(), updated_at = now()
  FROM public.daily_meal_days d
  WHERE d.id = r.daily_meal_day_id AND d.period_id = v_req.period_id
    AND r.member_id = v_req.membership_id AND NOT r.cancelled
    AND d.status <> 'finalized' AND (d.cutoff_at IS NULL OR d.cutoff_at > now())
    AND NOT (d.meal_date = v_today + 1 AND (now() AT TIME ZONE 'Asia/Dhaka')::time >= TIME '22:00')
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_req.days) old_day
      WHERE (old_day->>'meal_date')::date = d.meal_date
    )
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_effective_days) keep_day
      WHERE (keep_day->>'meal_date')::date = d.meal_date
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.meal_requests other_request
      CROSS JOIN LATERAL jsonb_array_elements(other_request.days) other_day
      WHERE other_request.id <> v_req.id AND other_request.hostel_id = v_req.hostel_id
        AND other_request.period_id = v_req.period_id AND other_request.membership_id = v_req.membership_id
        AND other_request.status IN ('submitted','approved')
        AND (other_day->>'meal_date')::date = d.meal_date
    );

  UPDATE public.meal_requests
  SET start_date = v_min_date, end_date = v_max_date, days = v_effective_days, updated_at = now()
  WHERE id = v_req.id
  RETURNING * INTO v_req;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_days) LOOP
    v_date := (v_item->>'meal_date')::date;
    v_b := COALESCE((v_item->>'breakfast')::numeric, 0);
    v_l := COALESCE((v_item->>'lunch')::numeric, 0);
    v_d := COALESCE((v_item->>'dinner')::numeric, 0);
    SELECT * INTO v_day FROM public.daily_meal_days
    WHERE period_id = v_req.period_id AND meal_date = v_date;
    INSERT INTO public.daily_meal_records(
      hostel_id, period_id, daily_meal_day_id, member_id, member_name_snapshot,
      planned_breakfast, planned_lunch, planned_dinner,
      actual_breakfast, actual_lunch, actual_dinner,
      final_breakfast, final_lunch, final_dinner, updated_by, cancelled
    ) VALUES (
      v_req.hostel_id, v_req.period_id, v_day.id, v_req.membership_id, v_req.member_name_snapshot,
      v_b, v_l, v_d, NULL, NULL, NULL, NULL, NULL, NULL, auth.uid(), false
    )
    ON CONFLICT (daily_meal_day_id, member_id) DO UPDATE SET
      planned_breakfast = EXCLUDED.planned_breakfast,
      planned_lunch = EXCLUDED.planned_lunch,
      planned_dinner = EXCLUDED.planned_dinner,
      actual_breakfast = COALESCE(EXCLUDED.actual_breakfast, public.daily_meal_records.actual_breakfast),
      actual_lunch = COALESCE(EXCLUDED.actual_lunch, public.daily_meal_records.actual_lunch),
      actual_dinner = COALESCE(EXCLUDED.actual_dinner, public.daily_meal_records.actual_dinner),
      final_breakfast = COALESCE(EXCLUDED.final_breakfast, public.daily_meal_records.final_breakfast),
      final_lunch = COALESCE(EXCLUDED.final_lunch, public.daily_meal_records.final_lunch),
      final_dinner = COALESCE(EXCLUDED.final_dinner, public.daily_meal_records.final_dinner),
      updated_by = auth.uid(), cancelled = false, updated_at = now();
  END LOOP;

  INSERT INTO public.archive_period_audit(hostel_id, period_id, actor_user_id, action, summary, details)
  VALUES(v_req.hostel_id, v_req.period_id, auth.uid(), 'update:meal_request',
    'অনুমোদিত মিল অনুরোধ সম্পাদিত হয়েছে',
    jsonb_build_object('request_id', v_req.id, 'changed_days', p_days, 'removed_days', v_removed_dates,
                       'preserved_protected_days', v_preserved_days));
  RETURN private.get_request_json(v_req);
END
$fn$;

CREATE OR REPLACE FUNCTION public.manager_review_correction(
  p_request_id uuid,
  p_approve boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_req public.meal_requests%ROWTYPE;
  v_period public.monthly_periods%ROWTYPE;
  v_parent public.meal_requests%ROWTYPE;
  v_item jsonb;
  v_date date;
  v_day public.daily_meal_days%ROWTYPE;
BEGIN
  PERFORM private.assert_signed_in();
  IF p_approve IS NULL THEN
    RAISE EXCEPTION USING message='অনুমোদন বা প্রত্যাখ্যান নির্বাচন করুন।', errcode='22023';
  END IF;

  SELECT * INTO v_req
  FROM public.meal_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='সংশোধন অনুরোধটি পাওয়া যায়নি।', errcode='P0002';
  END IF;
  PERFORM private.assert_hostel_manager(v_req.hostel_id, v_req.period_id, false, true);

  IF v_req.status <> 'submitted' OR v_req.request_type <> 'correction' OR v_req.is_late_request THEN
    RAISE EXCEPTION USING message='এই সংশোধন অনুরোধটি আর অপেক্ষমাণ নেই।', errcode='55000';
  END IF;

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE id = v_req.period_id AND hostel_id = v_req.hostel_id
  FOR UPDATE;
  IF NOT FOUND OR v_period.status <> 'running' THEN
    RAISE EXCEPTION USING message='সংশোধনের মূল মাসটি আর চলমান নেই।', errcode='55000';
  END IF;

  IF v_req.parent_request_id IS NULL THEN
    RAISE EXCEPTION USING message='মূল সাধারণ অনুরোধের তথ্য পাওয়া যায়নি।', errcode='22023';
  END IF;
  SELECT * INTO v_parent
  FROM public.meal_requests
  WHERE id = v_req.parent_request_id
    AND hostel_id = v_req.hostel_id
    AND period_id = v_req.period_id
    AND membership_id = v_req.membership_id
  FOR UPDATE;
  IF NOT FOUND OR v_parent.status <> 'approved'
     OR v_parent.request_type <> 'normal' OR v_parent.is_late_request THEN
    RAISE EXCEPTION USING message='সংশোধনের মূল অনুরোধটি আর বৈধ/অনুমোদিত নেই।', errcode='55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_req.days) correction_day
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_parent.days) parent_day
      WHERE (parent_day->>'meal_date')::date = (correction_day->>'meal_date')::date
    )
  ) THEN
    RAISE EXCEPTION USING message='সংশোধনের তালিকায় মূল অনুরোধে নেই এমন দিন আছে।', errcode='22023';
  END IF;

  IF p_approve THEN
    -- Bring due day states up to date before deciding whether final values may be changed.
    PERFORM private.finalize_due_days(v_req.hostel_id, v_req.period_id);
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_req.days) LOOP
      v_date := (v_item->>'meal_date')::date;
      SELECT * INTO v_day
      FROM public.daily_meal_days
      WHERE period_id = v_req.period_id AND meal_date = v_date
      FOR UPDATE;
      IF NOT FOUND OR v_day.status = 'cancelled' THEN
        RAISE EXCEPTION USING message='সংশোধনের দিনটি পাওয়া যায়নি বা বাতিল হয়েছে।', errcode='55000';
      END IF;
      IF v_day.status = 'finalized' THEN
        RAISE EXCEPTION USING message='দিনটির হিসাব চূড়ান্ত হয়েছে; আবেদনটি এখন অনুমোদন করা যাবে না।',errcode='55000';
      END IF;
    END LOOP;
  END IF;

  UPDATE public.meal_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      review_reason = NULLIF(btrim(p_reason), ''),
      reviewed_by = auth.uid(), reviewed_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE id = v_req.id
  RETURNING * INTO v_req;

  IF p_approve THEN
    PERFORM private.apply_request_days(v_req.id);
  END IF;

  INSERT INTO public.archive_period_audit(
    hostel_id, period_id, actor_user_id, action, summary, details
  ) VALUES (
    v_req.hostel_id, v_req.period_id, auth.uid(),
    CASE WHEN p_approve THEN 'update:correction_approved' ELSE 'update:correction_rejected' END,
    CASE WHEN p_approve THEN 'মিল সংশোধন অনুমোদিত হয়েছে' ELSE 'মিল সংশোধন প্রত্যাখ্যান হয়েছে' END,
    jsonb_build_object('request_id', v_req.id, 'reason', p_reason, 'parent_request_id', v_req.parent_request_id)
  );
  RETURN private.get_request_json(v_req);
END
$fn$;

REVOKE ALL ON FUNCTION public.create_late_meal_request(date,numeric,numeric,numeric,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.create_meal_correction_request(date,date,jsonb,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.edit_my_approved_meal_request(uuid,date,date,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.manager_review_correction(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_late_meal_request(date,numeric,numeric,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_meal_correction_request(date,date,jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_my_approved_meal_request(uuid,date,date,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_review_correction(uuid,boolean,text) TO authenticated;
COMMIT;
