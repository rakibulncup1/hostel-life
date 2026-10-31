-- Hostel Life: safe member deactivation + same-evening next-month activation + immediate month close
-- Apply once in the intended Supabase project after taking a database backup.
-- This migration changes function/trigger behavior only; it does not rewrite or delete historical rows.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Fail closed if this migration is run against an unexpected/older schema.
DO $preflight$
BEGIN
  IF to_regclass('public.monthly_periods') IS NULL
     OR to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('public.period_assistant_managers') IS NULL
     OR to_regclass('public.daily_meal_days') IS NULL
     OR to_regclass('public.daily_meal_records') IS NULL
     OR to_regclass('public.meal_requests') IS NULL
     OR to_regclass('public.archive_period_audit') IS NULL
     OR to_regclass('public.ledger_transactions') IS NULL
     OR to_regclass('public.market_entries') IS NULL
     OR to_regclass('public.khala_money_entries') IS NULL THEN
    RAISE EXCEPTION 'Required Hostel Life tables are missing; no changes applied.';
  END IF;

  IF to_regprocedure('private.my_hostel_id()') IS NULL
     OR to_regprocedure('private.my_membership_id()') IS NULL
     OR to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.assert_hostel_manager(uuid,uuid,boolean,boolean)') IS NULL
     OR to_regprocedure('private.is_primary_manager(uuid,uuid)') IS NULL
     OR to_regprocedure('private.ensure_period_days(uuid)') IS NULL
     OR to_regprocedure('private.finalize_due_days(uuid,uuid)') IS NULL
     OR to_regprocedure('private.apply_request_days(uuid)') IS NULL
     OR to_regprocedure('private.assert_meal_days(jsonb,uuid,boolean)') IS NULL
     OR to_regprocedure('private.create_meal_request_internal(uuid,date,date,jsonb,text,boolean,text,text,uuid)') IS NULL
     OR to_regprocedure('public.create_meal_correction_request(date,date,jsonb,uuid)') IS NULL
     OR to_regprocedure('public.edit_my_approved_meal_request(uuid,date,date,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Required Hostel Life security/finalization helpers are missing; no changes applied.';
  END IF;

  IF to_regprocedure('public.start_new_month(date)') IS NULL
     OR to_regprocedure('public.close_current_month(boolean)') IS NULL
     OR to_regprocedure('public.deactivate_member(uuid)') IS NULL
     OR to_regprocedure('public.get_month_close_preflight()') IS NULL THEN
    RAISE EXCEPTION 'Expected month/member RPC signatures are missing; no changes applied.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meal_requests' AND column_name='days')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meal_requests' AND column_name='membership_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='daily_meal_records' AND column_name='cancelled')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='monthly_periods' AND column_name='closed_at') THEN
    RAISE EXCEPTION 'Expected Hostel Life table columns are missing; no changes applied.';
  END IF;

  IF EXISTS (
    SELECT required.table_name, required.column_name
    FROM (VALUES
      ('monthly_periods','id'),('monthly_periods','hostel_id'),('monthly_periods','label'),
      ('monthly_periods','start_date'),('monthly_periods','end_date'),('monthly_periods','status'),
      ('monthly_periods','primary_manager_membership_id'),('monthly_periods','created_by'),
      ('monthly_periods','closed_by'),('monthly_periods','closed_at'),('monthly_periods','updated_at'),('monthly_periods','created_at'),
      ('hostel_memberships','id'),('hostel_memberships','hostel_id'),('hostel_memberships','user_id'),
      ('hostel_memberships','status'),('hostel_memberships','deactivated_at'),('hostel_memberships','updated_at'),
      ('meal_requests','id'),('meal_requests','hostel_id'),('meal_requests','period_id'),('meal_requests','membership_id'),
      ('meal_requests','status'),('meal_requests','days'),('meal_requests','is_late_request'),('meal_requests','request_type'),
      ('meal_requests','start_date'),('meal_requests','end_date'),('meal_requests','member_name_snapshot'),('meal_requests','parent_request_id'),('meal_requests','origin'),('meal_requests','review_reason'),('meal_requests','reviewed_by'),('meal_requests','reviewed_at'),('meal_requests','updated_at'),
      ('daily_meal_days','id'),('daily_meal_days','hostel_id'),('daily_meal_days','period_id'),
      ('daily_meal_days','meal_date'),('daily_meal_days','status'),('daily_meal_days','cutoff_at'),('daily_meal_days','finalizes_at'),
      ('daily_meal_days','finalized_at'),('daily_meal_days','finalized_by'),('daily_meal_days','updated_at'),
      ('daily_meal_records','hostel_id'),('daily_meal_records','period_id'),('daily_meal_records','daily_meal_day_id'),('daily_meal_records','member_id'),('daily_meal_records','member_name_snapshot'),('daily_meal_records','cancelled'),
      ('daily_meal_records','planned_breakfast'),('daily_meal_records','planned_lunch'),('daily_meal_records','planned_dinner'),
      ('daily_meal_records','actual_breakfast'),('daily_meal_records','actual_lunch'),('daily_meal_records','actual_dinner'),
      ('daily_meal_records','final_breakfast'),('daily_meal_records','final_lunch'),('daily_meal_records','final_dinner'),
      ('daily_meal_records','finalization_source'),('daily_meal_records','finalized_by'),('daily_meal_records','finalized_at'),
      ('daily_meal_records','updated_by'),('daily_meal_records','updated_at'),
      ('ledger_transactions','period_id'),('ledger_transactions','entry_date'),('ledger_transactions','status'),
      ('market_entries','period_id'),('market_entries','entry_date'),('market_entries','status'),
      ('khala_money_entries','period_id'),('khala_money_entries','payment_date'),('khala_money_entries','status'),
      ('period_assistant_managers','hostel_id'),('period_assistant_managers','period_id'),('period_assistant_managers','membership_id'),
      ('archive_period_audit','hostel_id'),('archive_period_audit','period_id'),('archive_period_audit','actor_user_id'),
      ('archive_period_audit','action'),('archive_period_audit','summary'),('archive_period_audit','details')
    ) AS required(table_name,column_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema='public'
        AND c.table_name=required.table_name
        AND c.column_name=required.column_name
    )
  ) THEN
    RAISE EXCEPTION 'One or more required Hostel Life columns are missing; no changes applied.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.monthly_periods
    WHERE status = 'running'
    GROUP BY hostel_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'At least one hostel has more than one running period. Resolve this data issue first; no changes applied.';
  END IF;
END
$preflight$;

-- Serialize the lifecycle transitions per hostel. The member-specific advisory
-- locks below use the same key as create_meal_request_internal().
CREATE OR REPLACE FUNCTION public.start_new_month(p_start_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_member uuid := private.my_membership_id();
  v_last public.monthly_periods%ROWTYPE;
  v_new public.monthly_periods%ROWTYPE;
  v_end date;
  v_local_now timestamp without time zone;
  v_today date;
  v_local_time time without time zone;
  v_has_last boolean := false;
BEGIN
  PERFORM private.assert_signed_in();
  IF v_hostel IS NULL OR v_member IS NULL THEN
    RAISE EXCEPTION USING message='মাস শুরু করতে আপনাকে একটি মেসের সক্রিয় সদস্য হতে হবে।', errcode='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hostel-life-period-lifecycle:' || v_hostel::text, 0));

  IF EXISTS (SELECT 1 FROM public.monthly_periods WHERE hostel_id=v_hostel AND status='running') THEN
    RAISE EXCEPTION USING message='একটি মাস ইতিমধ্যে চালু আছে। আগে সেটি বন্ধ করুন।', errcode='23505';
  END IF;
  IF NOT private.is_primary_manager(v_hostel,NULL) THEN
    RAISE EXCEPTION USING message='নতুন মাস শুধু প্রধান ম্যানেজার শুরু করতে পারবেন।', errcode='42501';
  END IF;
  IF p_start_date IS NULL THEN
    RAISE EXCEPTION USING message='মাস শুরুর তারিখ দিন।', errcode='22023';
  END IF;

  v_local_now := clock_timestamp() AT TIME ZONE 'Asia/Dhaka';
  v_today := v_local_now::date;
  v_local_time := v_local_now::time;

  SELECT * INTO v_last
  FROM public.monthly_periods
  WHERE hostel_id=v_hostel AND status IN ('closed','archived')
  ORDER BY end_date DESC, closed_at DESC NULLS LAST, created_at DESC
  LIMIT 1;
  v_has_last := FOUND;

  IF v_has_last THEN
    IF p_start_date <> v_last.end_date + 1 THEN
      RAISE EXCEPTION USING
        message=format('নতুন মাসের শুরুর তারিখ আগের মাসের শেষ দিনের পরের দিন (%s) হতে হবে।',v_last.end_date+1),
        errcode='22023';
    END IF;
    IF v_last.end_date > v_today THEN
      RAISE EXCEPTION USING message='আগের মাসের শেষ তারিখ ভবিষ্যতে রয়েছে। আগে মাসের ইতিহাস যাচাই করুন।', errcode='23514';
    END IF;
    IF v_last.end_date = v_today AND v_local_time < TIME '20:00' THEN
      RAISE EXCEPTION USING message='আজকের মাস বন্ধ করার পর নতুন মাস রাত ৮টার আগে চালু করা যাবে না।', errcode='55000';
    END IF;
  ELSE
    IF p_start_date > v_today THEN
      RAISE EXCEPTION USING message='প্রথম মাস ভবিষ্যতের তারিখ থেকে চালু করা যাবে না।', errcode='22023';
    END IF;
  END IF;

  v_end := (date_trunc('month',p_start_date::timestamp) + interval '1 month - 1 day')::date;
  IF v_end < p_start_date THEN v_end := p_start_date; END IF;

  INSERT INTO public.monthly_periods(
    hostel_id,label,start_date,end_date,status,primary_manager_membership_id,created_by
  ) VALUES (
    v_hostel,to_char(p_start_date,'Mon YYYY'),p_start_date,v_end,'running',v_member,auth.uid()
  ) RETURNING * INTO v_new;

  -- A next-day period opened after 8 PM intentionally has no day rows yet.
  -- ensure_period_days() already handles this future-start case safely.
  PERFORM private.ensure_period_days(v_new.id);
  DELETE FROM public.period_assistant_managers
  WHERE hostel_id=v_hostel AND period_id<>v_new.id;

  INSERT INTO public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
  VALUES (
    v_hostel,v_new.id,auth.uid(),'insert:period','নতুন মাস শুরু হয়েছে',
    jsonb_build_object(
      'period_id',v_new.id,
      'start_date',v_new.start_date,
      'end_date',v_new.end_date,
      'opened_on',v_today,
      'opened_at_dhaka',v_local_time,
      'opened_previous_evening',v_new.start_date>v_today
    )
  );

  RETURN jsonb_build_object(
    'period_id',v_new.id,'id',v_new.id,'label',v_new.label,
    'start_date',v_new.start_date,'end_date',v_new.end_date,'status',v_new.status,
    'first_meal_date',v_new.start_date,'opened_at_dhaka',v_local_time,
    'normal_request_deadline','22:00 Asia/Dhaka'
  );
END
$function$;

-- The monthly-period guard permits exactly one controlled exception:
-- a newly inserted next-day period after 8 PM on the day its predecessor closed.
CREATE OR REPLACE FUNCTION private.hl_b_guard_period_dates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_local_now timestamp without time zone := clock_timestamp() AT TIME ZONE 'Asia/Dhaka';
  v_today date := (v_local_now)::date;
BEGIN
  IF NEW.status = 'running' THEN
    NEW.end_date := DATE '9999-12-31';
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'running' AND NEW.status IN ('closed','archived') THEN
    -- close_current_month supplies the already-captured Dhaka close date.
    -- Other legacy callers that leave the open-ended sentinel still close today.
    NEW.end_date := CASE
      WHEN NEW.end_date < DATE '9999-12-31' AND NEW.end_date <= v_today THEN NEW.end_date
      ELSE v_today
    END;
  END IF;

  IF NEW.status = 'running' AND NEW.start_date > v_today THEN
    IF TG_OP = 'INSERT'
       AND NEW.start_date = v_today + 1
       AND v_local_now::time >= TIME '20:00'
       AND EXISTS (
         SELECT 1 FROM public.monthly_periods p
         WHERE p.hostel_id=NEW.hostel_id
           AND p.status IN ('closed','archived')
           AND p.end_date=v_today
       ) THEN
      NULL; -- Approved one-day next-period insertion.
    ELSIF TG_OP = 'UPDATE'
       AND OLD.status IS NOT DISTINCT FROM 'running'
       AND OLD.start_date IS NOT DISTINCT FROM NEW.start_date
       AND (to_jsonb(OLD) - 'end_date') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'end_date') THEN
      -- Preserve the existing compatibility allowance for an unchanged legacy future row.
      NULL;
    ELSE
      RAISE EXCEPTION USING message='পরবর্তী মাস আগের মাস বন্ধের দিন রাত ৮টার আগে চালু করা যাবে না; নতুন মাসের প্রথম দিন হবে পরের দিন।', errcode='22023';
    END IF;
  END IF;

  IF NEW.end_date IS NULL OR NEW.end_date < NEW.start_date THEN
    RAISE EXCEPTION USING message='মাসের শেষ তারিখ শুরুর তারিখের আগে হতে পারে না।', errcode='22023';
  END IF;

  IF NEW.status = 'running' AND TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'running'
     AND EXISTS (
       SELECT 1 FROM public.monthly_periods p
       WHERE p.hostel_id=NEW.hostel_id AND p.id<>NEW.id AND p.start_date>NEW.start_date
     ) THEN
    RAISE EXCEPTION USING message='পরবর্তী মাস তৈরি হয়েছে; পুরোনো মাস পুনরায় চালু করা যাবে না।', errcode='23514';
  END IF;

  IF NEW.status = 'running' THEN
    IF EXISTS (
      SELECT 1 FROM public.monthly_periods p
      WHERE p.hostel_id=NEW.hostel_id AND p.id IS DISTINCT FROM NEW.id
        AND (p.status='running' OR p.start_date>NEW.start_date OR p.end_date>=NEW.start_date)
    ) THEN
      RAISE EXCEPTION USING message='অন্য মাসের ইতিহাসের সঙ্গে এই মাসের শুরুর তারিখ মিলে যাচ্ছে। আগে ম্যানেজারকে মাসের ইতিহাস যাচাই করতে হবে।', errcode='23514';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.monthly_periods p
      WHERE p.hostel_id=NEW.hostel_id AND p.id IS DISTINCT FROM NEW.id
        AND p.start_date<=NEW.end_date AND p.end_date>=NEW.start_date
    ) THEN
      RAISE EXCEPTION USING message='অন্য মাসের তারিখের সঙ্গে এই মাসের তারিখ মিলে যাচ্ছে। আগে ম্যানেজারকে মাসের ইতিহাস যাচাই করতে হবে।', errcode='23514';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

-- The request guard validates the still-active membership at write time and
-- permits requests against the next-day period only from 8 PM onward.
CREATE OR REPLACE FUNCTION private.hl_b_guard_meal_request_dates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_period public.monthly_periods%ROWTYPE;
  v_membership public.hostel_memberships%ROWTYPE;
  v_local_now timestamp without time zone := clock_timestamp() AT TIME ZONE 'Asia/Dhaka';
  v_today date := v_local_now::date;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.period_id IS NOT DISTINCT FROM OLD.period_id
     AND NEW.hostel_id IS NOT DISTINCT FROM OLD.hostel_id
     AND NEW.membership_id IS NOT DISTINCT FROM OLD.membership_id
     AND NEW.start_date IS NOT DISTINCT FROM OLD.start_date
     AND NEW.end_date IS NOT DISTINCT FROM OLD.end_date
     AND NEW.days IS NOT DISTINCT FROM OLD.days THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_period FROM public.monthly_periods WHERE id=NEW.period_id FOR SHARE;
  IF NOT FOUND OR v_period.hostel_id IS DISTINCT FROM NEW.hostel_id THEN
    RAISE EXCEPTION USING message='মিলের মাস বা মেসের পরিচয় সঠিক নয়।', errcode='23514';
  END IF;
  IF v_period.status <> 'running' THEN
    RAISE EXCEPTION USING message='এই মাসটি আর চলমান নেই। নতুন অনুরোধ গ্রহণ করা যাচ্ছে না।', errcode='55000';
  END IF;
  IF v_period.start_date > v_today THEN
    IF v_period.start_date <> v_today + 1
       OR v_local_now::time < TIME '20:00'
       OR NOT EXISTS (
         SELECT 1 FROM public.monthly_periods p
         WHERE p.hostel_id=NEW.hostel_id AND p.status IN ('closed','archived') AND p.end_date=v_today
       ) THEN
      RAISE EXCEPTION USING message='নতুন মাসের প্রথম দিনের অনুরোধ আগের মাস বন্ধের দিন রাত ৮টার পরই দেওয়া যাবে।', errcode='55000';
    END IF;
  END IF;

  IF NEW.membership_id IS NOT NULL THEN
    SELECT * INTO v_membership
    FROM public.hostel_memberships
    WHERE id=NEW.membership_id AND hostel_id=NEW.hostel_id AND status='active';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING message='নিষ্ক্রিয় সদস্যের জন্য নতুন মিল অনুরোধ গ্রহণ করা যাবে না।', errcode='42501';
    END IF;
  END IF;

  IF NEW.start_date < v_period.start_date OR NEW.end_date > v_period.end_date THEN
    RAISE EXCEPTION USING message='মিল অনুরোধের তারিখ এই মাসের সীমার বাইরে।', errcode='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.days) AS day_item(value)
    WHERE (day_item.value->>'meal_date')::date < v_period.start_date
       OR (day_item.value->>'meal_date')::date > v_period.end_date
  ) THEN
    RAISE EXCEPTION USING message='মিলের দিনের তালিকায় এই মাসের সীমার বাইরের তারিখ আছে।', errcode='22023';
  END IF;
  RETURN NEW;
END
$function$;

-- Recreate the existing triggers explicitly so the migration fails atomically
-- if the expected tables/functions are not the actual installed objects.
DROP TRIGGER IF EXISTS hl_b_guard_period_dates ON public.monthly_periods;
CREATE TRIGGER hl_b_guard_period_dates
  BEFORE INSERT OR UPDATE ON public.monthly_periods
  FOR EACH ROW EXECUTE FUNCTION private.hl_b_guard_period_dates();

DROP TRIGGER IF EXISTS hl_b_guard_meal_request_dates ON public.meal_requests;
CREATE TRIGGER hl_b_guard_meal_request_dates
  BEFORE INSERT OR UPDATE ON public.meal_requests
  FOR EACH ROW EXECUTE FUNCTION private.hl_b_guard_meal_request_dates();

REVOKE ALL ON FUNCTION private.hl_b_guard_period_dates() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.hl_b_guard_meal_request_dates() FROM PUBLIC, anon, authenticated;

-- Align edit/correction write paths with the membership advisory-lock order.
-- This prevents a deactivation/month-close transaction from holding the member
-- lock while waiting for a request row that itself is waiting for that same lock.
CREATE OR REPLACE FUNCTION public.create_meal_correction_request(
  p_start_date date,
  p_end_date date,
  p_days jsonb,
  p_parent_request_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
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
  v_now timestamptz := clock_timestamp();
  v_now_dhaka timestamp without time zone;
  v_today date;
  v_target date;
BEGIN
  v_now_dhaka := v_now AT TIME ZONE 'Asia/Dhaka';
  v_today := v_now_dhaka::date;
  PERFORM private.assert_signed_in();
  IF v_now_dhaka::time >= TIME '21:00' AND v_now_dhaka::time < TIME '22:00' THEN
    RAISE EXCEPTION USING message='সংশোধন আবেদন রাত ৯টা থেকে ১০টার মধ্যে বন্ধ থাকে।',errcode='55000';
  END IF;
  v_target := CASE WHEN v_now_dhaka::time >= TIME '22:00' THEN v_today + 1 ELSE v_today END;
  IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array' OR jsonb_array_length(p_days) <> 1 THEN
    RAISE EXCEPTION USING message='একটি সংশোধন আবেদনে শুধু নির্ধারিত একটি দিনের মিল পরিবর্তন করা যাবে।', errcode='22023';
  END IF;
  IF p_start_date IS DISTINCT FROM v_target OR p_end_date IS DISTINCT FROM v_target THEN
    RAISE EXCEPTION USING message='এই সময়ে শুধু নির্ধারিত সংশোধনযোগ্য দিনের আবেদন করা যাবে।', errcode='22023';
  END IF;

  v_hostel := private.my_hostel_id();
  v_membership := private.my_membership_id();
  IF v_membership IS NULL OR v_hostel IS NULL THEN
    RAISE EXCEPTION USING message='সংশোধন অনুরোধ দিতে সক্রিয় মেস সদস্যপদ প্রয়োজন।',errcode='42501';
  END IF;
  -- Match create_meal_request_internal() and deactivate_member() lock order.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_membership::text,0));

  IF p_parent_request_id IS NULL THEN
    RAISE EXCEPTION USING message='সংশোধনের জন্য মূল অনুমোদিত অনুরোধটি নির্বাচন করতে হবে।',errcode='22023';
  END IF;
  SELECT * INTO v_parent FROM public.meal_requests
  WHERE id=p_parent_request_id AND hostel_id=v_hostel AND membership_id=v_membership
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='মূল অনুরোধটি পাওয়া যায়নি বা এটি আপনার নয়।',errcode='42501';
  END IF;
  IF v_parent.status <> 'approved' OR v_parent.request_type <> 'normal' OR v_parent.is_late_request THEN
    RAISE EXCEPTION USING message='শুধু নিজের অনুমোদিত সাধারণ অনুরোধের জন্য সংশোধন পাঠানো যাবে।',errcode='42501';
  END IF;
  SELECT * INTO v_period FROM public.monthly_periods
  WHERE id=v_parent.period_id AND hostel_id=v_hostel AND status='running';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='সংশোধনের মূল মাসটি আর চলমান নেই।',errcode='55000';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date
     OR p_start_date < v_period.start_date OR p_end_date > v_period.end_date THEN
    RAISE EXCEPTION USING message='সংশোধনের তারিখ চলমান মাসের সীমার বাইরে।',errcode='22023';
  END IF;
  PERFORM private.assert_meal_days(p_days,v_parent.period_id,true);
  SELECT min((value->>'meal_date')::date),max((value->>'meal_date')::date)
  INTO v_min_date,v_max_date FROM jsonb_array_elements(p_days);
  IF v_min_date IS DISTINCT FROM p_start_date OR v_max_date IS DISTINCT FROM p_end_date THEN
    RAISE EXCEPTION USING message='সংশোধনের তারিখের পরিসর নির্বাচিত দিনগুলোর সঙ্গে মিলছে না।',errcode='22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_days) LOOP
    v_date := (v_item->>'meal_date')::date;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_parent.days) parent_day
      WHERE (parent_day->>'meal_date')::date=v_date
    ) THEN
      RAISE EXCEPTION USING message='মূল অনুরোধে নেই এমন দিনের মিল সংশোধন করা যাবে না।',errcode='22023';
    END IF;
    SELECT * INTO v_day FROM public.daily_meal_days
    WHERE period_id=v_parent.period_id AND meal_date=v_date
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING message='সংশোধনের দিনের মিল-তথ্য পাওয়া যায়নি।',errcode='55000';
    END IF;
    IF v_date <> v_target THEN
      RAISE EXCEPTION USING message='শুধু রাত ১০টার সীমা পার হওয়া চলমান মিল-দিন সংশোধন করা যাবে। অন্য ভবিষ্যৎ দিন এডিট করুন।',errcode='55000';
    END IF;
    IF v_day.status NOT IN ('open','locked')
       OR v_day.cutoff_at IS DISTINCT FROM (((v_date - 1)::timestamp + TIME '22:00') AT TIME ZONE 'Asia/Dhaka')
       OR v_day.cutoff_at > v_now
       OR v_day.finalizes_at IS DISTINCT FROM ((v_date::timestamp + TIME '21:00') AT TIME ZONE 'Asia/Dhaka')
       OR v_day.finalizes_at <= v_now THEN
      RAISE EXCEPTION USING message='সংশোধনের সময়সীমা খোলা নেই। আগের রাত ১০টার cutoff পার হওয়ার পর এবং সংশ্লিষ্ট দিনের রাত ৯টার finalization-এর আগে আবেদন করতে হবে।',errcode='55000';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.meal_requests existing
    WHERE existing.hostel_id=v_hostel AND existing.period_id=v_parent.period_id
      AND existing.membership_id=v_membership AND existing.request_type='correction'
      AND existing.parent_request_id=v_parent.id AND existing.status='submitted'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(existing.days) old_day
        JOIN jsonb_array_elements(p_days) new_day
          ON (old_day->>'meal_date')::date=(new_day->>'meal_date')::date
      )
  ) THEN
    RAISE EXCEPTION USING message='এই দিনের একটি সংশোধন অনুরোধ ইতিমধ্যে অপেক্ষমাণ। আগে সেটির সিদ্ধান্তের অপেক্ষা করুন।',errcode='23505';
  END IF;

  RETURN private.create_meal_request_internal(
    v_membership,p_start_date,p_end_date,p_days,
    'correction',false,'সদস্যের সংশোধন অনুরোধ','member',v_parent.id
  );
END
$function$;

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
AS $function$
DECLARE
  v_req public.meal_requests%ROWTYPE;
  v_period public.monthly_periods%ROWTYPE;
  v_membership uuid;
  v_merged_days jsonb;
  v_item jsonb;
  v_date date;
  v_day public.daily_meal_days%ROWTYPE;
  v_b numeric;
  v_l numeric;
  v_d numeric;
BEGIN
  PERFORM private.assert_signed_in();
  v_membership := private.my_membership_id();
  IF v_membership IS NULL THEN
    RAISE EXCEPTION USING message='মিল অনুরোধ সম্পাদনা করতে সক্রিয় মেস সদস্যপদ প্রয়োজন।',errcode='42501';
  END IF;
  -- The member lock must precede request-row locks, just as it does for creation.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_membership::text,0));

  SELECT * INTO v_req FROM public.meal_requests
  WHERE id=p_request_id AND membership_id=v_membership
  FOR UPDATE;
  IF NOT FOUND OR v_req.status<>'approved' OR v_req.request_type<>'normal' OR v_req.is_late_request THEN
    RAISE EXCEPTION USING message='শুধু নিজের অনুমোদিত সাধারণ মিল অনুরোধ সম্পাদনা করা যাবে।',errcode='42501';
  END IF;
  SELECT * INTO v_period FROM public.monthly_periods
  WHERE id=v_req.period_id AND status='running';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='এই মাসটি আর চলমান নেই।',errcode='55000';
  END IF;
  IF p_days IS NULL OR jsonb_typeof(p_days)<>'array' OR jsonb_array_length(p_days)=0 THEN
    RAISE EXCEPTION USING message='কমপক্ষে একটি পরিবর্তনযোগ্য দিনের মিলের তথ্য দিতে হবে।',errcode='22023';
  END IF;
  PERFORM private.assert_meal_days(p_days,v_req.period_id,false);

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_days) requested(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_req.days) original(value)
      WHERE (original.value->>'meal_date')::date=(requested.value->>'meal_date')::date
    )
  ) THEN
    RAISE EXCEPTION USING message='এই তারিখটি মূল অনুরোধে নেই। ইতিহাস রিফ্রেশ করে আবার চেষ্টা করুন।',errcode='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_days) requested(value)
    JOIN public.meal_requests other ON other.period_id=v_req.period_id AND other.membership_id=v_req.membership_id
      AND other.id<>v_req.id AND other.status IN ('submitted','approved')
    CROSS JOIN LATERAL jsonb_array_elements(other.days) other_day(value)
    WHERE (other_day.value->>'meal_date')::date=(requested.value->>'meal_date')::date
  ) THEN
    RAISE EXCEPTION USING message='এই তারিখের জন্য অন্য একটি সক্রিয় অনুরোধ রয়েছে।',errcode='23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_days) q(value)
    JOIN public.daily_meal_days d ON d.period_id=v_req.period_id AND d.meal_date=(q.value->>'meal_date')::date
    WHERE d.status='finalized' OR d.cutoff_at IS NULL OR d.cutoff_at<=clock_timestamp()
  ) THEN
    RAISE EXCEPTION USING message='কাট-অফ পার হওয়া বা ফাইনাল দিনের মিল এভাবে সম্পাদনা করা যাবে না। সংশোধনের অনুরোধ দিন।',errcode='55000';
  END IF;

  SELECT coalesce(jsonb_agg(
    coalesce((
      SELECT requested.value FROM jsonb_array_elements(p_days) requested(value)
      WHERE (requested.value->>'meal_date')::date=(original.value->>'meal_date')::date
      LIMIT 1
    ),original.value) ORDER BY (original.value->>'meal_date')::date
  ),'[]'::jsonb)
  INTO v_merged_days FROM jsonb_array_elements(v_req.days) original(value);

  UPDATE public.meal_requests
  SET start_date=(SELECT min((value->>'meal_date')::date) FROM jsonb_array_elements(v_merged_days)),
      end_date=(SELECT max((value->>'meal_date')::date) FROM jsonb_array_elements(v_merged_days)),
      days=v_merged_days,updated_at=now()
  WHERE id=v_req.id RETURNING * INTO v_req;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_days) LOOP
    v_date := (v_item->>'meal_date')::date;
    v_b := coalesce((v_item->>'breakfast')::numeric,0);
    v_l := coalesce((v_item->>'lunch')::numeric,0);
    v_d := coalesce((v_item->>'dinner')::numeric,0);
    SELECT * INTO v_day FROM public.daily_meal_days
    WHERE period_id=v_req.period_id AND meal_date=v_date;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING message='দিনের মিল তথ্য পাওয়া যায়নি।',errcode='P0002';
    END IF;
    INSERT INTO public.daily_meal_records AS current_record(
      hostel_id,period_id,daily_meal_day_id,member_id,member_name_snapshot,
      planned_breakfast,planned_lunch,planned_dinner,updated_by,cancelled
    ) VALUES (
      v_req.hostel_id,v_req.period_id,v_day.id,v_req.membership_id,v_req.member_name_snapshot,
      v_b,v_l,v_d,auth.uid(),false
    )
    ON CONFLICT(daily_meal_day_id,member_id) DO UPDATE SET
      planned_breakfast=excluded.planned_breakfast,
      planned_lunch=excluded.planned_lunch,
      planned_dinner=excluded.planned_dinner,
      updated_by=auth.uid(),cancelled=false,updated_at=now();
  END LOOP;

  INSERT INTO public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
  VALUES (
    v_req.hostel_id,v_req.period_id,auth.uid(),'update:meal_request','অনুমোদিত মিল অনুরোধ সম্পাদিত হয়েছে',
    jsonb_build_object('request_id',v_req.id,'edited_dates',p_days,'preserved_untouched_request_days',true)
  );
  RETURN private.get_request_json(v_req);
END
$function$;

-- Deactivation shares the member advisory lock with meal-request creation.
-- Before 9 PM: cancel any still-open record for today and all future member records.
-- At/after 9 PM: preserve today's final meal and cancel only future member records.
CREATE OR REPLACE FUNCTION public.deactivate_member(p_membership_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_member public.hostel_memberships%ROWTYPE;
  v_period public.monthly_periods%ROWTYPE;
  v_local_now timestamp without time zone;
  v_today date;
  v_local_time time without time zone;
  v_cancel_from date;
  v_cancelled_requests integer := 0;
  v_cancelled_records integer := 0;
  v_today_rule text := 'no_running_period';
BEGIN
  PERFORM private.assert_signed_in();
  IF p_membership_id IS NULL THEN
    RAISE EXCEPTION USING message='সদস্য নির্বাচন করা হয়নি।', errcode='22023';
  END IF;

  -- Same advisory key used by create_meal_request_internal().
  PERFORM pg_advisory_xact_lock(hashtextextended(p_membership_id::text, 0));

  SELECT * INTO v_member
  FROM public.hostel_memberships
  WHERE id=p_membership_id AND hostel_id=v_hostel
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='সদস্যের তথ্য পাওয়া যায়নি।', errcode='P0002';
  END IF;

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE hostel_id=v_hostel AND status='running'
  ORDER BY start_date DESC
  LIMIT 1;
  PERFORM private.assert_hostel_manager(v_hostel,v_period.id,false,false);

  IF v_member.user_id=auth.uid() THEN
    RAISE EXCEPTION USING message='নিজের সদস্যপদ এভাবে নিষ্ক্রিয় করা যাবে না।', errcode='42501';
  END IF;
  IF v_period.id IS NOT NULL AND v_period.primary_manager_membership_id=v_member.id THEN
    RAISE EXCEPTION USING message='প্রধান ম্যানেজারকে নিষ্ক্রিয় করার আগে ম্যানেজার পরিবর্তন করুন।', errcode='55000';
  END IF;

  v_local_now := clock_timestamp() AT TIME ZONE 'Asia/Dhaka';
  v_today := v_local_now::date;
  v_local_time := v_local_now::time;

  IF v_period.id IS NOT NULL THEN
    PERFORM private.ensure_period_days(v_period.id);
    -- If the 9 PM deadline has passed, this also applies approved late/correction
    -- requests to their finalized day before the member is deactivated.
    PERFORM private.finalize_due_days(v_hostel,v_period.id);

    v_cancel_from := CASE WHEN v_local_time < TIME '21:00' THEN v_today ELSE v_today + 1 END;
    IF v_period.start_date <= v_today
       AND v_local_time < TIME '21:00'
       AND NOT EXISTS (
         SELECT 1 FROM public.daily_meal_days already_finalized
         WHERE already_finalized.period_id=v_period.id
           AND already_finalized.meal_date=v_today
           AND already_finalized.status='finalized'
       ) THEN
      v_today_rule := 'cancel';
    ELSIF v_period.start_date <= v_today THEN
      v_today_rule := 'preserve';
    ELSE
      v_today_rule := 'not_in_period';
    END IF;

    UPDATE public.meal_requests r
    SET status='cancelled',
        review_reason='সদস্য নিষ্ক্রিয় করার কারণে আজকের অপেক্ষমাণ বিশেষ অনুরোধ/ভবিষ্যতের মিল অনুরোধ বাতিল',
        reviewed_by=auth.uid(),reviewed_at=v_local_now AT TIME ZONE 'Asia/Dhaka',updated_at=clock_timestamp()
    WHERE r.period_id=v_period.id
      AND r.membership_id=v_member.id
      AND r.status IN ('submitted','approved')
      AND (
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(r.days) AS day_item(value)
          WHERE (day_item.value->>'meal_date')::date >= v_cancel_from
            AND (
              (day_item.value->>'meal_date')::date > v_today
              OR NOT EXISTS (
                SELECT 1 FROM public.daily_meal_days already_finalized
                WHERE already_finalized.period_id=r.period_id
                  AND already_finalized.meal_date=(day_item.value->>'meal_date')::date
                  AND already_finalized.status='finalized'
              )
            )
        )
        OR (
          r.status='submitted'
          AND (r.is_late_request OR r.request_type='correction')
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(r.days) AS day_item(value)
            WHERE (day_item.value->>'meal_date')::date <= v_today
          )
        )
      );
    GET DIAGNOSTICS v_cancelled_requests = ROW_COUNT;

    UPDATE public.daily_meal_records r
    SET cancelled=true,updated_by=auth.uid(),updated_at=clock_timestamp()
    FROM public.daily_meal_days d
    WHERE r.daily_meal_day_id=d.id
      AND d.period_id=v_period.id
      AND r.member_id=v_member.id
      AND d.meal_date >= v_cancel_from
      AND d.status <> 'finalized'
      AND NOT r.cancelled;
    GET DIAGNOSTICS v_cancelled_records = ROW_COUNT;

    UPDATE public.hostel_memberships
    SET status='inactive',deactivated_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=v_member.id;
    DELETE FROM public.period_assistant_managers WHERE membership_id=v_member.id;

    INSERT INTO public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
    VALUES (
      v_hostel,v_period.id,auth.uid(),'update:member_deactivated','সদস্য নিষ্ক্রিয় করা হয়েছে',
      jsonb_build_object(
        'membership_id',v_member.id,
        'cancel_from_date',v_cancel_from,
        'today_meal_rule',v_today_rule,
        'cancelled_request_count',v_cancelled_requests,
        'cancelled_meal_record_count',v_cancelled_records,
        'deactivated_at_dhaka',v_local_now
      )
    );
  ELSE
    UPDATE public.hostel_memberships
    SET status='inactive',deactivated_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=v_member.id;
    DELETE FROM public.period_assistant_managers WHERE membership_id=v_member.id;
  END IF;

  RETURN jsonb_build_object(
    'membership_id',v_member.id,
    'status','inactive',
    'today_meal_rule',v_today_rule,
    'cancel_from_date',v_cancel_from,
    'cancelled_request_count',v_cancelled_requests,
    'cancelled_meal_record_count',v_cancelled_records
  );
END
$function$;

-- Extend the preflight response with pending special requests that cannot remain
-- actionable after closing. Existing keys are retained for old Frontend callers.
CREATE OR REPLACE FUNCTION public.get_month_close_preflight()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_period public.monthly_periods%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
  v_running_count integer := 0;
  v_future_requests integer := 0;
  v_future_days integer := 0;
  v_pending_special integer := 0;
  v_unfinalized integer := 0;
  v_future_financial integer := 0;
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.assert_hostel_manager(v_hostel,NULL,true,false);

  SELECT count(*) INTO v_running_count
  FROM public.monthly_periods
  WHERE hostel_id=v_hostel AND status='running';

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE hostel_id=v_hostel AND status='running'
  ORDER BY start_date DESC
  LIMIT 1;
  IF v_running_count=0 THEN
    RETURN jsonb_build_object(
      'has_running_period',false,'can_close',false,'running_period_count',0,
      'future_request_count',0,'future_active_request_count',0,
      'future_day_count',0,'pending_special_request_count',0,
      'unfinalized_day_count',0,'future_financial_entry_count',0,'requires_confirmation',false
    );
  END IF;
  IF v_running_count>1 THEN
    RETURN jsonb_build_object(
      'has_running_period',true,'can_close',false,'running_period_count',v_running_count,
      'future_request_count',0,'future_active_request_count',0,
      'future_day_count',0,'pending_special_request_count',0,
      'unfinalized_day_count',0,'future_financial_entry_count',0,'requires_confirmation',false,
      'message','একাধিক চলমান মাস পাওয়া গেছে। আগে ম্যানেজারকে মাসের অবস্থা যাচাই করতে হবে।'
    );
  END IF;

  IF v_period.start_date > v_today THEN
    RETURN jsonb_build_object(
      'has_running_period',true,'can_close',false,'running_period_count',1,
      'period_id',v_period.id,'period_label',v_period.label,
      'period_starts_on',v_period.start_date,
      'future_request_count',0,'future_active_request_count',0,
      'future_day_count',0,'pending_special_request_count',0,
      'unfinalized_day_count',0,'future_financial_entry_count',0,'requires_confirmation',false,
      'message','এই নতুন মাসের প্রথম মিলের দিন এখনো আসেনি। আজই মাস বন্ধ করা যাবে না।'
    );
  END IF;

  SELECT count(*) INTO v_future_requests
  FROM public.meal_requests r
  WHERE r.period_id=v_period.id
    AND r.status IN ('submitted','approved')
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(r.days) AS day_item(value)
      WHERE (day_item.value->>'meal_date')::date > v_today
    );

  SELECT count(*) INTO v_future_days
  FROM public.daily_meal_days d
  WHERE d.period_id=v_period.id AND d.meal_date>v_today AND d.status<>'cancelled';

  SELECT count(*) INTO v_pending_special
  FROM public.meal_requests r
  WHERE r.period_id=v_period.id
    AND r.status='submitted'
    AND (r.is_late_request OR r.request_type='correction')
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(r.days) AS day_item(value)
      WHERE (day_item.value->>'meal_date')::date <= v_today
    )
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(r.days) AS day_item(value)
      WHERE (day_item.value->>'meal_date')::date > v_today
    );

  SELECT count(*) INTO v_unfinalized
  FROM public.daily_meal_days d
  WHERE d.period_id=v_period.id AND d.status NOT IN ('finalized','cancelled');

  SELECT
    (SELECT count(*) FROM public.ledger_transactions l WHERE l.period_id=v_period.id AND l.entry_date>v_today AND l.status<>'void')
    + (SELECT count(*) FROM public.market_entries e WHERE e.period_id=v_period.id AND e.entry_date>v_today AND e.status<>'void')
    + (SELECT count(*) FROM public.khala_money_entries k WHERE k.period_id=v_period.id AND k.payment_date>v_today AND k.status<>'void')
  INTO v_future_financial;

  RETURN jsonb_build_object(
    'has_running_period',true,'running_period_count',1,
    'period_id',v_period.id,'period_label',v_period.label,
    'future_request_count',v_future_requests,
    'future_active_request_count',v_future_requests,
    'future_day_count',v_future_days,
    'pending_special_request_count',v_pending_special,
    'unfinalized_day_count',v_unfinalized,
    'future_financial_entry_count',v_future_financial,
    'can_close',(v_future_financial=0),
    'requires_confirmation',(v_future_requests>0 OR v_future_days>0 OR v_pending_special>0),
    'today',v_today,
    'message',CASE
      WHEN v_future_financial>0
      THEN format('বর্তমান তারিখের পর %sটি আর্থিক এন্ট্রি আছে। আগে তারিখ/এন্ট্রি যাচাই করুন; এগুলো থাকলে মাস বন্ধ করা যাবে না।',v_future_financial)
      WHEN v_future_requests>0 OR v_future_days>0 OR v_pending_special>0
      THEN 'মাস বন্ধ করলে ভবিষ্যতের অনুরোধ/মিল-দিন এবং অপেক্ষমাণ বিশেষ অনুরোধ বাতিল হবে। আজ পর্যন্ত হিসাব তখনই চূড়ান্ত হবে।'
      ELSE 'মাস বন্ধ করার জন্য প্রস্তুত। আজ পর্যন্ত হিসাব এখনই চূড়ান্ত হবে।'
    END
  );
END
$function$;

CREATE OR REPLACE FUNCTION private.apply_request_days_for_finalized_day_ids(
  p_request_id uuid,
  p_day_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_req public.meal_requests%ROWTYPE;
  v_item jsonb;
  v_date date;
  v_day public.daily_meal_days%ROWTYPE;
  v_existing public.daily_meal_records%ROWTYPE;
  v_found boolean;
  v_breakfast numeric;
  v_lunch numeric;
  v_dinner numeric;
  v_special boolean;
BEGIN
  IF p_request_id IS NULL OR coalesce(cardinality(p_day_ids),0)=0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_req
  FROM public.meal_requests
  WHERE id=p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='মিল অনুরোধটি পাওয়া যায়নি।',errcode='P0002';
  END IF;
  IF v_req.status<>'approved' OR NOT (v_req.is_late_request OR v_req.request_type='correction') THEN
    RAISE EXCEPTION USING message='শুধু অনুমোদিত লেট/সংশোধন অনুরোধ এই চূড়ান্তকরণে প্রয়োগ করা যাবে।',errcode='55000';
  END IF;

  v_special := (v_req.is_late_request OR v_req.request_type='correction');
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_req.days) LOOP
    v_date := (v_item->>'meal_date')::date;
    v_breakfast := coalesce((v_item->>'breakfast')::numeric,0);
    v_lunch := coalesce((v_item->>'lunch')::numeric,0);
    v_dinner := coalesce((v_item->>'dinner')::numeric,0);

    SELECT * INTO v_day
    FROM public.daily_meal_days
    WHERE period_id=v_req.period_id AND meal_date=v_date
    FOR UPDATE;
    IF NOT FOUND OR NOT (v_day.id=ANY(p_day_ids)) THEN
      CONTINUE;
    END IF;
    IF v_special AND v_day.status<>'finalized' THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_existing
    FROM public.daily_meal_records
    WHERE daily_meal_day_id=v_day.id AND member_id=v_req.membership_id;
    v_found := FOUND;

    IF v_special AND v_found AND NOT v_existing.cancelled
      AND coalesce(v_existing.planned_breakfast,0)=v_breakfast
      AND coalesce(v_existing.planned_lunch,0)=v_lunch
      AND coalesce(v_existing.planned_dinner,0)=v_dinner
      AND coalesce(v_existing.actual_breakfast,0)=v_breakfast
      AND coalesce(v_existing.actual_lunch,0)=v_lunch
      AND coalesce(v_existing.actual_dinner,0)=v_dinner
      AND coalesce(v_existing.final_breakfast,0)=v_breakfast
      AND coalesce(v_existing.final_lunch,0)=v_lunch
      AND coalesce(v_existing.final_dinner,0)=v_dinner
      AND v_existing.finalization_source='request_approval' THEN
      CONTINUE;
    END IF;

    INSERT INTO public.daily_meal_records AS current_record(
      hostel_id,period_id,daily_meal_day_id,member_id,member_name_snapshot,
      planned_breakfast,planned_lunch,planned_dinner,
      actual_breakfast,actual_lunch,actual_dinner,
      final_breakfast,final_lunch,final_dinner,finalization_source,finalized_by,finalized_at,updated_by,cancelled
    ) VALUES (
      v_req.hostel_id,v_req.period_id,v_day.id,v_req.membership_id,v_req.member_name_snapshot,
      v_breakfast,v_lunch,v_dinner,
      CASE WHEN v_day.status IN ('locked','finalized') OR v_req.is_late_request OR v_req.request_type='correction' THEN v_breakfast END,
      CASE WHEN v_day.status IN ('locked','finalized') OR v_req.is_late_request OR v_req.request_type='correction' THEN v_lunch END,
      CASE WHEN v_day.status IN ('locked','finalized') OR v_req.is_late_request OR v_req.request_type='correction' THEN v_dinner END,
      CASE WHEN v_day.status='finalized' OR v_req.request_type='correction' THEN v_breakfast END,
      CASE WHEN v_day.status='finalized' OR v_req.request_type='correction' THEN v_lunch END,
      CASE WHEN v_day.status='finalized' OR v_req.request_type='correction' THEN v_dinner END,
      CASE WHEN v_day.status='finalized' OR v_req.request_type='correction' THEN 'request_approval' ELSE NULL END,
      CASE WHEN v_day.status='finalized' OR v_req.request_type='correction' THEN auth.uid() ELSE NULL END,
      CASE WHEN v_day.status='finalized' OR v_req.request_type='correction' THEN clock_timestamp() ELSE NULL END,
      auth.uid(),false
    )
    ON CONFLICT(daily_meal_day_id,member_id) DO UPDATE SET
      planned_breakfast=excluded.planned_breakfast,
      planned_lunch=excluded.planned_lunch,
      planned_dinner=excluded.planned_dinner,
      actual_breakfast=coalesce(excluded.actual_breakfast,current_record.actual_breakfast),
      actual_lunch=coalesce(excluded.actual_lunch,current_record.actual_lunch),
      actual_dinner=coalesce(excluded.actual_dinner,current_record.actual_dinner),
      final_breakfast=coalesce(excluded.final_breakfast,current_record.final_breakfast),
      final_lunch=coalesce(excluded.final_lunch,current_record.final_lunch),
      final_dinner=coalesce(excluded.final_dinner,current_record.final_dinner),
      finalization_source=coalesce(excluded.finalization_source,current_record.finalization_source),
      finalized_by=coalesce(excluded.finalized_by,current_record.finalized_by),
      finalized_at=coalesce(excluded.finalized_at,current_record.finalized_at),
      updated_by=auth.uid(),cancelled=false,updated_at=clock_timestamp();

    IF v_req.request_type='correction' AND v_day.status='finalized' THEN
      INSERT INTO public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
      VALUES(v_req.hostel_id,v_req.period_id,auth.uid(),'update:meal_correction',
        'মিল সংশোধন অনুমোদন করা হয়েছে',
        jsonb_build_object('request_id',v_req.id,'meal_date',v_date,'membership_id',v_req.membership_id,'days',v_item));
    END IF;
  END LOOP;
END
$function$;
REVOKE ALL ON FUNCTION private.apply_request_days_for_finalized_day_ids(uuid,uuid[]) FROM PUBLIC, anon, authenticated;

-- Close at any time on/after the period start date. The closing transaction
-- immediately snapshots every non-cancelled day through today and cancels all
-- future member requests/records after explicit confirmation when needed.
CREATE OR REPLACE FUNCTION public.close_current_month(p_confirm_future_cancel boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_period public.monthly_periods%ROWTYPE;
  v_local_now timestamp without time zone;
  v_today date;
  v_future_count integer := 0;
  v_future_days integer := 0;
  v_pending_special integer := 0;
  v_cancelled_requests integer := 0;
  v_cancelled_pending integer := 0;
  v_cancelled_records integer := 0;
  v_cancelled_days integer := 0;
  v_finalized_days integer := 0;
  v_auto_finalized_days integer := 0;
  v_manual_finalized_days integer := 0;
  v_manual_finalize_day_ids uuid[] := ARRAY[]::uuid[];
  v_request_id uuid;
  v_running_count integer := 0;
  v_lock_membership uuid;
BEGIN
  PERFORM private.assert_signed_in();
  IF v_hostel IS NULL THEN
    RAISE EXCEPTION USING message='মাসের মেসের তথ্য পাওয়া যায়নি।', errcode='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hostel-life-period-lifecycle:' || v_hostel::text, 0));

  -- First read the period without locking it. Request creation locks a member
  -- before taking a shared lock on this period row, so we follow the same order:
  -- member advisory locks first, period-row FOR UPDATE second.
  SELECT count(*) INTO v_running_count
  FROM public.monthly_periods
  WHERE hostel_id=v_hostel AND status='running';
  IF v_running_count=0 THEN
    RAISE EXCEPTION USING message='বন্ধ করার মতো কোনো চলমান মাস নেই।', errcode='P0002';
  ELSIF v_running_count>1 THEN
    RAISE EXCEPTION USING message='মেসে একাধিক চলমান মাস পাওয়া গেছে। হিসাবের নিরাপত্তার জন্য কোনো মাস বন্ধ করা হয়নি; আগে ম্যানেজারকে তথ্য যাচাই করতে হবে।', errcode='23514';
  END IF;

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE hostel_id=v_hostel AND status='running'
  ORDER BY start_date DESC
  LIMIT 1;
  PERFORM private.assert_hostel_manager(v_hostel,v_period.id,true,false);

  -- Lock every member/request owner in deterministic order, using the same
  -- advisory-lock namespace as meal request creation and deactivation.
  FOR v_lock_membership IN
    SELECT member_ids.membership_id
    FROM (
      SELECT hm.id AS membership_id
      FROM public.hostel_memberships hm
      WHERE hm.hostel_id=v_hostel AND hm.status='active'
      UNION
      SELECT r.membership_id
      FROM public.meal_requests r
      WHERE r.period_id=v_period.id AND r.membership_id IS NOT NULL
    ) AS member_ids
    WHERE member_ids.membership_id IS NOT NULL
    ORDER BY member_ids.membership_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_membership::text, 0));
  END LOOP;

  -- Existing review/edit RPCs lock the request row before they lock the period.
  -- Lock all request rows in a deterministic order before taking the period lock,
  -- so a concurrent review can finish instead of deadlocking with this close.
  PERFORM r.id
  FROM public.meal_requests r
  WHERE r.period_id=v_period.id
  ORDER BY r.membership_id NULLS FIRST,r.id
  FOR UPDATE OF r;

  -- Now block new request writes. The request trigger takes FOR SHARE on the
  -- same period row; after this update commits, late writers see status=closed.
  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE id=v_period.id AND hostel_id=v_hostel AND status='running'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='মাসটি ইতিমধ্যে বন্ধ হয়েছে বা পরিবর্তিত হয়েছে। তথ্য রিফ্রেশ করে আবার চেষ্টা করুন।', errcode='55000';
  END IF;

  v_local_now := clock_timestamp() AT TIME ZONE 'Asia/Dhaka';
  v_today := v_local_now::date;
  IF v_today < v_period.start_date THEN
    RAISE EXCEPTION USING message='নতুন মাসের প্রথম মিলের দিন না আসা পর্যন্ত সেটি বন্ধ করা যাবে না।', errcode='22023';
  END IF;

  -- Do not silently close a period while future-dated financial entries exist.
  IF EXISTS (
       SELECT 1 FROM public.ledger_transactions l
       WHERE l.period_id=v_period.id AND l.entry_date>v_today AND l.status<>'void'
     ) OR EXISTS (
       SELECT 1 FROM public.market_entries e
       WHERE e.period_id=v_period.id AND e.entry_date>v_today AND e.status<>'void'
     ) OR EXISTS (
       SELECT 1 FROM public.khala_money_entries k
       WHERE k.period_id=v_period.id AND k.payment_date>v_today AND k.status<>'void'
     ) THEN
    RAISE EXCEPTION USING message='বর্তমান তারিখের পর আর্থিক এন্ট্রি আছে; আগে সেগুলো যাচাই করুন।', errcode='23514';
  END IF;

  SELECT count(*) INTO v_future_count
  FROM public.meal_requests r
  WHERE r.period_id=v_period.id AND r.status IN ('submitted','approved')
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(r.days) AS day_item(value)
      WHERE (day_item.value->>'meal_date')::date>v_today
    );
  SELECT count(*) INTO v_future_days
  FROM public.daily_meal_days d
  WHERE d.period_id=v_period.id AND d.meal_date>v_today AND d.status<>'cancelled';
  SELECT count(*) INTO v_pending_special
  FROM public.meal_requests r
  WHERE r.period_id=v_period.id AND r.status='submitted'
    AND (r.is_late_request OR r.request_type='correction')
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(r.days) AS day_item(value)
      WHERE (day_item.value->>'meal_date')::date<=v_today
    )
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(r.days) AS day_item(value)
      WHERE (day_item.value->>'meal_date')::date>v_today
    );

  IF (v_future_count>0 OR v_future_days>0 OR v_pending_special>0)
     AND NOT coalesce(p_confirm_future_cancel,false) THEN
    RAISE EXCEPTION USING
      message=format(
        'মাস বন্ধ করলে %sটি ভবিষ্যৎ সক্রিয় অনুরোধ, %sটি ভবিষ্যৎ মিল-দিন এবং %sটি অপেক্ষমাণ বিশেষ অনুরোধ বাতিল হবে। আজ পর্যন্ত অনুমোদিত মিলের হিসাব এখনই চূড়ান্ত হবে। নিশ্চিত করতে আবার চেষ্টা করুন।',
        v_future_count,v_future_days,v_pending_special
      ),
      errcode='55000';
  END IF;

  -- Materialize only real days up to the closing date; future rows are cancelled below.
  PERFORM private.ensure_period_days(v_period.id);

  -- Cancel entire active requests that include any future day. Existing past/today
  -- daily records are not erased; only the member's future records are marked cancelled.
  UPDATE public.meal_requests r
  SET status='cancelled',
      review_reason='মাস বন্ধের সময় ভবিষ্যতের মিল অনুরোধ বাতিল',
      reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE r.period_id=v_period.id
    AND r.status IN ('submitted','approved')
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(r.days) AS day_item(value)
      WHERE (day_item.value->>'meal_date')::date>v_today
    );
  GET DIAGNOSTICS v_cancelled_requests = ROW_COUNT;

  -- Cancel pending late/correction requests for dates that are now being closed.
  UPDATE public.meal_requests r
  SET status='cancelled',
      review_reason='মাস বন্ধ হওয়ায় অপেক্ষমাণ লেট/সংশোধন অনুরোধ আর অনুমোদনযোগ্য নয়',
      reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE r.period_id=v_period.id
    AND r.status='submitted'
    AND (r.is_late_request OR r.request_type='correction')
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(r.days) AS day_item(value)
      WHERE (day_item.value->>'meal_date')::date<=v_today
    );
  GET DIAGNOSTICS v_cancelled_pending = ROW_COUNT;

  UPDATE public.daily_meal_records r
  SET cancelled=true,updated_by=auth.uid(),updated_at=clock_timestamp()
  FROM public.daily_meal_days d
  WHERE r.daily_meal_day_id=d.id AND d.period_id=v_period.id
    AND d.meal_date>v_today AND NOT r.cancelled;
  GET DIAGNOSTICS v_cancelled_records = ROW_COUNT;

  UPDATE public.daily_meal_days
  SET status='cancelled',updated_at=clock_timestamp()
  WHERE period_id=v_period.id AND meal_date>v_today AND status<>'cancelled';
  GET DIAGNOSTICS v_cancelled_days = ROW_COUNT;

  -- Bring missed automatic finalization up to date. If it is already after 9 PM,
  -- approved special requests for due days are applied by this existing helper.
  v_auto_finalized_days := private.finalize_due_days(v_hostel,v_period.id);

  -- Capture only days that this month-close action itself is about to finalize.
  -- This avoids re-applying already-finalized historical corrections in arbitrary order.
  SELECT coalesce(array_agg(d.id),ARRAY[]::uuid[])
  INTO v_manual_finalize_day_ids
  FROM public.daily_meal_days d
  WHERE d.period_id=v_period.id AND d.meal_date<=v_today
    AND d.status NOT IN ('finalized','cancelled');

  UPDATE public.daily_meal_days
  SET status='finalized',
      finalized_at=coalesce(finalized_at,clock_timestamp()),
      finalized_by=coalesce(finalized_by,auth.uid()),
      updated_at=clock_timestamp()
  WHERE id=ANY(v_manual_finalize_day_ids)
    AND status NOT IN ('finalized','cancelled');
  GET DIAGNOSTICS v_manual_finalized_days = ROW_COUNT;
  v_finalized_days := v_auto_finalized_days + v_manual_finalized_days;

  -- A late/correction request approved before the 9 PM automatic cutoff is
  -- normally applied by finalize_due_days. Since month close finalizes early,
  -- apply only approved special requests for the exact days finalized above.
  FOR v_request_id IN
    SELECT DISTINCT r.id
    FROM public.meal_requests r
    CROSS JOIN LATERAL jsonb_array_elements(r.days) AS item(value)
    JOIN public.daily_meal_days d
      ON d.period_id=r.period_id
     AND d.meal_date=(item.value->>'meal_date')::date
    WHERE r.period_id=v_period.id
      AND r.status='approved'
      AND (r.is_late_request OR r.request_type='correction')
      AND d.id=ANY(v_manual_finalize_day_ids)
      AND d.status='finalized'
    ORDER BY r.id
  LOOP
    PERFORM private.apply_request_days_for_finalized_day_ids(v_request_id,v_manual_finalize_day_ids);
  END LOOP;

  -- Month closure is an explicit early-finalization action. Snapshot only
  -- rows belonging to days newly finalized by this close; days already finalized
  -- by the normal 9 PM helper are already snapshotted, and older final rows stay untouched.
  UPDATE public.daily_meal_records r
  SET final_breakfast=coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0),
      final_lunch=coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0),
      final_dinner=coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0),
      finalized_by=coalesce(r.finalized_by,auth.uid()),
      finalized_at=coalesce(r.finalized_at,clock_timestamp()),
      finalization_source=coalesce(r.finalization_source,'month_close'),
      updated_by=auth.uid(),updated_at=clock_timestamp()
  FROM public.daily_meal_days d
  WHERE r.daily_meal_day_id=d.id AND d.period_id=v_period.id
    AND d.id=ANY(v_manual_finalize_day_ids)
    AND d.status='finalized' AND NOT r.cancelled;

  UPDATE public.monthly_periods
  SET end_date=v_today,status='closed',closed_by=auth.uid(),closed_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE id=v_period.id AND status='running'
  RETURNING * INTO v_period;

  INSERT INTO public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
  VALUES (
    v_hostel,v_period.id,auth.uid(),'update:period_closed',
    'মাস বন্ধ করা হয়েছে; আজকের হিসাব তাৎক্ষণিকভাবে চূড়ান্ত হয়েছে',
    jsonb_build_object(
      'period_id',v_period.id,'closing_date',v_today,'closed_at_dhaka',v_local_now::time,
      'cancelled_future_request_count',v_cancelled_requests,
      'cancelled_pending_special_request_count',v_cancelled_pending,
      'cancelled_future_meal_record_count',v_cancelled_records,
      'cancelled_future_meal_day_count',v_cancelled_days,
      'finalized_day_count',v_finalized_days,
      'today_finalized_immediately',true
    )
  );

  RETURN jsonb_build_object(
    'status','closed','period_id',v_period.id,'label',v_period.label,
    'closing_date',v_today,
    'cancelled_requests',v_cancelled_requests,
    'cancelled_pending_special_requests',v_cancelled_pending,
    'cancelled_meal_records',v_cancelled_records,
    'cancelled_meal_days',v_cancelled_days,
    'finalized_days',v_finalized_days,
    'today_finalized_immediately',true
  );
END
$function$;

COMMIT;
