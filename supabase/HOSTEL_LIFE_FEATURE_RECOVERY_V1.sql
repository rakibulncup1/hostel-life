-- HISTORICAL SCRIPT — DO NOT RUN AGAIN ON THE CURRENT LIVE DATABASE.
-- The 2026-10-10 live snapshot confirms private.notify_period_managers(uuid,text,text,text,uuid,uuid)
-- returns integer, whereas this script attempts RETURNS void and can fail with PostgreSQL 42P13.
-- Use HOSTEL-LIFE-FRONTEND-RECOVERY-V1-README-BN.md for the current, limited installation path.
-- HOSTEL LIFE - FEATURE RECOVERY V1
-- Additive migration for late requests, manager inbox, member detail, and safe RPC visibility.
-- Does not delete/reset business rows or replace the existing market accounting implementation.

BEGIN;

ALTER TABLE public.meal_requests
  ADD COLUMN IF NOT EXISTS is_late_request boolean NOT NULL DEFAULT false;

-- Extend only the source-type guard to admit late normal requests. Existing allowed
-- source values stay valid; existing rows are not rewritten.
ALTER TABLE public.meal_late_overrides
  DROP CONSTRAINT IF EXISTS meal_late_overrides_check;
ALTER TABLE public.meal_late_overrides
  DROP CONSTRAINT IF EXISTS meal_late_overrides_source_type_check;
ALTER TABLE public.meal_late_overrides
  ADD CONSTRAINT meal_late_overrides_check CHECK (
    (source_type = 'member_correction' AND source_request_id IS NOT NULL)
    OR (source_type = 'member_late_request' AND source_request_id IS NOT NULL)
    OR (source_type = 'emergency_override' AND source_request_id IS NULL)
  );
ALTER TABLE public.meal_late_overrides
  ADD CONSTRAINT meal_late_overrides_source_type_check CHECK (
    source_type = ANY (ARRAY['member_correction'::text, 'member_late_request'::text, 'emergency_override'::text])
  );

CREATE INDEX IF NOT EXISTS idx_meal_requests_late_inbox
  ON public.meal_requests(hostel_id, period_id, is_late_request, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_meal_request_days_request_date_current
  ON public.meal_request_days(request_id, meal_date) WHERE is_current = true;

-- Notification helper used by correction/late-request security-definer RPCs.
CREATE OR REPLACE FUNCTION private.notify_period_managers(
  p_period_id uuid,
  p_title text,
  p_body text,
  p_reference_type text,
  p_reference_id uuid,
  p_created_by uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $notify_period_managers$
DECLARE
  v_hostel uuid;
BEGIN
  SELECT mp.hostel_id INTO v_hostel
  FROM public.monthly_periods mp
  WHERE mp.id = p_period_id;
  IF v_hostel IS NULL THEN RETURN; END IF;

  INSERT INTO public.notifications(
    hostel_id, notification_type, title, body, reference_type, reference_id, created_by, target_membership_id
  )
  SELECT v_hostel, 'system'::public.notification_type, p_title, p_body,
         p_reference_type, p_reference_id, p_created_by, targets.membership_id
  FROM (
    SELECT mp.primary_manager_membership_id AS membership_id
    FROM public.monthly_periods mp WHERE mp.id = p_period_id
    UNION
    SELECT pam.membership_id
    FROM public.period_assistant_managers pam WHERE pam.period_id = p_period_id
  ) targets
  JOIN public.hostel_memberships hm
    ON hm.id = targets.membership_id AND hm.hostel_id = v_hostel AND hm.status = 'active'
  WHERE targets.membership_id IS NOT NULL;
END;
$notify_period_managers$;
REVOKE ALL ON FUNCTION private.notify_period_managers(uuid,text,text,text,uuid,uuid) FROM PUBLIC, anon, authenticated;

-- Member request history includes the late-request flag; rows are scoped to the current member.
CREATE OR REPLACE FUNCTION public.get_my_meal_requests_v2(p_limit integer DEFAULT 100)
RETURNS TABLE(
  request_id uuid,
  request_type public.meal_request_type,
  status public.request_status,
  start_date date,
  end_date date,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  rejection_reason text,
  parent_request_id uuid,
  days jsonb,
  is_late_request boolean,
  origin text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $my_requests_v2$
DECLARE
  v_member uuid;
  v_hostel uuid;
BEGIN
  PERFORM private.assert_authenticated();
  v_member := private.current_membership_id(true);
  v_hostel := private.current_hostel_id(true);
  RETURN QUERY
  SELECT mr.id, mr.request_type, mr.status, mr.start_date, mr.end_date,
         mr.submitted_at, mr.reviewed_at, mr.rejection_reason, mr.parent_request_id,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'meal_date', mrd.meal_date, 'breakfast', mrd.breakfast,
             'lunch', mrd.lunch, 'dinner', mrd.dinner
           ) ORDER BY mrd.meal_date)
           FROM public.meal_request_days mrd
           WHERE mrd.request_id = mr.id AND mrd.is_current = true
         ), '[]'::jsonb),
         mr.is_late_request, mr.origin
  FROM public.meal_requests mr
  WHERE mr.member_id = v_member AND mr.hostel_id = v_hostel
  ORDER BY mr.submitted_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 200));
END;
$my_requests_v2$;
REVOKE ALL ON FUNCTION public.get_my_meal_requests_v2(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_meal_requests_v2(integer) TO authenticated;

-- Operational manager inbox v3, with late-only filtering and stable member names.
CREATE OR REPLACE FUNCTION public.get_manager_meal_requests_v3(
  p_period_id uuid DEFAULT NULL,
  p_request_type public.meal_request_type DEFAULT NULL,
  p_status public.request_status DEFAULT NULL,
  p_late_only boolean DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS TABLE(
  request_id uuid,
  member_id uuid,
  member_name text,
  request_type public.meal_request_type,
  status public.request_status,
  start_date date,
  end_date date,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  rejection_reason text,
  parent_request_id uuid,
  days jsonb,
  is_late_request boolean,
  origin text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $manager_requests_v3$
DECLARE
  v_hostel uuid;
  v_period uuid;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  v_period := p_period_id;
  IF v_period IS NULL THEN
    SELECT mp.id INTO v_period FROM public.monthly_periods mp
    WHERE mp.hostel_id = v_hostel AND mp.status = 'running'
    ORDER BY mp.start_date DESC, mp.created_at DESC LIMIT 1;
  END IF;
  IF v_period IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.monthly_periods mp WHERE mp.id=v_period AND mp.hostel_id=v_hostel)
     OR NOT private.can_manage_period(v_period) THEN
    RAISE EXCEPTION USING message = 'এই সময়ের মিল রিকোয়েস্ট দেখার অনুমতি নেই।';
  END IF;

  RETURN QUERY
  SELECT mr.id, mr.member_id, COALESCE(pr.full_name, 'সদস্য')::text,
         mr.request_type, mr.status, mr.start_date, mr.end_date, mr.submitted_at,
         mr.reviewed_at, mr.rejection_reason, mr.parent_request_id,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'meal_date',mrd.meal_date,'breakfast',mrd.breakfast,
             'lunch',mrd.lunch,'dinner',mrd.dinner
           ) ORDER BY mrd.meal_date)
           FROM public.meal_request_days mrd WHERE mrd.request_id=mr.id AND mrd.is_current=true
         ), '[]'::jsonb),
         mr.is_late_request, mr.origin
  FROM public.meal_requests mr
  JOIN public.hostel_memberships hm ON hm.id=mr.member_id AND hm.hostel_id=v_hostel
  LEFT JOIN public.profiles pr ON pr.id=hm.user_id
  WHERE mr.hostel_id=v_hostel AND mr.period_id=v_period
    AND (p_request_type IS NULL OR mr.request_type=p_request_type)
    AND (p_status IS NULL OR mr.status=p_status)
    AND (p_late_only IS NULL OR mr.is_late_request=p_late_only)
  ORDER BY CASE WHEN mr.status='submitted' THEN 0 WHEN mr.status='approved' THEN 1 ELSE 2 END,
           mr.submitted_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit,200),500));
END;
$manager_requests_v3$;
REVOKE ALL ON FUNCTION public.get_manager_meal_requests_v3(uuid,public.meal_request_type,public.request_status,boolean,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_manager_meal_requests_v3(uuid,public.meal_request_type,public.request_status,boolean,integer) TO authenticated;

-- A manager/assistant may create a normal auto-approved request for a member who needs help.
-- It is inserted under the member's membership id, so the member's history remains authoritative.
CREATE OR REPLACE FUNCTION public.manager_create_member_meal_request(
  p_member_id uuid, p_start_date date, p_end_date date, p_days jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $manager_member_request$
DECLARE
  v_hostel uuid;
  v_actor uuid;
  v_period uuid;
  v_result jsonb;
  v_request_id uuid;
  v_name text;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  v_actor := private.current_membership_id(true);
  v_period := private.period_for_hostel_date(v_hostel, p_start_date);
  IF v_period IS NULL OR private.period_for_hostel_date(v_hostel,p_end_date) IS DISTINCT FROM v_period THEN
    RAISE EXCEPTION USING message='নির্বাচিত দিনগুলো একটি চলমান মাসের মধ্যে থাকতে হবে।';
  END IF;
  IF NOT private.can_manage_period(v_period) THEN
    RAISE EXCEPTION USING message='সদস্যের হয়ে মিল রিকোয়েস্ট তৈরি করার অনুমতি নেই।';
  END IF;
  v_result := private.submit_meal_plan_request(p_member_id, 'member', p_start_date, p_end_date, p_days);
  v_request_id := NULLIF(v_result->>'request_id','')::uuid;
  SELECT pr.full_name INTO v_name FROM public.hostel_memberships hm JOIN public.profiles pr ON pr.id=hm.user_id
  WHERE hm.id=p_member_id AND hm.hostel_id=v_hostel;
  IF v_request_id IS NOT NULL THEN
    INSERT INTO public.notifications(hostel_id,notification_type,title,body,reference_type,reference_id,created_by,target_membership_id)
    VALUES(v_hostel,'system'::public.notification_type,'আপনার মিল রিকোয়েস্ট তৈরি হয়েছে',
      format('%s আপনার হয়ে %s থেকে %s পর্যন্ত মিল রিকোয়েস্ট তৈরি করেছেন।',
        COALESCE((SELECT full_name FROM public.profiles p JOIN public.hostel_memberships hm ON hm.user_id=p.id WHERE hm.id=v_actor),'ম্যানেজার'),
        to_char(p_start_date,'DD Mon YYYY'),to_char(p_end_date,'DD Mon YYYY')),
      'meal_request',v_request_id,v_actor,p_member_id);
  END IF;
  RETURN COALESCE(v_result,'{}'::jsonb) || jsonb_build_object('created_for_member',p_member_id,'member_name',v_name);
END;
$manager_member_request$;
REVOKE ALL ON FUNCTION public.manager_create_member_meal_request(uuid,date,date,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_create_member_meal_request(uuid,date,date,jsonb) TO authenticated;

-- A member can submit a late request for the applicable target day after the 10 PM normal cutoff and before that target day's 9 PM finalizer.
-- This request is NOT approved automatically; it stays in the manager inbox until reviewed.
CREATE OR REPLACE FUNCTION public.create_late_meal_request(
  p_meal_date date, p_breakfast numeric, p_lunch numeric, p_dinner numeric, p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $create_late_request$
DECLARE
  v_hostel uuid;
  v_member uuid;
  v_period uuid;
  v_day public.daily_meal_days;
  v_request uuid;
  v_today date;
  v_local_time time;
  v_expected_date date;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  v_member := private.current_membership_id(true);
  PERFORM private.assert_membership(v_member,v_hostel,true);
  v_today := private.current_local_date(v_hostel);
  v_local_time := (now() AT TIME ZONE 'Asia/Dhaka')::time;
  IF v_local_time >= time '21:00' AND v_local_time < time '22:00' THEN
    RAISE EXCEPTION USING message='আজকের মিল final হয়েছে; আগামী দিনের late request রাত ১০টার cutoff-এর পরে পাঠানো যাবে।';
  END IF;
  v_expected_date := CASE WHEN v_local_time >= time '22:00' THEN v_today + 1 ELSE v_today END;
  IF p_meal_date IS NULL OR p_meal_date <> v_expected_date THEN
    RAISE EXCEPTION USING message=format('এই সময়ে late request-এর লক্ষ্য তারিখ %s হওয়া উচিত।',to_char(v_expected_date,'DD Mon YYYY'));
  END IF;
  IF p_breakfast IS NULL OR p_lunch IS NULL OR p_dinner IS NULL
     OR p_breakfast<0 OR p_lunch<0 OR p_dinner<0
     OR p_breakfast>50 OR p_lunch>50 OR p_dinner>50 THEN
    RAISE EXCEPTION USING message='প্রতিটি বেলার মিল ০ থেকে ৫০-এর মধ্যে হতে হবে।';
  END IF;
  v_period := private.period_for_hostel_date(v_hostel,p_meal_date);
  IF v_period IS NULL OR NOT EXISTS(SELECT 1 FROM public.monthly_periods mp WHERE mp.id=v_period AND mp.status='running') THEN
    RAISE EXCEPTION USING message='নির্বাচিত দিনের জন্য কোনো চলমান মাস নেই।';
  END IF;
  SELECT * INTO v_day FROM public.daily_meal_days d
  WHERE d.hostel_id=v_hostel AND d.period_id=v_period AND d.meal_date=p_meal_date FOR UPDATE;
  IF v_day.id IS NULL THEN RAISE EXCEPTION USING message='নির্বাচিত দিনের meal-day record পাওয়া যায়নি।'; END IF;
  IF now() < v_day.cutoff_at THEN RAISE EXCEPTION USING message='সাধারণ মিল রিকোয়েস্টের সময় এখনো শেষ হয়নি।'; END IF;
  IF now() >= v_day.finalizes_at OR v_day.status='finalized' THEN RAISE EXCEPTION USING message='এই দিনের রাত ৯টার finalization শেষ হয়েছে। এখন নতুন late request নেওয়া যাবে না।'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_member::text||':'||v_period::text||':'||p_meal_date::text,0));
  IF EXISTS (
    SELECT 1 FROM public.meal_requests mr
    WHERE mr.hostel_id=v_hostel AND mr.period_id=v_period AND mr.member_id=v_member
      AND mr.request_type='normal' AND mr.status IN ('submitted','approved')
      AND mr.start_date<=p_meal_date AND mr.end_date>=p_meal_date
  ) THEN
    RAISE EXCEPTION USING message='এই দিনের জন্য আপনার একটি মিল রিকোয়েস্ট আগে থেকেই আছে। পরিবর্তনের জন্য রিকোয়েস্ট হিস্টরি থেকে সংশোধনের আবেদন করুন।';
  END IF;

  INSERT INTO public.meal_requests(hostel_id,period_id,member_id,request_type,status,start_date,end_date,origin,submitted_at,is_late_request)
  VALUES(v_hostel,v_period,v_member,'normal','submitted',p_meal_date,p_meal_date,'member',now(),true)
  RETURNING id INTO v_request;
  INSERT INTO public.meal_request_days(request_id,meal_date,breakfast,lunch,dinner,is_current)
  VALUES(v_request,p_meal_date,p_breakfast,p_lunch,p_dinner,true);

  PERFORM private.notify_period_managers(
    v_period,'নতুন লেট মিল রিকোয়েস্ট',
    format('%s %s তারিখের জন্য লেট মিল রিকোয়েস্ট দিয়েছেন। ম্যানেজারের অনুমোদন প্রয়োজন।',
      COALESCE((SELECT pr.full_name FROM public.profiles pr JOIN public.hostel_memberships hm ON hm.user_id=pr.id WHERE hm.id=v_member),'একজন সদস্য'),
      to_char(p_meal_date,'DD Mon YYYY')),
    'meal_request',v_request,v_member
  );
  RETURN jsonb_build_object('request_id',v_request,'status','submitted','is_late_request',true,'requires_manager_approval',true);
END;
$create_late_request$;
REVOKE ALL ON FUNCTION public.create_late_meal_request(date,numeric,numeric,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_late_meal_request(date,numeric,numeric,numeric,text) TO authenticated;

-- Primary manager or assistant may approve/reject late requests. Approval creates one override,
-- which the existing 9 PM finalizer applies to final records and snapshots.
CREATE OR REPLACE FUNCTION public.manager_review_late_meal_request(
  p_request_id uuid, p_approve boolean, p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $review_late_request$
DECLARE
  v_req public.meal_requests;
  v_hostel uuid;
  v_actor uuid;
  v_day public.daily_meal_days;
  v_override public.meal_late_overrides;
  v_name text;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  v_actor := private.current_membership_id(true);
  SELECT * INTO v_req FROM public.meal_requests mr
  WHERE mr.id=p_request_id AND mr.hostel_id=v_hostel AND mr.request_type='normal'
    AND mr.is_late_request=true AND mr.status='submitted' FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION USING message='লেট রিকোয়েস্ট পাওয়া যায়নি বা ইতিমধ্যে পর্যালোচনা হয়েছে।'; END IF;
  IF NOT private.can_manage_period(v_req.period_id) THEN RAISE EXCEPTION USING message='এই রিকোয়েস্ট পর্যালোচনা করার অনুমতি নেই।'; END IF;
  SELECT * INTO v_day FROM public.daily_meal_days d
  WHERE d.hostel_id=v_hostel AND d.period_id=v_req.period_id AND d.meal_date=v_req.start_date FOR UPDATE;
  IF v_day.id IS NULL THEN RAISE EXCEPTION USING message='লেট রিকোয়েস্টের তারিখের meal-day record পাওয়া যায়নি।'; END IF;
  SELECT pr.full_name INTO v_name FROM public.hostel_memberships hm JOIN public.profiles pr ON pr.id=hm.user_id WHERE hm.id=v_req.member_id;

  IF NOT p_approve THEN
    IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION USING message='বাতিল করার কারণ লিখতে হবে।'; END IF;
    UPDATE public.meal_requests SET status='rejected', rejection_reason=trim(p_reason), reviewed_by=v_actor, reviewed_at=now(), updated_at=now() WHERE id=v_req.id;
    INSERT INTO public.notifications(hostel_id,notification_type,title,body,reference_type,reference_id,created_by,target_membership_id)
    VALUES(v_hostel,'system'::public.notification_type,'লেট মিল রিকোয়েস্ট অনুমোদিত হয়নি',trim(p_reason),'meal_request',v_req.id,v_actor,v_req.member_id);
    RETURN jsonb_build_object('request_id',v_req.id,'status','rejected');
  END IF;

  IF now() >= v_day.finalizes_at OR v_day.status='finalized' THEN
    RAISE EXCEPTION USING message='রাত ৯টার finalization শেষ হয়েছে। এখন নতুন late request অনুমোদন করা যাবে না।';
  END IF;
  IF now() < v_day.cutoff_at THEN RAISE EXCEPTION USING message='এই দিনটির সাধারণ cutoff এখনো শেষ হয়নি; late approval প্রযোজ্য নয়।'; END IF;

  SELECT * INTO v_override FROM public.meal_late_overrides mlo
  WHERE mlo.daily_meal_day_id=v_day.id AND mlo.member_id=v_req.member_id FOR UPDATE;
  IF v_override.id IS NOT NULL AND v_override.status <> 'void' THEN
    RAISE EXCEPTION USING message='এই সদস্যের জন্য ওই দিনের একটি late correction/override ইতিমধ্যে সক্রিয় আছে।';
  END IF;

  IF v_override.id IS NOT NULL THEN
    UPDATE public.meal_late_overrides SET
      period_id=v_req.period_id, hostel_id=v_hostel, source_type='member_late_request', source_request_id=v_req.id,
      breakfast=(SELECT mrd.breakfast FROM public.meal_request_days mrd WHERE mrd.request_id=v_req.id AND mrd.is_current=true LIMIT 1),
      lunch=(SELECT mrd.lunch FROM public.meal_request_days mrd WHERE mrd.request_id=v_req.id AND mrd.is_current=true LIMIT 1),
      dinner=(SELECT mrd.dinner FROM public.meal_request_days mrd WHERE mrd.request_id=v_req.id AND mrd.is_current=true LIMIT 1),
      status='approved', reason=NULLIF(trim(p_reason),''), approved_by=v_actor, approved_at=now(), applied_at=NULL, updated_at=now()
    WHERE id=v_override.id;
  ELSE
    INSERT INTO public.meal_late_overrides(hostel_id,period_id,daily_meal_day_id,member_id,source_type,source_request_id,breakfast,lunch,dinner,status,reason,approved_by,approved_at)
    SELECT v_hostel,v_req.period_id,v_day.id,v_req.member_id,'member_late_request',v_req.id,
           mrd.breakfast,mrd.lunch,mrd.dinner,'approved',NULLIF(trim(p_reason),''),v_actor,now()
    FROM public.meal_request_days mrd WHERE mrd.request_id=v_req.id AND mrd.is_current=true;
  END IF;
  IF v_day.status='open' THEN UPDATE public.daily_meal_days SET status='locked',locked_at=COALESCE(locked_at,now()),updated_at=now() WHERE id=v_day.id; END IF;
  UPDATE public.meal_requests SET status='approved',reviewed_by=v_actor,reviewed_at=now(),updated_at=now() WHERE id=v_req.id;

  INSERT INTO public.notifications(hostel_id,notification_type,title,body,reference_type,reference_id,created_by,target_membership_id)
  SELECT v_hostel,'system'::public.notification_type,'লেট মিল রিকোয়েস্ট অনুমোদিত',
         format('%s-এর %s তারিখের লেট মিল অনুমোদন হয়েছে। রাত ৯টার finalization-এ এটি মূল হিসাবের সঙ্গে যুক্ত হবে.',COALESCE(v_name,'সদস্য'),to_char(v_req.start_date,'DD Mon YYYY')),
         'meal_request',v_req.id,v_actor,hm.id
  FROM public.hostel_memberships hm WHERE hm.hostel_id=v_hostel AND hm.status='active';

  RETURN jsonb_build_object('request_id',v_req.id,'status','approved','applies_at',v_day.finalizes_at,'public_card_until',v_day.finalizes_at);
END;
$review_late_request$;
REVOKE ALL ON FUNCTION public.manager_review_late_meal_request(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_review_late_meal_request(uuid,boolean,text) TO authenticated;

-- Corrected manager correction review: a pre-9-PM acceptance goes to the visible late card;
-- if that date is already finalized (for example the manager is catching up later), update
-- the authoritative final row and snapshot immediately rather than rejecting it as impossible.
CREATE OR REPLACE FUNCTION public.manager_review_correction(p_request_id uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $review_correction_recovery$
DECLARE
  v_req public.meal_requests;
  v_actor uuid;
  v_hostel uuid;
  v_day public.daily_meal_days;
  v_existing_override public.meal_late_overrides;
  d record;
  v_applied_now integer := 0;
  v_pending integer := 0;
  v_name text;
BEGIN
  PERFORM private.assert_authenticated();
  v_actor := private.current_membership_id(true);
  v_hostel := private.current_hostel_id(true);
  SELECT * INTO v_req FROM public.meal_requests mr
  WHERE mr.id=p_request_id AND mr.hostel_id=v_hostel
    AND mr.request_type='correction' AND mr.status='submitted'
  FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION USING message='সংশোধন রিকোয়েস্ট পাওয়া যায়নি বা ইতিমধ্যে পর্যালোচনা হয়েছে।'; END IF;
  IF NOT private.can_manage_period(v_req.period_id) THEN RAISE EXCEPTION USING message='এই রিকোয়েস্ট অনুমোদনের অনুমতি নেই।'; END IF;
  SELECT pr.full_name INTO v_name
  FROM public.hostel_memberships hm JOIN public.profiles pr ON pr.id=hm.user_id
  WHERE hm.id=v_req.member_id;

  IF NOT p_approve THEN
    IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION USING message='বাতিল করার কারণ লিখতে হবে।'; END IF;
    UPDATE public.meal_requests SET status='rejected', rejection_reason=trim(p_reason),
      reviewed_by=v_actor, reviewed_at=now(), updated_at=now() WHERE id=v_req.id;
    INSERT INTO public.notifications(hostel_id,notification_type,title,body,reference_type,reference_id,created_by,target_membership_id)
    VALUES(v_hostel,'system'::public.notification_type,'মিল সংশোধন বাতিল হয়েছে',trim(p_reason),
      'meal_request',v_req.id,v_actor,v_req.member_id);
    RETURN jsonb_build_object('request_id',v_req.id,'status','rejected');
  END IF;

  -- Preflight every day before mutating any record; the transaction rolls back atomically on error.
  FOR d IN SELECT mrd.* FROM public.meal_request_days mrd
    WHERE mrd.request_id=v_req.id AND mrd.is_current=true ORDER BY mrd.meal_date LOOP
    SELECT * INTO v_day FROM public.daily_meal_days dm
    WHERE dm.hostel_id=v_hostel AND dm.period_id=v_req.period_id AND dm.meal_date=d.meal_date
    FOR UPDATE;
    IF v_day.id IS NULL THEN RAISE EXCEPTION USING message=format('%s তারিখের meal-day record পাওয়া যায়নি।',to_char(d.meal_date,'DD Mon YYYY')); END IF;
    IF now()<v_day.cutoff_at THEN RAISE EXCEPTION USING message=format('%s তারিখের cutoff এখনো শেষ হয়নি; সাধারণ এডিট ব্যবহার করুন।',to_char(d.meal_date,'DD Mon YYYY')); END IF;
    IF NOT (v_day.status='finalized' OR now()>=v_day.finalizes_at) AND v_day.status NOT IN ('open','locked') THEN
      RAISE EXCEPTION USING message=format('%s তারিখের meal-day status সংশোধনের জন্য গ্রহণযোগ্য নয়।',to_char(d.meal_date,'DD Mon YYYY'));
    END IF;
    IF v_day.status <> 'finalized' AND now() < v_day.finalizes_at AND EXISTS(
      SELECT 1 FROM public.meal_late_overrides mlo
      WHERE mlo.daily_meal_day_id=v_day.id AND mlo.member_id=v_req.member_id AND mlo.status='approved'
    ) THEN RAISE EXCEPTION USING message=format('%s তারিখে একটি late change ইতিমধ্যে অনুমোদিত আছে।',to_char(d.meal_date,'DD Mon YYYY')); END IF;
  END LOOP;

  FOR d IN SELECT mrd.* FROM public.meal_request_days mrd
    WHERE mrd.request_id=v_req.id AND mrd.is_current=true ORDER BY mrd.meal_date LOOP
    SELECT * INTO v_day FROM public.daily_meal_days dm
    WHERE dm.hostel_id=v_hostel AND dm.period_id=v_req.period_id AND dm.meal_date=d.meal_date
    FOR UPDATE;
    IF v_day.status='finalized' OR now()>=v_day.finalizes_at THEN
      UPDATE public.daily_meal_records SET
        planned_breakfast=d.breakfast, planned_lunch=d.lunch, planned_dinner=d.dinner,
        actual_breakfast=d.breakfast, actual_lunch=d.lunch, actual_dinner=d.dinner,
        final_breakfast=d.breakfast, final_lunch=d.lunch, final_dinner=d.dinner,
        cancelled=false, finalization_source='late_correction', entered_by=v_actor, entered_at=now(),
        finalized_by=v_actor, finalized_at=now(), updated_at=now()
      WHERE daily_meal_day_id=v_day.id AND member_id=v_req.member_id;
      IF NOT FOUND THEN
        INSERT INTO public.daily_meal_records(
          hostel_id,period_id,daily_meal_day_id,member_id,
          planned_breakfast,planned_lunch,planned_dinner,
          actual_breakfast,actual_lunch,actual_dinner,
          final_breakfast,final_lunch,final_dinner,
          cancelled,finalization_source,entered_by,entered_at,finalized_by,finalized_at,updated_at
        ) VALUES(
          v_hostel,v_req.period_id,v_day.id,v_req.member_id,
          d.breakfast,d.lunch,d.dinner,d.breakfast,d.lunch,d.dinner,d.breakfast,d.lunch,d.dinner,
          false,'late_correction',v_actor,now(),v_actor,now(),now()
        );
      END IF;
      UPDATE public.meal_late_overrides SET status='void',reason='Replaced by approved finalized correction',updated_at=now()
      WHERE daily_meal_day_id=v_day.id AND member_id=v_req.member_id AND status='approved';
      UPDATE public.daily_meal_days SET status='finalized',finalized_at=COALESCE(finalized_at,now()),updated_at=now()
      WHERE id=v_day.id AND status<>'finalized';
      PERFORM private.refresh_meal_snapshot(v_hostel,d.meal_date);
      v_applied_now := v_applied_now + 1;
    ELSE
      IF v_day.status='open' THEN
        UPDATE public.daily_meal_days SET status='locked',locked_at=COALESCE(locked_at,now()),updated_at=now() WHERE id=v_day.id;
      END IF;
      SELECT * INTO v_existing_override
      FROM public.meal_late_overrides mlo
      WHERE mlo.daily_meal_day_id=v_day.id AND mlo.member_id=v_req.member_id
      FOR UPDATE;
      IF v_existing_override.id IS NOT NULL THEN
        -- The table intentionally has one override row per day/member. Reuse a void
        -- audit row instead of inserting a duplicate and violating the unique key.
        IF v_existing_override.status <> 'void' THEN
          RAISE EXCEPTION USING message=format('%s তারিখে এই সদস্যের একটি সক্রিয় late override আছে।',to_char(d.meal_date,'DD Mon YYYY'));
        END IF;
        UPDATE public.meal_late_overrides SET
          period_id=v_req.period_id,hostel_id=v_hostel,source_type='member_correction',source_request_id=v_req.id,
          breakfast=d.breakfast,lunch=d.lunch,dinner=d.dinner,status='approved',
          approved_by=v_actor,approved_at=now(),applied_at=NULL,
          reason='Approved after cutoff; waiting for 9 PM finalization.',updated_at=now()
        WHERE id=v_existing_override.id;
      ELSE
        INSERT INTO public.meal_late_overrides(
          hostel_id,period_id,daily_meal_day_id,member_id,source_type,source_request_id,
          breakfast,lunch,dinner,status,approved_by,approved_at,reason
        ) VALUES(
          v_hostel,v_req.period_id,v_day.id,v_req.member_id,'member_correction',v_req.id,
          d.breakfast,d.lunch,d.dinner,'approved',v_actor,now(),'Approved after cutoff; waiting for 9 PM finalization.'
        );
      END IF;
      v_pending := v_pending + 1;
    END IF;
  END LOOP;

  UPDATE public.meal_requests SET status='approved',reviewed_by=v_actor,reviewed_at=now(),updated_at=now() WHERE id=v_req.id;
  INSERT INTO public.notifications(hostel_id,notification_type,title,body,reference_type,reference_id,created_by,target_membership_id)
  VALUES(v_hostel,'system'::public.notification_type,'মিল সংশোধন অনুমোদিত',
    format('%s-এর মিল সংশোধন অনুমোদিত হয়েছে। %sটি দিন এখনই final হয়েছে এবং %sটি দিন ৯টার finalization-এ যুক্ত হবে.',COALESCE(v_name,'সদস্য'),v_applied_now,v_pending),
    'meal_request',v_req.id,v_actor,v_req.member_id);
  IF v_pending>0 AND EXISTS(
    SELECT 1 FROM public.meal_request_days mrd WHERE mrd.request_id=v_req.id AND mrd.is_current=true
      AND mrd.meal_date=private.current_local_date(v_hostel)
  ) THEN
    INSERT INTO public.notifications(hostel_id,notification_type,title,body,reference_type,reference_id,created_by,target_membership_id)
    SELECT v_hostel,'system'::public.notification_type,'লেট মিল সংশোধন অনুমোদিত',
      format('%s-এর আজকের মিল সংশোধন অনুমোদিত হয়েছে; রাত ৯টায় final হিসাবে যুক্ত হবে।',COALESCE(v_name,'একজন সদস্য')),
      'meal_request',v_req.id,v_actor,hm.id
    FROM public.hostel_memberships hm WHERE hm.hostel_id=v_hostel AND hm.status='active';
  END IF;
  RETURN jsonb_build_object('request_id',v_req.id,'status','approved','applied_immediately',v_applied_now,'pending_finalization',v_pending);
END;
$review_correction_recovery$;
REVOKE ALL ON FUNCTION public.manager_review_correction(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_review_correction(uuid,boolean,text) TO authenticated;

-- Late card follows the target meal date and disappears at that target day's 9 PM finalization.
-- This also lets a request approved after the previous evening's 10 PM cutoff appear for tomorrow.
CREATE OR REPLACE FUNCTION public.get_late_request_card(p_meal_date date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $late_card_feature_recovery$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'override_id',lo.id,
    'request_id',lo.source_request_id,
    'member_id',lo.member_id,
    'membership_id',lo.member_id,
    'name',pr.full_name,
    'member_name',pr.full_name,
    'meal_date',dmd.meal_date,
    'target_meal_date',dmd.meal_date,
    'breakfast',lo.breakfast,
    'lunch',lo.lunch,
    'dinner',lo.dinner,
    'total',COALESCE(lo.breakfast,0)+COALESCE(lo.lunch,0)+COALESCE(lo.dinner,0),
    'source',lo.source_type,
    'status',lo.status,
    'approved_at',lo.approved_at,
    'finalizes_at',dmd.finalizes_at,
    'visible_until',dmd.finalizes_at,
    'reason',lo.reason
  ) ORDER BY lo.approved_at DESC,pr.full_name),'[]'::jsonb)
  FROM public.meal_late_overrides lo
  JOIN public.daily_meal_days dmd ON dmd.id=lo.daily_meal_day_id
  JOIN public.monthly_periods mp ON mp.id=dmd.period_id AND mp.status='running'
  JOIN public.hostel_memberships hm ON hm.id=lo.member_id AND hm.hostel_id=lo.hostel_id AND hm.status='active'
  JOIN public.profiles pr ON pr.id=hm.user_id
  WHERE lo.hostel_id=private.current_hostel_id(true)
    AND dmd.meal_date=p_meal_date
    AND lo.status='approved'
    AND lo.approved_at IS NOT NULL
    AND now()<dmd.finalizes_at;
$late_card_feature_recovery$;
REVOKE ALL ON FUNCTION public.get_late_request_card(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_late_request_card(date) TO authenticated;

-- Read-only account/member detail for members in the same hostel. No cross-hostel access.
CREATE OR REPLACE FUNCTION public.get_member_period_details(p_member_id uuid, p_period_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $member_period_details$
DECLARE
  v_hostel uuid;
  v_actor uuid;
  v_period uuid := p_period_id;
  v_member record;
  v_period_row public.monthly_periods;
  v_meals jsonb := '[]'::jsonb;
  v_tx jsonb := '[]'::jsonb;
  v_markets jsonb := '[]'::jsonb;
  v_total_meals numeric := 0;
  v_all_meals numeric := 0;
  v_total_market numeric := 0;
  v_rate numeric := 0;
  v_deposit numeric := 0;
  v_other numeric := 0;
  v_ledger numeric := 0;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  v_actor := private.current_membership_id(true);
  IF NOT EXISTS (SELECT 1 FROM public.hostel_memberships hm WHERE hm.id=v_actor AND hm.hostel_id=v_hostel AND hm.status='active') THEN
    RAISE EXCEPTION USING message='সক্রিয় মেস সদস্য হওয়া প্রয়োজন।';
  END IF;
  SELECT hm.id AS membership_id, hm.user_id, hm.status, hm.role, pr.full_name
    INTO v_member
  FROM public.hostel_memberships hm JOIN public.profiles pr ON pr.id=hm.user_id
  WHERE hm.id=p_member_id AND hm.hostel_id=v_hostel;
  IF v_member.membership_id IS NULL THEN RAISE EXCEPTION USING message='এই সদস্য আপনার মেসে পাওয়া যায়নি।'; END IF;

  IF v_period IS NULL THEN
    SELECT mp.id INTO v_period FROM public.monthly_periods mp WHERE mp.hostel_id=v_hostel AND mp.status='running'
    ORDER BY mp.start_date DESC,mp.created_at DESC LIMIT 1;
  END IF;
  IF v_period IS NOT NULL THEN
    SELECT * INTO v_period_row FROM public.monthly_periods mp WHERE mp.id=v_period AND mp.hostel_id=v_hostel;
    IF v_period_row.id IS NULL THEN RAISE EXCEPTION USING message='নির্বাচিত মাস এই মেসের নয়।'; END IF;

    SELECT COALESCE(sum(COALESCE(dmr.final_breakfast,0)+COALESCE(dmr.final_lunch,0)+COALESCE(dmr.final_dinner,0)),0)
      INTO v_all_meals
    FROM public.daily_meal_records dmr JOIN public.daily_meal_days dmd ON dmd.id=dmr.daily_meal_day_id
    WHERE dmr.period_id=v_period AND dmd.status='finalized' AND NOT dmr.cancelled;
    SELECT COALESCE(sum(me.total_amount),0) INTO v_total_market FROM public.market_entries me WHERE me.period_id=v_period AND me.status='active';
    IF v_all_meals>0 THEN v_rate:=v_total_market/v_all_meals; END IF;

    SELECT COALESCE(sum(COALESCE(dmr.final_breakfast,0)+COALESCE(dmr.final_lunch,0)+COALESCE(dmr.final_dinner,0)),0)
      INTO v_total_meals
    FROM public.daily_meal_records dmr JOIN public.daily_meal_days dmd ON dmd.id=dmr.daily_meal_day_id
    WHERE dmr.period_id=v_period AND dmr.member_id=p_member_id AND dmd.status='finalized' AND NOT dmr.cancelled;

    SELECT COALESCE(sum(lt.amount),0) INTO v_deposit
    FROM public.ledger_transactions lt
    WHERE lt.period_id=v_period AND lt.member_id=p_member_id AND (
      lt.ledger_type IN ('deposit','market_deposit') OR
      (lt.ledger_type='adjustment' AND EXISTS(SELECT 1 FROM public.ledger_transactions parent WHERE parent.id=lt.parent_transaction_id AND parent.ledger_type IN ('deposit','market_deposit')))
    );
    SELECT GREATEST(0,-COALESCE(sum(lt.amount),0)) INTO v_other
    FROM public.ledger_transactions lt
    WHERE lt.period_id=v_period AND lt.member_id=p_member_id AND (
      lt.ledger_type='other_expense' OR
      (lt.ledger_type='adjustment' AND EXISTS(SELECT 1 FROM public.ledger_transactions parent WHERE parent.id=lt.parent_transaction_id AND parent.ledger_type='other_expense'))
    );
    SELECT COALESCE(sum(lt.amount),0) INTO v_ledger FROM public.ledger_transactions lt WHERE lt.period_id=v_period AND lt.member_id=p_member_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'date',dmd.meal_date,'breakfast',COALESCE(dmr.final_breakfast,0),'lunch',COALESCE(dmr.final_lunch,0),
      'dinner',COALESCE(dmr.final_dinner,0),'total',COALESCE(dmr.final_breakfast,0)+COALESCE(dmr.final_lunch,0)+COALESCE(dmr.final_dinner,0),
      'finalized_at',dmr.finalized_at,'finalization_source',dmr.finalization_source
    ) ORDER BY dmd.meal_date DESC),'[]'::jsonb) INTO v_meals
    FROM public.daily_meal_records dmr JOIN public.daily_meal_days dmd ON dmd.id=dmr.daily_meal_day_id
    WHERE dmr.period_id=v_period AND dmr.member_id=p_member_id AND dmd.status='finalized' AND NOT dmr.cancelled;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'transaction_id',lt.id,'entry_date',lt.entry_date,'transaction_type',lt.ledger_type,
      'amount',lt.amount,'description',lt.description,'created_at',lt.created_at,
      'reference_type',lt.reference_type,'reference_id',lt.reference_id
    ) ORDER BY lt.entry_date DESC,lt.created_at DESC),'[]'::jsonb) INTO v_tx
    FROM public.ledger_transactions lt WHERE lt.period_id=v_period AND lt.member_id=p_member_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'market_entry_id',me.id,'entry_date',me.entry_date,'total_amount',me.total_amount,
      'status',me.status,'credit_to_buyer',me.credit_to_buyer,'created_at',me.created_at,
      'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',mi.item_name,'quantity',mi.quantity,'amount',mi.amount) ORDER BY mi.serial_no)
        FROM public.market_items mi WHERE mi.market_entry_id=me.id),'[]'::jsonb)
    ) ORDER BY me.entry_date DESC,me.created_at DESC),'[]'::jsonb) INTO v_markets
    FROM public.market_entries me WHERE me.period_id=v_period AND me.buyer_membership_id=p_member_id;
  END IF;

  RETURN jsonb_build_object(
    'member',jsonb_build_object('membership_id',v_member.membership_id,'name',v_member.full_name,'status',v_member.status,'role',v_member.role,
      'is_primary_manager',CASE WHEN v_period IS NULL THEN false ELSE v_period_row.primary_manager_membership_id=p_member_id END,
      'is_assistant_manager',CASE WHEN v_period IS NULL THEN false ELSE EXISTS(SELECT 1 FROM public.period_assistant_managers pam WHERE pam.period_id=v_period AND pam.membership_id=p_member_id) END),
    'period',CASE WHEN v_period IS NULL THEN NULL ELSE jsonb_build_object('period_id',v_period_row.id,'label',v_period_row.label,'start_date',v_period_row.start_date,'end_date',v_period_row.end_date,'status',v_period_row.status) END,
    'summary',jsonb_build_object('final_meals',v_total_meals,'total_deposit',v_deposit,'total_market',v_total_market,'meal_rate',round(v_rate,4),
      'meal_cost',round(v_total_meals*v_rate,2),'other_expense',v_other,'balance',round(v_ledger-(v_total_meals*v_rate),2)),
    'daily_meals',v_meals,'transactions',v_tx,'market_entries',v_markets
  );
END;
$member_period_details$;
REVOKE ALL ON FUNCTION public.get_member_period_details(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_period_details(uuid,uuid) TO authenticated;

-- Preserve and expose existing market business logic; reload PostgREST's schema cache so the
-- browser sees newly installed RPCs. The exact market failure still has diagnostics below.
GRANT EXECUTE ON FUNCTION public.create_market_entry(date,uuid,jsonb,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_update_market_entry(uuid,date,uuid,jsonb,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_void_market_entry(uuid,text) TO authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Read-only diagnostics: these report current state without changing business data.
SELECT 'FEATURE_RECOVERY_V1' AS check_name, 'committed' AS result
UNION ALL SELECT 'LATE_REQUEST_COLUMN', CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meal_requests' AND column_name='is_late_request') THEN 'present' ELSE 'missing' END
UNION ALL SELECT 'MY_REQUESTS_V2', CASE WHEN to_regprocedure('public.get_my_meal_requests_v2(integer)') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL SELECT 'MANAGER_REQUESTS_V3', CASE WHEN to_regprocedure('public.get_manager_meal_requests_v3(uuid,public.meal_request_type,public.request_status,boolean,integer)') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL SELECT 'CREATE_LATE_REQUEST', CASE WHEN to_regprocedure('public.create_late_meal_request(date,numeric,numeric,numeric,text)') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL SELECT 'REVIEW_LATE_REQUEST', CASE WHEN to_regprocedure('public.manager_review_late_meal_request(uuid,boolean,text)') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL SELECT 'MEMBER_DETAIL_RPC', CASE WHEN to_regprocedure('public.get_member_period_details(uuid,uuid)') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL SELECT 'NOTIFY_HELPER', CASE WHEN to_regprocedure('private.notify_period_managers(uuid,text,text,text,uuid,uuid)') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL SELECT 'MARKET_CREATE_EXECUTE', CASE WHEN has_function_privilege('authenticated','public.create_market_entry(date,uuid,jsonb,boolean)','EXECUTE') THEN 'granted' ELSE 'missing' END
UNION ALL SELECT 'MARKET_UPDATE_EXECUTE', CASE WHEN has_function_privilege('authenticated','public.manager_update_market_entry(uuid,date,uuid,jsonb,boolean,text)','EXECUTE') THEN 'granted' ELSE 'missing' END
UNION ALL SELECT 'MARKET_VOID_EXECUTE', CASE WHEN has_function_privilege('authenticated','public.manager_void_market_entry(uuid,text)','EXECUTE') THEN 'granted' ELSE 'missing' END
UNION ALL SELECT 'RUNNING_PERIODS', count(*)::text FROM public.monthly_periods WHERE status='running'
UNION ALL SELECT 'MARKET_ENTRIES', count(*)::text FROM public.market_entries WHERE status='active'
UNION ALL SELECT 'MEAL_REQUESTS', count(*)::text FROM public.meal_requests
UNION ALL SELECT 'MARKET_RLS', COALESCE((SELECT relrowsecurity::text || ' / forced=' || relforcerowsecurity::text FROM pg_class WHERE oid='public.market_entries'::regclass),'unknown');
