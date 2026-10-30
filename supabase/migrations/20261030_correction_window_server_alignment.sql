-- Hostel Life: correction-window server alignment (2026-10-30)
-- Run once in Supabase SQL Editor after a database backup.
-- Policy: cutoff = previous Dhaka day 22:00; finalization = meal date 21:00.
-- This migration repairs only future, non-finalized days in running periods.
-- It never edits finalized/cancelled day timestamps, request rows or meal amounts.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $preflight$
DECLARE
  v_internal text;
  v_assert text;
  v_correction text;
  v_review text;
BEGIN
  IF to_regclass('public.daily_meal_days') IS NULL
     OR to_regclass('public.monthly_periods') IS NULL
     OR to_regclass('public.meal_requests') IS NULL THEN
    RAISE EXCEPTION 'Required Hostel Life tables are missing; no changes applied.';
  END IF;

  IF to_regprocedure('private.assert_meal_days(jsonb,uuid,boolean)') IS NULL
     OR to_regprocedure('private.create_meal_request_internal(uuid,date,date,jsonb,text,boolean,text,text,uuid)') IS NULL
     OR to_regprocedure('public.create_meal_correction_request(date,date,jsonb,uuid)') IS NULL
     OR to_regprocedure('public.manager_review_correction(uuid,boolean,text)') IS NULL
     OR to_regprocedure('private.finalize_due_days(uuid,uuid)') IS NULL
     OR to_regprocedure('private.apply_request_days(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Expected correction workflow functions are missing; no changes applied.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='daily_meal_days' AND column_name='cutoff_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='daily_meal_days' AND column_name='finalizes_at'
  ) THEN
    RAISE EXCEPTION 'daily_meal_days cutoff/finalizes columns are missing; no changes applied.';
  END IF;

  -- Prevent applying this patch to an unknown/newer workflow implementation.
  v_assert := pg_get_functiondef(to_regprocedure('private.assert_meal_days(jsonb,uuid,boolean)'));
  v_internal := pg_get_functiondef(to_regprocedure('private.create_meal_request_internal(uuid,date,date,jsonb,text,boolean,text,text,uuid)'));
  v_correction := pg_get_functiondef(to_regprocedure('public.create_meal_correction_request(date,date,jsonb,uuid)'));
  v_review := pg_get_functiondef(to_regprocedure('public.manager_review_correction(uuid,boolean,text)'));

  IF position('(v_date::timestamp + TIME ''21:00'') AT TIME ZONE ''Asia/Dhaka''' IN v_assert)=0 THEN
    RAISE EXCEPTION 'assert_meal_days is not the diagnosed version; no changes applied.';
  END IF;
  IF position('এই দিনের কাট-অফ শেষ হয়নি' IN v_internal)=0 THEN
    RAISE EXCEPTION 'create_meal_request_internal is not the diagnosed version; no changes applied.';
  END IF;
  IF position('v_target' IN v_correction)=0 OR position('private.assert_meal_days' IN v_correction)=0 THEN
    RAISE EXCEPTION 'create_meal_correction_request is not the diagnosed version; no changes applied.';
  END IF;
  IF position('private.finalize_due_days' IN v_review)=0 OR position('private.apply_request_days' IN v_review)=0 THEN
    RAISE EXCEPTION 'manager_review_correction is not the diagnosed version; no changes applied.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.monthly_periods
    WHERE status='running'
    GROUP BY hostel_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A hostel has more than one running period. Resolve overlapping periods first; no changes applied.';
  END IF;
END
$preflight$;

-- 1. Day rows created by the previous helper used 21:00 on the meal date
-- as BOTH cutoff and finalization. That left no correction window.
-- Repair only future open/locked day timestamps in running periods. Leave
-- finalized/cancelled days, closed periods, request history and meal values untouched.
DO $repair$
DECLARE
  v_repaired integer := 0;
BEGIN
  UPDATE public.daily_meal_days d
  SET cutoff_at = (((d.meal_date - 1)::timestamp + TIME '22:00') AT TIME ZONE 'Asia/Dhaka'),
      finalizes_at = ((d.meal_date::timestamp + TIME '21:00') AT TIME ZONE 'Asia/Dhaka')
  FROM public.monthly_periods p
  WHERE p.id=d.period_id
    AND p.hostel_id=d.hostel_id
    AND p.status='running'
    AND d.meal_date >= p.start_date
    AND d.meal_date <= p.end_date
    AND d.status IN ('open','locked')
    -- Only repair dates whose intended 9 PM finalization is still ahead.
    AND ((d.meal_date::timestamp + TIME '21:00') AT TIME ZONE 'Asia/Dhaka') > clock_timestamp()
    AND (
      d.cutoff_at IS DISTINCT FROM (((d.meal_date - 1)::timestamp + TIME '22:00') AT TIME ZONE 'Asia/Dhaka')
      OR d.finalizes_at IS DISTINCT FROM ((d.meal_date::timestamp + TIME '21:00') AT TIME ZONE 'Asia/Dhaka')
    );

  GET DIAGNOSTICS v_repaired = ROW_COUNT;
  RAISE NOTICE 'Corrected cutoff/finalization schedule on % future open/locked day row(s).', v_repaired;
END
$repair$;

-- 2. New day rows now get the correct previous-night cutoff.
CREATE OR REPLACE FUNCTION private.assert_meal_days(p_days jsonb, p_period_id uuid, p_allow_cutoff boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_item jsonb;
  v_date date;
  v_period public.monthly_periods%ROWTYPE;
  v_day public.daily_meal_days%ROWTYPE;
BEGIN
  IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array' OR jsonb_array_length(p_days) = 0 THEN
    RAISE EXCEPTION USING message='অন্তত একটি দিনের মিলের তথ্য দিন।', errcode='22023';
  END IF;
  IF jsonb_array_length(p_days) > 62 THEN
    RAISE EXCEPTION USING message='একবারে সর্বোচ্চ ৬২ দিনের মিল দেওয়া যাবে।', errcode='22023';
  END IF;

  SELECT * INTO v_period FROM public.monthly_periods WHERE id = p_period_id;
  IF NOT FOUND OR v_period.status <> 'running' THEN
    RAISE EXCEPTION USING message='বর্তমান মাসটি চালু নেই।', errcode='55000';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_days) LOOP
    BEGIN
      v_date := (v_item->>'meal_date')::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION USING message='মিলের তারিখ সঠিক নয়।', errcode='22007';
    END;

    IF v_date < v_period.start_date OR v_date > v_period.end_date THEN
      RAISE EXCEPTION USING message='তারিখটি চলমান মাসের শুরুর আগের সীমার বাইরে।', errcode='22023';
    END IF;
    IF NOT private.is_valid_meal(COALESCE((v_item->>'breakfast')::numeric, 0))
       OR NOT private.is_valid_meal(COALESCE((v_item->>'lunch')::numeric, 0))
       OR NOT private.is_valid_meal(COALESCE((v_item->>'dinner')::numeric, 0)) THEN
      RAISE EXCEPTION USING message='মিলের পরিমাণ ০ থেকে ৫০-এর মধ্যে এবং ০.৫ ধাপে হতে হবে।', errcode='22023';
    END IF;

    SELECT * INTO v_day
    FROM public.daily_meal_days
    WHERE period_id = p_period_id AND meal_date = v_date;
    IF NOT FOUND THEN
      INSERT INTO public.daily_meal_days(hostel_id, period_id, meal_date, cutoff_at, finalizes_at)
      VALUES (
        v_period.hostel_id,
        v_period.id,
        v_date,
        ((v_date - 1)::timestamp + TIME '22:00') AT TIME ZONE 'Asia/Dhaka',
        (v_date::timestamp + TIME '21:00') AT TIME ZONE 'Asia/Dhaka'
      )
      ON CONFLICT (period_id, meal_date) DO NOTHING;
      SELECT * INTO v_day
      FROM public.daily_meal_days
      WHERE period_id = p_period_id AND meal_date = v_date;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING message='এই তারিখের মিল-দিন প্রস্তুত করা যায়নি। আবার চেষ্টা করুন।', errcode='P0002';
    END IF;

    IF NOT p_allow_cutoff
       AND (v_day.status = 'finalized' OR (v_day.cutoff_at IS NOT NULL AND v_day.cutoff_at <= now())) THEN
      RAISE EXCEPTION USING message='এই তারিখের মিল দেওয়ার সময় শেষ হয়েছে। সংশোধনের অনুরোধ ব্যবহার করুন।', errcode='55000';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT (value->>'meal_date')::date
    FROM jsonb_array_elements(p_days)
    GROUP BY (value->>'meal_date')::date HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING message='একই তারিখ একাধিকবার দেওয়া হয়েছে।', errcode='22023';
  END IF;
END
$function$
;

-- 3. Keep the internal request writer as a second server-side guard.
-- Corrections must target only the current eligible date, with the expected
-- cutoff already passed and the 21:00 finalization still in the future.
CREATE OR REPLACE FUNCTION private.create_meal_request_internal(p_membership_id uuid, p_start_date date, p_end_date date, p_days jsonb, p_request_type text, p_is_late boolean, p_reason text, p_origin text, p_parent_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hostel uuid; v_period public.monthly_periods%rowtype; v_req public.meal_requests%rowtype;
  v_member public.hostel_memberships%rowtype; v_parent public.meal_requests%rowtype;
  v_item jsonb; v_date date; v_day public.daily_meal_days%rowtype;
  v_now timestamptz:=clock_timestamp(); v_local timestamp; v_local_date date; v_local_time time;
  v_expected_late_date date; v_auto_approve boolean;
begin
  perform private.assert_signed_in();
  if p_start_date is null or p_end_date is null or p_end_date<p_start_date then
    raise exception using message='শুরুর ও শেষ তারিখ সঠিকভাবে দিন।',errcode='22023';
  end if;
  if p_request_type not in ('normal','correction') then
    raise exception using message='মিল অনুরোধের ধরন সঠিক নয়।',errcode='22023';
  end if;
  if p_is_late and p_request_type<>'normal' then
    raise exception using message='লেট অনুরোধের ধরন সঠিক নয়।',errcode='22023';
  end if;
  if p_request_type='correction' and p_is_late then
    raise exception using message='একটি আবেদন একই সঙ্গে লেট ও সংশোধন হতে পারবে না।',errcode='22023';
  end if;

  select * into v_member from public.hostel_memberships where id=p_membership_id and status='active';
  if not found then raise exception using message='সক্রিয় সদস্যের তথ্য পাওয়া যায়নি।',errcode='P0002'; end if;
  if p_origin='member' and v_member.user_id is distinct from auth.uid() then
    raise exception using message='অন্য সদস্যের নামে নিজে থেকে মিল অনুরোধ করা যাবে না।',errcode='42501';
  end if;
  v_hostel:=v_member.hostel_id;
  if not private.can_access_hostel(v_hostel) then
    raise exception using message='এই মেসে মিল অনুরোধ দেওয়ার অনুমতি নেই।',errcode='42501';
  end if;
  select * into v_period from public.monthly_periods
  where hostel_id=v_hostel and status='running' and p_start_date>=start_date and p_end_date<=end_date
  order by start_date desc limit 1;
  if not found then raise exception using message='নির্বাচিত তারিখগুলো চলমান মাসের মধ্যে নেই।',errcode='22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_membership_id::text,0));
  perform private.assert_meal_days(p_days,v_period.id,p_is_late or p_request_type='correction');
  if exists (
    select 1 from jsonb_array_elements(p_days) q(value)
    where (q.value->>'meal_date')::date < p_start_date or (q.value->>'meal_date')::date > p_end_date
  ) then
    raise exception using message='মিলের দিনের তারিখ শুরুর ও শেষের তারিখের ভেতরে হতে হবে।',errcode='22023';
  end if;

  if jsonb_array_length(p_days)<>(
    select count(distinct (value->>'meal_date')::date) from jsonb_array_elements(p_days)
  ) then
    raise exception using message='একই তারিখ একাধিকবার দেওয়া হয়েছে।',errcode='23505';
  end if;

  v_local := v_now at time zone 'Asia/Dhaka';
  v_local_date := v_local::date;
  v_local_time := v_local::time;

  if p_is_late then
    if jsonb_array_length(p_days)<>1 or p_start_date<>p_end_date then
      raise exception using message='লেট মিল অনুরোধে শুধু একটি দিনের মিল দেওয়া যাবে।',errcode='22023';
    end if;
    if v_local_time >= time '21:00' and v_local_time < time '22:00' then
      raise exception using message='রাত ৯টার ফাইনাল ও রাত ১০টার নতুন লেট সময়ের মাঝখানে আবেদন দেওয়া যাবে না।',errcode='55000';
    end if;
    v_expected_late_date := case when v_local_time >= time '22:00' then v_local_date+1 else v_local_date end;
    if p_start_date<>v_expected_late_date then
      raise exception using message=format('এই সময়ে শুধু %s তারিখের লেট মিল অনুরোধ দেওয়া যাবে।',to_char(v_expected_late_date,'DD Mon YYYY')),errcode='22023';
    end if;
    if exists (select 1 from public.daily_meal_days d where d.period_id=v_period.id and d.meal_date=p_start_date and d.status in ('finalized','cancelled')) then
      raise exception using message='এই দিনের মিল ইতিমধ্যে চূড়ান্ত বা বাতিল হয়েছে; নতুন লেট অনুরোধ নেওয়া যাবে না।',errcode='55000';
    end if;
  end if;

  if p_request_type='correction' then
    if p_parent_request_id is null then
      raise exception using message='সংশোধনের জন্য অনুরোধের ইতিহাস থেকে মূল অনুমোদিত অনুরোধটি নির্বাচন করুন।',errcode='22023';
    end if;
    select * into v_parent from public.meal_requests
    where id=p_parent_request_id and hostel_id=v_hostel and period_id=v_period.id
      and membership_id=p_membership_id and status='approved'
      and request_type='normal' and not is_late_request and origin<>'emergency_override';
    if not found then
      raise exception using message='মূল অনুমোদিত সাধারণ মিল অনুরোধটি পাওয়া যায়নি। ইতিহাস রিফ্রেশ করে আবার চেষ্টা করুন।',errcode='P0002';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_days) requested(value)
      where not exists (
        select 1 from jsonb_array_elements(v_parent.days) original(value)
        where (original.value->>'meal_date')::date=(requested.value->>'meal_date')::date
      )
    ) then
      raise exception using message='সংশোধনের তারিখ মূল অনুরোধের দিনের মধ্যে নেই।',errcode='22023';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_days) q(value)
      join public.daily_meal_days d
        on d.period_id=v_period.id
       and d.meal_date=(q.value->>'meal_date')::date
      where d.status not in ('open','locked')
         or d.cutoff_at is distinct from (((d.meal_date - 1)::timestamp + TIME '22:00') AT TIME ZONE 'Asia/Dhaka')
         or d.cutoff_at > v_now
         or d.finalizes_at is distinct from ((d.meal_date::timestamp + TIME '21:00') AT TIME ZONE 'Asia/Dhaka')
         or d.finalizes_at <= v_now
    ) then
      raise exception using message='সংশোধনের সময়সীমা খোলা নেই। আগের রাত ১০টার cutoff পার হওয়ার পর এবং সংশ্লিষ্ট দিনের রাত ৯টার finalization-এর আগে আবেদন করতে হবে।',errcode='55000';
    end if;
  end if;

  -- Any overlapping normal request is a duplicate. Pending/approved special
  -- requests block the same date until it is finalized; after finalization,
  -- another correction may be submitted through the normal approved parent.
  if exists (
    select 1
    from jsonb_array_elements(p_days) requested(value)
    join public.meal_requests other on other.period_id=v_period.id
      and other.membership_id=p_membership_id and other.status in ('submitted','approved')
      and other.id is distinct from p_parent_request_id
    cross join lateral jsonb_array_elements(other.days) other_day(value)
    where (other_day.value->>'meal_date')::date=(requested.value->>'meal_date')::date
      and (
        other.request_type='normal' and not other.is_late_request
        or other.status='submitted'
        or exists (
          select 1 from public.daily_meal_days d
          where d.period_id=v_period.id and d.meal_date=(requested.value->>'meal_date')::date
            and d.status<>'finalized'
        )
      )
  ) then
    raise exception using message='এই তারিখের জন্য ইতিমধ্যে একটি সক্রিয় মিল অনুরোধ আছে। আগের অনুরোধ সম্পাদনা করুন বা cutoff পার হলে সংশোধন অনুরোধ দিন।',errcode='23505';
  end if;

  v_auto_approve := (p_request_type='normal' and not p_is_late);
  insert into public.meal_requests(
    hostel_id,period_id,membership_id,member_name_snapshot,request_type,origin,is_late_request,
    start_date,end_date,days,status,reason,parent_request_id,created_by,reviewed_at
  ) values (
    v_hostel,v_period.id,p_membership_id,
    (select full_name from public.profiles where id=v_member.user_id),
    p_request_type,p_origin,p_is_late,p_start_date,p_end_date,p_days,
    case when v_auto_approve then 'approved' else 'submitted' end,
    nullif(btrim(p_reason),''),p_parent_request_id,auth.uid(),
    case when v_auto_approve then v_now else null end
  ) returning * into v_req;

  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
  values(v_hostel,v_period.id,auth.uid(),'insert:meal_request',
    case when v_auto_approve then 'সাধারণ মিল অনুরোধ স্বয়ংক্রিয়ভাবে অনুমোদিত হয়েছে' else 'বিশেষ মিল অনুরোধ অনুমোদনের জন্য জমা হয়েছে' end,
    jsonb_build_object('request_id',v_req.id,'membership_id',p_membership_id,'request_type',p_request_type,
      'is_late_request',p_is_late,'auto_approved',v_auto_approve,'days_count',jsonb_array_length(p_days)));

  if v_auto_approve then
    perform private.apply_request_days(v_req.id);
  else
    perform private.notify_meal_request_managers(v_req);
  end if;
  return private.get_request_json(v_req);
end $function$
;

-- 4. Correction requests are single-day, target-date-only requests.
-- The parent must be the caller's own approved normal request.
CREATE OR REPLACE FUNCTION public.create_meal_correction_request(p_start_date date, p_end_date date, p_days jsonb, p_parent_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
    IF v_day.status NOT IN ('open','locked')
       OR v_day.cutoff_at IS DISTINCT FROM (((v_date - 1)::timestamp + TIME '22:00') AT TIME ZONE 'Asia/Dhaka')
       OR v_day.cutoff_at > v_now
       OR v_day.finalizes_at IS DISTINCT FROM ((v_date::timestamp + TIME '21:00') AT TIME ZONE 'Asia/Dhaka')
       OR v_day.finalizes_at <= v_now THEN
      RAISE EXCEPTION USING message='সংশোধনের সময়সীমা খোলা নেই। আগের রাত ১০টার cutoff পার হওয়ার পর এবং সংশ্লিষ্ট দিনের রাত ৯টার finalization-এর আগে আবেদন করতে হবে।', errcode='55000';
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
$function$
;

-- 5. Manager approval uses the same cutoff/finalization window.
-- finalize_due_days runs first, so a request after 21:00 cannot slip through.
CREATE OR REPLACE FUNCTION public.manager_review_correction(p_request_id uuid, p_approve boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_req public.meal_requests%ROWTYPE;
  v_period public.monthly_periods%ROWTYPE;
  v_parent public.meal_requests%ROWTYPE;
  v_item jsonb;
  v_date date;
  v_day public.daily_meal_days%ROWTYPE;
  v_now timestamptz;
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
    -- Finalize any day whose 9 PM Dhaka deadline has already passed.
    -- A correction may only be approved after the 10 PM previous-day cutoff
    -- and strictly before the meal date's 9 PM finalization.
    PERFORM private.finalize_due_days(v_req.hostel_id, v_req.period_id);
    v_now := clock_timestamp();
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_req.days) LOOP
      v_date := (v_item->>'meal_date')::date;
      SELECT * INTO v_day
      FROM public.daily_meal_days
      WHERE period_id = v_req.period_id AND meal_date = v_date
      FOR UPDATE;
      IF NOT FOUND
         OR v_day.status NOT IN ('open','locked')
         OR v_day.cutoff_at IS DISTINCT FROM (((v_date - 1)::timestamp + TIME '22:00') AT TIME ZONE 'Asia/Dhaka')
         OR v_day.cutoff_at > v_now
         OR v_day.finalizes_at IS DISTINCT FROM ((v_date::timestamp + TIME '21:00') AT TIME ZONE 'Asia/Dhaka')
         OR v_day.finalizes_at <= v_now THEN
        RAISE EXCEPTION USING message='সংশোধন অনুমোদনের সময় শেষ হয়েছে, অথবা দিনটি চূড়ান্ত/বাতিল। রাত ৯টার আগে এবং cutoff পার হওয়ার পরই অনুমোদন করা যাবে।', errcode='55000';
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
$function$
;

-- 6. Fail closed: if any future active day in a running period still has
-- a non-canonical 22:00/21:00 schedule, roll back the whole migration.
DO $postflight_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.daily_meal_days d
    JOIN public.monthly_periods p ON p.id=d.period_id AND p.hostel_id=d.hostel_id
    WHERE p.status='running'
      AND d.meal_date >= p.start_date
      AND d.meal_date <= p.end_date
      AND d.status IN ('open','locked')
      AND ((d.meal_date::timestamp + TIME '21:00') AT TIME ZONE 'Asia/Dhaka') > clock_timestamp()
      AND (
        d.cutoff_at IS DISTINCT FROM (((d.meal_date - 1)::timestamp + TIME '22:00') AT TIME ZONE 'Asia/Dhaka')
        OR d.finalizes_at IS DISTINCT FROM ((d.meal_date::timestamp + TIME '21:00') AT TIME ZONE 'Asia/Dhaka')
      )
  ) THEN
    RAISE EXCEPTION 'Correction-window postflight failed; the entire migration was rolled back. No partial correction was committed.';
  END IF;
END
$postflight_guard$;

COMMIT;

-- Postflight: this should return all function flags = true and
-- no active future day with an invalid 22:00/21:00 schedule.
SELECT
  to_regprocedure('private.assert_meal_days(jsonb,uuid,boolean)') IS NOT NULL AS assert_meal_days_installed,
  to_regprocedure('private.create_meal_request_internal(uuid,date,date,jsonb,text,boolean,text,text,uuid)') IS NOT NULL AS request_internal_installed,
  to_regprocedure('public.create_meal_correction_request(date,date,jsonb,uuid)') IS NOT NULL AS correction_create_installed,
  to_regprocedure('public.manager_review_correction(uuid,boolean,text)') IS NOT NULL AS correction_review_installed,
  (
    SELECT count(*) = 0
    FROM public.daily_meal_days d
    JOIN public.monthly_periods p ON p.id=d.period_id AND p.hostel_id=d.hostel_id
    WHERE p.status='running'
      AND d.meal_date >= p.start_date
      AND d.meal_date <= p.end_date
      AND d.status IN ('open','locked')
      AND ((d.meal_date::timestamp + TIME '21:00') AT TIME ZONE 'Asia/Dhaka') > clock_timestamp()
      AND (
        d.cutoff_at IS DISTINCT FROM (((d.meal_date - 1)::timestamp + TIME '22:00') AT TIME ZONE 'Asia/Dhaka')
        OR d.finalizes_at IS DISTINCT FROM ((d.meal_date::timestamp + TIME '21:00') AT TIME ZONE 'Asia/Dhaka')
      )
  ) AS no_invalid_active_correction_windows;
