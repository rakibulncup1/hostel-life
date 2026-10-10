-- HOSTEL LIFE — PRE-SUPERADMIN FUNCTIONAL RECOVERY V2
-- Scope: request/correction/finalization/late-card/manager-edit/month-close safety.
-- This is a controlled migration: no DROP, TRUNCATE, or bulk historical reset.
-- Run ONCE after the already-successful Phase 1 / Phase 3 / Core Recovery SQLs.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Internal guard so the month-close maintenance path does not get blocked
--    by the two historical normal-request overlaps already present before the
--    protection trigger was introduced. The protection remains active for all
--    normal client operations.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.period_close_internal()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
  SELECT COALESCE(current_setting('hostel_life.period_close', true), '') = 'on';
$function$;

CREATE OR REPLACE FUNCTION private.prevent_normal_meal_request_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF new.request_type='normal'::meal_request_type
     AND new.status IN ('submitted'::request_status,'approved'::request_status)
     AND NOT private.period_close_internal() THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(new.member_id::text||':'||new.period_id::text,0)
    );
    IF EXISTS(
      SELECT 1
      FROM public.meal_requests mr
      WHERE mr.id<>new.id
        AND mr.member_id=new.member_id
        AND mr.period_id=new.period_id
        AND mr.request_type='normal'::meal_request_type
        AND mr.status IN ('submitted'::request_status,'approved'::request_status)
        AND new.start_date<=mr.end_date
        AND mr.start_date<=new.end_date
    ) THEN
      RAISE EXCEPTION USING message='এই তারিখগুলোর মধ্যে এক বা একাধিক দিনের মিল রিকোয়েস্ট আগে থেকেই রয়েছে। একই দিনের রিকোয়েস্ট দুইবার দেওয়া যাবে না।';
    END IF;
  END IF;
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION private.prevent_correction_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF new.request_type='correction'::meal_request_type
     AND new.status IN ('submitted'::request_status,'approved'::request_status)
     AND NOT private.period_close_internal() THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('correction:'||new.member_id::text||':'||new.period_id::text,0)
    );
    IF EXISTS(
      SELECT 1
      FROM public.meal_requests mr
      WHERE mr.id<>new.id
        AND mr.member_id=new.member_id
        AND mr.period_id=new.period_id
        AND mr.request_type='correction'::meal_request_type
        AND mr.status IN ('submitted'::request_status,'approved'::request_status)
        AND new.start_date<=mr.end_date
        AND mr.start_date<=new.end_date
    ) THEN
      RAISE EXCEPTION USING message='এই তারিখগুলোর জন্য একটি সংশোধন রিকোয়েস্ট ইতিমধ্যে রয়েছে।';
    END IF;
  END IF;
  RETURN new;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2) Make period-close maintenance immune to the historical-overlap trigger
--    while preserving the existing business behavior for normal client writes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.cancel_period_after_date(
  p_period_id uuid,
  p_keep_through_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_hostel_id uuid;
  v_request_count integer := 0;
  v_day_count integer := 0;
  v_request record;
BEGIN
  SELECT hostel_id INTO v_hostel_id
  FROM public.monthly_periods
  WHERE id=p_period_id;

  IF v_hostel_id IS NULL THEN
    RAISE EXCEPTION USING message='মাসটি পাওয়া যায়নি।';
  END IF;

  -- This routine is only called by trusted period-close code.
  PERFORM set_config('hostel_life.period_close','on',true);

  UPDATE public.meal_requests mr
     SET status='cancelled'::request_status,
         updated_at=now()
   WHERE mr.period_id=p_period_id
     AND mr.start_date>p_keep_through_date
     AND mr.status IN ('submitted'::request_status,'approved'::request_status);
  GET DIAGNOSTICS v_request_count=row_count;

  FOR v_request IN
    SELECT mr.id
    FROM public.meal_requests mr
    WHERE mr.period_id=p_period_id
      AND mr.start_date<=p_keep_through_date
      AND mr.end_date>p_keep_through_date
      AND mr.status IN ('submitted'::request_status,'approved'::request_status)
    FOR UPDATE
  LOOP
    UPDATE public.meal_request_days
       SET is_current=false,
           updated_at=now()
     WHERE request_id=v_request.id
       AND meal_date>p_keep_through_date;

    UPDATE public.meal_requests
       SET end_date=p_keep_through_date,
           updated_at=now()
     WHERE id=v_request.id;
  END LOOP;

  DELETE FROM public.meal_late_overrides mlo
  USING public.daily_meal_days dmd
  WHERE mlo.daily_meal_day_id=dmd.id
    AND dmd.period_id=p_period_id
    AND dmd.meal_date>p_keep_through_date;

  DELETE FROM public.daily_meal_records dmr
  USING public.daily_meal_days dmd
  WHERE dmr.daily_meal_day_id=dmd.id
    AND dmd.period_id=p_period_id
    AND dmd.meal_date>p_keep_through_date
    AND dmd.status<>'finalized'::meal_day_status;

  DELETE FROM public.daily_meal_snapshots s
  WHERE s.hostel_id=v_hostel_id
    AND s.meal_date>p_keep_through_date
    AND EXISTS(
      SELECT 1
      FROM public.daily_meal_days d
      WHERE d.period_id=p_period_id
        AND d.meal_date=s.meal_date
    );

  DELETE FROM public.daily_meal_days d
  WHERE d.period_id=p_period_id
    AND d.meal_date>p_keep_through_date;
  GET DIAGNOSTICS v_day_count=row_count;

  RETURN jsonb_build_object(
    'cancelled_requests',v_request_count,
    'removed_future_days',v_day_count,
    'keep_through_date',p_keep_through_date
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3) Public late-request card: only approved overrides, only while the target
--    day is still before its 9 PM finalization point, and only for the current
--    running period. After 9 PM the data is no longer presented as "late".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_late_request_card(p_meal_date date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
  SELECT CASE
    WHEN p_meal_date IS NULL THEN '[]'::jsonb
    WHEN p_meal_date < private.current_local_date(private.current_hostel_id(true)) THEN '[]'::jsonb
    ELSE COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'override_id',lo.id,
          'request_id',lo.source_request_id,
          'member_id',lo.member_id,
          'name',p.full_name,
          'member_name',p.full_name,
          'breakfast',lo.breakfast,
          'lunch',lo.lunch,
          'dinner',lo.dinner,
          'total',lo.breakfast+lo.lunch+lo.dinner,
          'source',lo.source_type,
          'approved_at',lo.approved_at,
          'reason',lo.reason
        )
        ORDER BY p.full_name,lo.approved_at
      ),
      '[]'::jsonb
    )
  END
  FROM public.meal_late_overrides lo
  JOIN public.daily_meal_days dmd ON dmd.id=lo.daily_meal_day_id
  JOIN public.monthly_periods mp ON mp.id=dmd.period_id
  JOIN public.hostel_memberships hm ON hm.id=lo.member_id
  JOIN public.profiles p ON p.id=hm.user_id
  WHERE lo.hostel_id=private.current_hostel_id(true)
    AND dmd.meal_date=p_meal_date
    AND dmd.status<>'finalized'::meal_day_status
    AND now()<dmd.finalizes_at
    AND lo.status='approved'
    AND mp.status='running'::month_status
    AND hm.hostel_id=lo.hostel_id
    AND hm.status='active';
$function$;

REVOKE ALL ON FUNCTION public.get_late_request_card(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_late_request_card(date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Offline bundle uses exactly the same late-card rule as the online card.
--    Cached data itself remains durable; the client hides an expired late-card
--    entry locally as an additional presentation safeguard.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_offline_meal_bundle()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_hostel_id uuid;
  v_today date;
  v_today_snapshot public.daily_meal_snapshots;
  v_tomorrow_snapshot public.daily_meal_snapshots;
  v_today_late jsonb := '[]'::jsonb;
  v_tomorrow_late jsonb := '[]'::jsonb;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel_id:=private.current_hostel_id(true);
  IF v_hostel_id IS NULL THEN
    RAISE EXCEPTION USING message='প্রথমে একটি মেসে যুক্ত হন।';
  END IF;

  v_today:=private.current_local_date(v_hostel_id);

  SELECT * INTO v_today_snapshot
  FROM public.daily_meal_snapshots
  WHERE hostel_id=v_hostel_id AND meal_date=v_today;

  SELECT * INTO v_tomorrow_snapshot
  FROM public.daily_meal_snapshots
  WHERE hostel_id=v_hostel_id AND meal_date=v_today+1;

  SELECT public.get_late_request_card(v_today) INTO v_today_late;
  SELECT public.get_late_request_card(v_today+1) INTO v_tomorrow_late;

  RETURN jsonb_build_object(
    'today',CASE WHEN v_today_snapshot.id IS NULL THEN NULL ELSE jsonb_build_object(
      'meal_date',v_today_snapshot.meal_date,
      'breakfast',v_today_snapshot.breakfast_total,
      'lunch',v_today_snapshot.lunch_total,
      'dinner',v_today_snapshot.dinner_total,
      'total',v_today_snapshot.total_meals,
      'server_snapshot_at',v_today_snapshot.server_snapshot_at,
      'source_status',v_today_snapshot.source_status,
      'member_details',CASE WHEN jsonb_typeof(coalesce(v_today_snapshot.snapshot_payload,'[]'::jsonb))='array'
        THEN coalesce(v_today_snapshot.snapshot_payload,'[]'::jsonb) ELSE '[]'::jsonb END,
      'late_requests',v_today_late
    ) END,
    'tomorrow',CASE WHEN v_tomorrow_snapshot.id IS NULL THEN NULL ELSE jsonb_build_object(
      'meal_date',v_tomorrow_snapshot.meal_date,
      'breakfast',v_tomorrow_snapshot.breakfast_total,
      'lunch',v_tomorrow_snapshot.lunch_total,
      'dinner',v_tomorrow_snapshot.dinner_total,
      'total',v_tomorrow_snapshot.total_meals,
      'server_snapshot_at',v_tomorrow_snapshot.server_snapshot_at,
      'source_status',v_tomorrow_snapshot.source_status,
      'member_details',CASE WHEN jsonb_typeof(coalesce(v_tomorrow_snapshot.snapshot_payload,'[]'::jsonb))='array'
        THEN coalesce(v_tomorrow_snapshot.snapshot_payload,'[]'::jsonb) ELSE '[]'::jsonb END,
      'late_requests',v_tomorrow_late
    ) END,
    'server_fetched_at',now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_offline_meal_bundle() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_offline_meal_bundle() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Correction request: an old/past day is valid for correction once its
--    cutoff has passed, including a day whose 9 PM finalization already ran.
--    The latter is intentionally reviewed by the manager and applied to final.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_meal_correction_request(
  p_start_date date,
  p_end_date date,
  p_days jsonb,
  p_parent_request_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_member uuid;
  v_hostel uuid;
  v_period uuid;
  v_request uuid;
  v_parent public.meal_requests;
  v_expected integer;
  v_count integer;
  v_distinct integer;
  v_min date;
  v_max date;
  d record;
  v_day public.daily_meal_days;
BEGIN
  PERFORM private.assert_authenticated();
  v_member:=private.current_membership_id(true);
  v_hostel:=private.current_hostel_id(true);

  IF v_member IS NULL OR v_hostel IS NULL THEN
    RAISE EXCEPTION USING message='সক্রিয় সদস্য হওয়া প্রয়োজন।';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date>p_end_date THEN
    RAISE EXCEPTION USING message='সংশোধনের তারিখ সঠিক নয়।';
  END IF;

  v_period:=private.period_for_hostel_date(v_hostel,p_start_date);
  IF v_period IS NULL OR private.period_for_hostel_date(v_hostel,p_end_date) IS DISTINCT FROM v_period THEN
    RAISE EXCEPTION USING message='সংশোধনের তারিখগুলো একই period-এর মধ্যে হতে হবে।';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.monthly_periods mp
    WHERE mp.id=v_period AND mp.status='running'::month_status
  ) THEN
    RAISE EXCEPTION USING message='এই period আর চলমান নেই। চলমান মাসে থাকতেই member correction request পাঠাতে হবে।';
  END IF;

  IF p_parent_request_id IS NOT NULL THEN
    SELECT * INTO v_parent
    FROM public.meal_requests
    WHERE id=p_parent_request_id
      AND hostel_id=v_hostel
      AND period_id=v_period
      AND member_id=v_member
      AND request_type='normal'::meal_request_type
      AND status='approved'::request_status;
    IF v_parent.id IS NULL THEN
      RAISE EXCEPTION USING message='মূল মিল রিকোয়েস্টটি পাওয়া যায়নি।';
    END IF;
    IF p_start_date<v_parent.start_date OR p_end_date>v_parent.end_date THEN
      RAISE EXCEPTION USING message='সংশোধনের তারিখ অবশ্যই মূল মিল রিকোয়েস্টের তারিখসীমার মধ্যে হতে হবে।';
    END IF;
  END IF;

  v_expected:=p_end_date-p_start_date+1;
  SELECT count(*)::int,count(DISTINCT meal_date)::int,min(meal_date),max(meal_date)
    INTO v_count,v_distinct,v_min,v_max
  FROM jsonb_to_recordset(p_days) AS x(meal_date date,breakfast numeric,lunch numeric,dinner numeric);

  IF coalesce(v_count,0)<>v_expected
     OR coalesce(v_distinct,0)<>v_expected
     OR v_min<>p_start_date
     OR v_max<>p_end_date THEN
    RAISE EXCEPTION USING message='সংশোধনের সব দিনের তথ্য দিতে হবে।';
  END IF;

  PERFORM private.ensure_period_days(v_period);
  PERFORM pg_advisory_xact_lock(hashtextextended('correction-submit:'||v_member::text||':'||v_period::text,0));

  FOR d IN SELECT * FROM jsonb_to_recordset(p_days) AS x(meal_date date,breakfast numeric,lunch numeric,dinner numeric) LOOP
    SELECT * INTO v_day
    FROM public.daily_meal_days
    WHERE hostel_id=v_hostel AND meal_date=d.meal_date;

    IF v_day.id IS NULL THEN
      RAISE EXCEPTION USING message='নির্বাচিত দিনের মিল তথ্য পাওয়া যায়নি।';
    END IF;

    IF now()<v_day.cutoff_at THEN
      RAISE EXCEPTION USING message=format('%s তারিখের কাট-অফ এখনো শেষ হয়নি। এই দিনের মিল সরাসরি edit করা যাবে।',to_char(d.meal_date,'DD Mon YYYY'));
    END IF;

    IF d.breakfast IS NULL OR d.lunch IS NULL OR d.dinner IS NULL
       OR d.breakfast<0 OR d.lunch<0 OR d.dinner<0
       OR d.breakfast>50 OR d.lunch>50 OR d.dinner>50 THEN
      RAISE EXCEPTION USING message='মিলের পরিমাণ সঠিক নয়।';
    END IF;

    IF EXISTS(
      SELECT 1 FROM public.meal_late_overrides mlo
      WHERE mlo.daily_meal_day_id=v_day.id
        AND mlo.member_id=v_member
        AND mlo.status IN ('approved','applied')
        AND mlo.source_request_id IS DISTINCT FROM p_parent_request_id
    ) THEN
      RAISE EXCEPTION USING message=format('%s তারিখের জন্য একটি পূর্বের late correction ইতিমধ্যে প্রয়োগ/অনুমোদিত হয়েছে। নতুন correction-এর আগে manager review history দেখুন।',to_char(d.meal_date,'DD Mon YYYY'));
    END IF;
  END LOOP;

  IF EXISTS(
    SELECT 1 FROM public.meal_requests mr
    WHERE mr.member_id=v_member
      AND mr.period_id=v_period
      AND mr.request_type='correction'::meal_request_type
      AND mr.status IN ('submitted'::request_status,'approved'::request_status)
      AND p_start_date<=mr.end_date
      AND mr.start_date<=p_end_date
  ) THEN
    RAISE EXCEPTION USING message='নির্বাচিত তারিখগুলোর জন্য একটি সংশোধন রিকোয়েস্ট আগে থেকেই রয়েছে। আগের রিকোয়েস্টের ইতিহাস থেকে সেটি দেখুন।';
  END IF;

  INSERT INTO public.meal_requests(
    hostel_id,period_id,member_id,request_type,status,start_date,end_date,
    parent_request_id,origin,submitted_at
  ) VALUES(
    v_hostel,v_period,v_member,'correction'::meal_request_type,'submitted'::request_status,
    p_start_date,p_end_date,p_parent_request_id,'member',now()
  ) RETURNING id INTO v_request;

  FOR d IN SELECT * FROM jsonb_to_recordset(p_days) AS x(meal_date date,breakfast numeric,lunch numeric,dinner numeric) LOOP
    INSERT INTO public.meal_request_days(request_id,meal_date,breakfast,lunch,dinner,is_current)
    VALUES(v_request,d.meal_date,d.breakfast,d.lunch,d.dinner,true);
  END LOOP;

  PERFORM private.notify_period_managers(
    v_period,
    'মিল সংশোধন রিকোয়েস্ট',
    format('%s থেকে %s পর্যন্ত একজন সদস্যের মিল সংশোধন রিকোয়েস্ট এসেছে।',to_char(p_start_date,'DD Mon YYYY'),to_char(p_end_date,'DD Mon YYYY')),
    'meal_request',v_request,v_member
  );

  RETURN jsonb_build_object(
    'request_id',v_request,
    'status','submitted',
    'request_type','correction',
    'start_date',p_start_date,
    'end_date',p_end_date
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6) Manager correction approval: if the publication point (9 PM) already
--    passed, apply directly to final records + snapshot; otherwise create an
--    approved late override for the scheduled finalizer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manager_review_correction(
  p_request_id uuid,
  p_approve boolean,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_req public.meal_requests;
  v_actor uuid;
  v_hostel uuid;
  d record;
  v_day public.daily_meal_days;
  v_immediate integer := 0;
  v_pending integer := 0;
BEGIN
  PERFORM private.assert_authenticated();
  v_actor:=private.current_membership_id(true);
  v_hostel:=private.current_hostel_id(true);

  SELECT * INTO v_req
  FROM public.meal_requests
  WHERE id=p_request_id
    AND hostel_id=v_hostel
    AND request_type='correction'::meal_request_type
    AND status='submitted'::request_status
  FOR UPDATE;

  IF v_req.id IS NULL THEN
    RAISE EXCEPTION USING message='সংশোধন রিকোয়েস্ট পাওয়া যায়নি বা ইতিমধ্যে পর্যালোচনা হয়েছে।';
  END IF;

  IF NOT private.can_manage_period(v_req.period_id) THEN
    RAISE EXCEPTION USING message='এই রিকোয়েস্ট অনুমোদনের অনুমতি নেই।';
  END IF;

  IF NOT p_approve THEN
    IF p_reason IS NULL OR length(trim(p_reason))<1 THEN
      RAISE EXCEPTION USING message='বাতিল করার কারণ লিখতে হবে।';
    END IF;

    UPDATE public.meal_requests
    SET status='rejected'::request_status,
        rejection_reason=trim(p_reason),
        reviewed_by=v_actor,
        reviewed_at=now(),
        updated_at=now()
    WHERE id=p_request_id;

    INSERT INTO public.notifications(
      hostel_id,notification_type,title,body,reference_type,reference_id,created_by,target_membership_id
    ) VALUES(
      v_hostel,'system','মিল সংশোধন বাতিল হয়েছে',
      'আপনার মিল সংশোধন রিকোয়েস্ট অনুমোদিত হয়নি।','meal_request',v_req.id,v_actor,v_req.member_id
    );

    RETURN jsonb_build_object('request_id',p_request_id,'status','rejected');
  END IF;

  -- Full preflight before mutating anything, making approval atomic.
  FOR d IN
    SELECT * FROM public.meal_request_days
    WHERE request_id=p_request_id AND is_current=true
    ORDER BY meal_date
  LOOP
    SELECT * INTO v_day
    FROM public.daily_meal_days
    WHERE hostel_id=v_hostel AND meal_date=d.meal_date
    FOR UPDATE;

    IF v_day.id IS NULL THEN
      RAISE EXCEPTION USING message='নির্বাচিত দিনের মিল তথ্য পাওয়া যায়নি।';
    END IF;

    IF now()<v_day.cutoff_at THEN
      RAISE EXCEPTION USING message=format('%s তারিখের correction request এখন approve করা যাবে না। ওই দিনের cutoff এখনো পার হয়নি।',to_char(d.meal_date,'DD Mon YYYY'));
    END IF;

    IF EXISTS(
      SELECT 1 FROM public.meal_late_overrides mlo
      WHERE mlo.daily_meal_day_id=v_day.id
        AND mlo.member_id=v_req.member_id
        AND mlo.status IN ('approved','applied')
        AND mlo.source_request_id IS DISTINCT FROM v_req.id
    ) THEN
      RAISE EXCEPTION USING message=format('%s তারিখের জন্য অন্য একটি approved/applied late correction আছে। আগে সেটি resolve করুন।',to_char(d.meal_date,'DD Mon YYYY'));
    END IF;
  END LOOP;

  FOR d IN
    SELECT * FROM public.meal_request_days
    WHERE request_id=p_request_id AND is_current=true
    ORDER BY meal_date
  LOOP
    SELECT * INTO v_day
    FROM public.daily_meal_days
    WHERE hostel_id=v_hostel AND meal_date=d.meal_date
    FOR UPDATE;

    IF v_day.status='open'::meal_day_status AND now()<v_day.finalizes_at THEN
      UPDATE public.daily_meal_days
      SET status='locked'::meal_day_status,
          locked_at=coalesce(locked_at,now()),
          updated_at=now()
      WHERE id=v_day.id;
    END IF;

    IF now()>=v_day.finalizes_at THEN
      INSERT INTO public.meal_late_overrides(
        hostel_id,period_id,daily_meal_day_id,member_id,
        source_type,source_request_id,breakfast,lunch,dinner,status,reason,
        approved_by,approved_at,applied_at
      ) VALUES(
        v_hostel,v_req.period_id,v_day.id,v_req.member_id,
        'member_correction',v_req.id,d.breakfast,d.lunch,d.dinner,'applied',
        'Approved after the daily 9 PM publication point.',v_actor,now(),now()
      );

      UPDATE public.daily_meal_records
      SET planned_breakfast=d.breakfast,
          planned_lunch=d.lunch,
          planned_dinner=d.dinner,
          actual_breakfast=d.breakfast,
          actual_lunch=d.lunch,
          actual_dinner=d.dinner,
          final_breakfast=d.breakfast,
          final_lunch=d.lunch,
          final_dinner=d.dinner,
          cancelled=false,
          finalization_source='late_correction',
          entered_by=v_actor,
          entered_at=now(),
          finalized_by=v_actor,
          finalized_at=now(),
          updated_at=now()
      WHERE daily_meal_day_id=v_day.id
        AND member_id=v_req.member_id;

      IF NOT FOUND THEN
        INSERT INTO public.daily_meal_records(
          hostel_id,period_id,daily_meal_day_id,member_id,
          planned_breakfast,planned_lunch,planned_dinner,
          actual_breakfast,actual_lunch,actual_dinner,
          final_breakfast,final_lunch,final_dinner,
          cancelled,finalization_source,entered_by,entered_at,finalized_by,finalized_at
        ) VALUES(
          v_hostel,v_req.period_id,v_day.id,v_req.member_id,
          d.breakfast,d.lunch,d.dinner,
          d.breakfast,d.lunch,d.dinner,
          d.breakfast,d.lunch,d.dinner,
          false,'late_correction',v_actor,now(),v_actor,now()
        );
      END IF;

      UPDATE public.daily_meal_days
      SET status='finalized'::meal_day_status,
          finalized_at=coalesce(finalized_at,now()),
          updated_at=now()
      WHERE id=v_day.id AND status<>'finalized'::meal_day_status;

      PERFORM private.refresh_meal_snapshot(v_hostel,d.meal_date);
      v_immediate:=v_immediate+1;
    ELSE
      INSERT INTO public.meal_late_overrides(
        hostel_id,period_id,daily_meal_day_id,member_id,
        source_type,source_request_id,breakfast,lunch,dinner,status,reason,
        approved_by,approved_at
      ) VALUES(
        v_hostel,v_req.period_id,v_day.id,v_req.member_id,
        'member_correction',v_req.id,d.breakfast,d.lunch,d.dinner,'approved',
        'Approved after cutoff; waiting for the daily 9 PM finalization.',v_actor,now()
      );
      v_pending:=v_pending+1;
    END IF;
  END LOOP;

  UPDATE public.meal_requests
  SET status='approved'::request_status,
      reviewed_by=v_actor,
      reviewed_at=now(),
      updated_at=now()
  WHERE id=p_request_id;

  INSERT INTO public.notifications(
    hostel_id,notification_type,title,body,reference_type,reference_id,created_by,target_membership_id
  ) VALUES(
    v_hostel,'system','মিল সংশোধন অনুমোদিত',
    CASE WHEN v_immediate>0 AND v_pending=0
      THEN 'আপনার সংশোধন অনুমোদিত হয়েছে এবং ইতিমধ্যে final হিসাবেও যুক্ত হয়েছে।'
      ELSE 'আপনার সংশোধন অনুমোদিত হয়েছে। প্রযোজ্য দিনের ৯টার finalization-এ মূল হিসাবের সঙ্গে যুক্ত হবে।'
    END,
    'meal_request',v_req.id,v_actor,v_req.member_id
  );

  RETURN jsonb_build_object(
    'request_id',p_request_id,
    'status','approved',
    'immediate_final_count',v_immediate,
    'pending_finalization_count',v_pending,
    'finalization_rule','daily 9 PM publication point'
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_meal_correction_request(date,date,jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_review_correction(uuid,boolean,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_meal_correction_request(date,date,jsonb,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.manager_review_correction(uuid,boolean,text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 7) Manager can edit an already-approved normal member request. Dates stay
--    unchanged to avoid accidental range/overlap rewrites. Meal values are the
--    only mutable part. Before 9 PM they remain pending for finalization;
--    after 9 PM they update final records immediately.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manager_edit_approved_meal_request(
  p_request_id uuid,
  p_days jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_req public.meal_requests;
  v_actor uuid;
  v_hostel uuid;
  v_period public.monthly_periods;
  v_day public.daily_meal_days;
  d record;
  v_expected integer := 0;
  v_count integer := 0;
  v_final integer := 0;
  v_pending integer := 0;
  v_existing public.daily_meal_records;
BEGIN
  PERFORM private.assert_authenticated();
  v_actor:=private.current_membership_id(true);
  v_hostel:=private.current_hostel_id(true);

  SELECT * INTO v_req
  FROM public.meal_requests
  WHERE id=p_request_id
    AND hostel_id=v_hostel
    AND request_type='normal'::meal_request_type
    AND status='approved'::request_status
  FOR UPDATE;

  IF v_req.id IS NULL THEN
    RAISE EXCEPTION USING message='এই অনুমোদিত মিল রিকোয়েস্টটি পাওয়া যায়নি।';
  END IF;

  IF v_req.origin='manager_self' THEN
    RAISE EXCEPTION USING message='ম্যানেজারের নিজের মিলের জন্য “আমার মিল” বা Emergency Override ব্যবহার করুন।';
  END IF;

  IF NOT private.can_manage_period(v_req.period_id) THEN
    RAISE EXCEPTION USING message='এই রিকোয়েস্ট এডিট করার অনুমতি নেই।';
  END IF;

  SELECT * INTO v_period FROM public.monthly_periods WHERE id=v_req.period_id;

  SELECT count(*)::int INTO v_count
  FROM jsonb_to_recordset(p_days) AS x(meal_date date,breakfast numeric,lunch numeric,dinner numeric);
  v_expected:=v_req.end_date-v_req.start_date+1;

  IF coalesce(v_count,0)<>v_expected THEN
    RAISE EXCEPTION USING message='রিকোয়েস্টের সব দিনের মিল তথ্য একসাথে দিতে হবে।';
  END IF;

  IF EXISTS(
    SELECT 1
    FROM (
      SELECT meal_date, count(*) c
      FROM jsonb_to_recordset(p_days) AS x(meal_date date,breakfast numeric,lunch numeric,dinner numeric)
      GROUP BY meal_date
    ) z
    WHERE z.c>1
  ) THEN
    RAISE EXCEPTION USING message='একই তারিখ একবারের বেশি দেওয়া যাবে না।';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('manager-request-edit:'||v_req.member_id::text||':'||v_req.period_id::text,0));

  IF EXISTS(
    SELECT 1
    FROM jsonb_to_recordset(p_days) AS x(meal_date date,breakfast numeric,lunch numeric,dinner numeric)
    WHERE x.meal_date<v_req.start_date OR x.meal_date>v_req.end_date
  ) THEN
    RAISE EXCEPTION USING message='রিকোয়েস্টের নির্ধারিত তারিখের বাইরে কোনো দিন এডিট করা যাবে না।';
  END IF;

  FOR d IN SELECT * FROM jsonb_to_recordset(p_days) AS x(meal_date date,breakfast numeric,lunch numeric,dinner numeric) LOOP
    SELECT * INTO v_day
    FROM public.daily_meal_days
    WHERE hostel_id=v_hostel AND period_id=v_req.period_id AND meal_date=d.meal_date
    FOR UPDATE;

    IF v_day.id IS NULL THEN
      RAISE EXCEPTION USING message='নির্বাচিত দিনের meal day পাওয়া যায়নি।';
    END IF;

    IF d.breakfast IS NULL OR d.lunch IS NULL OR d.dinner IS NULL
       OR d.breakfast<0 OR d.lunch<0 OR d.dinner<0
       OR d.breakfast>50 OR d.lunch>50 OR d.dinner>50 THEN
      RAISE EXCEPTION USING message='মিলের পরিমাণ সঠিক নয়।';
    END IF;

    -- Any previously-approved late override is superseded by this explicit
    -- manager edit. Keep the audit row as void rather than deleting it.
    UPDATE public.meal_late_overrides
    SET status='void',
        reason=coalesce(reason,'')||CASE WHEN coalesce(reason,'')='' THEN '' ELSE ' | ' END||'Superseded by manager request edit.',
        updated_at=now()
    WHERE daily_meal_day_id=v_day.id
      AND member_id=v_req.member_id
      AND status='approved';

    SELECT * INTO v_existing
    FROM public.daily_meal_records
    WHERE daily_meal_day_id=v_day.id AND member_id=v_req.member_id
    FOR UPDATE;

    IF now()>=v_day.finalizes_at OR v_day.status='finalized'::meal_day_status THEN
      UPDATE public.daily_meal_records
      SET planned_breakfast=d.breakfast,
          planned_lunch=d.lunch,
          planned_dinner=d.dinner,
          actual_breakfast=d.breakfast,
          actual_lunch=d.lunch,
          actual_dinner=d.dinner,
          final_breakfast=d.breakfast,
          final_lunch=d.lunch,
          final_dinner=d.dinner,
          cancelled=false,
          finalization_source='manager_edit',
          entered_by=v_actor,
          entered_at=now(),
          finalized_by=v_actor,
          finalized_at=now(),
          updated_at=now()
      WHERE id=v_existing.id;

      IF NOT FOUND THEN
        INSERT INTO public.daily_meal_records(
          hostel_id,period_id,daily_meal_day_id,member_id,
          planned_breakfast,planned_lunch,planned_dinner,
          actual_breakfast,actual_lunch,actual_dinner,
          final_breakfast,final_lunch,final_dinner,
          cancelled,finalization_source,entered_by,entered_at,finalized_by,finalized_at
        ) VALUES(
          v_hostel,v_req.period_id,v_day.id,v_req.member_id,
          d.breakfast,d.lunch,d.dinner,
          d.breakfast,d.lunch,d.dinner,
          d.breakfast,d.lunch,d.dinner,
          false,'manager_edit',v_actor,now(),v_actor,now()
        );
      END IF;

      UPDATE public.daily_meal_days
      SET status='finalized'::meal_day_status,
          finalized_at=coalesce(finalized_at,now()),
          updated_at=now()
      WHERE id=v_day.id AND status<>'finalized'::meal_day_status;

      PERFORM private.refresh_meal_snapshot(v_hostel,d.meal_date);
      v_final:=v_final+1;
    ELSE
      IF v_existing.id IS NULL THEN
        INSERT INTO public.daily_meal_records(
          hostel_id,period_id,daily_meal_day_id,member_id,
          planned_breakfast,planned_lunch,planned_dinner,
          cancelled,entered_by,entered_at
        ) VALUES(
          v_hostel,v_req.period_id,v_day.id,v_req.member_id,
          d.breakfast,d.lunch,d.dinner,false,v_actor,now()
        );
      ELSE
        UPDATE public.daily_meal_records
        SET planned_breakfast=d.breakfast,
            planned_lunch=d.lunch,
            planned_dinner=d.dinner,
            cancelled=false,
            entered_by=v_actor,
            entered_at=now(),
            updated_at=now()
        WHERE id=v_existing.id;
      END IF;
      PERFORM private.refresh_meal_snapshot(v_hostel,d.meal_date);
      v_pending:=v_pending+1;
    END IF;
  END LOOP;

  -- Preserve request history while making the latest day rows authoritative.
  UPDATE public.meal_request_days
  SET is_current=false,updated_at=now()
  WHERE request_id=v_req.id AND is_current=true;

  FOR d IN SELECT * FROM jsonb_to_recordset(p_days) AS x(meal_date date,breakfast numeric,lunch numeric,dinner numeric) LOOP
    INSERT INTO public.meal_request_days(request_id,meal_date,breakfast,lunch,dinner,is_current)
    VALUES(v_req.id,d.meal_date,d.breakfast,d.lunch,d.dinner,true);
  END LOOP;

  UPDATE public.meal_requests
  SET updated_at=now()
  WHERE id=v_req.id;

  INSERT INTO public.notifications(
    hostel_id,notification_type,title,body,reference_type,reference_id,created_by,target_membership_id
  ) VALUES(
    v_hostel,'system','আপনার মিল রিকোয়েস্ট ম্যানেজার পরিবর্তন করেছেন',
    CASE WHEN v_final>0 AND v_pending=0
      THEN 'ম্যানেজার আপনার মিল পরিবর্তন করে final হিসাবেও যুক্ত করেছেন।'
      ELSE 'ম্যানেজার আপনার মিল রিকোয়েস্ট পরিবর্তন করেছেন। প্রযোজ্য দিনের ৯টার finalization-এ এটি final হবে।'
    END,
    'meal_request',v_req.id,v_actor,v_req.member_id
  );

  RETURN jsonb_build_object(
    'request_id',v_req.id,
    'updated',true,
    'finalized_immediately',v_final,
    'pending_finalization',v_pending
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.manager_edit_approved_meal_request(uuid,jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.manager_edit_approved_meal_request(uuid,jsonb) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 8) Realtime publication for silent, event-driven dashboard/request refresh.
--    If the publication exists (normal Supabase setup), add only the relevant
--    tables when they are not already published.
-- ---------------------------------------------------------------------------
DO $function$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='meal_late_overrides'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.meal_late_overrides';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='daily_meal_snapshots'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_meal_snapshots';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='meal_requests'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.meal_requests';
    END IF;
  END IF;
END;
$function$;

COMMIT;

-- Read-only post-migration checks.
SELECT 'PRE_SUPERADMIN_FUNCTIONAL_RECOVERY' AS check_name, 'committed' AS result
UNION ALL
SELECT 'RUNNING_PERIODS', count(*)::text
FROM public.monthly_periods WHERE status='running'::month_status
UNION ALL
SELECT 'HISTORICAL_NORMAL_OVERLAP_PAIRS', count(*)::text
FROM public.meal_requests a
JOIN public.meal_requests b
  ON b.id>a.id
 AND b.period_id=a.period_id
 AND b.member_id=a.member_id
 AND a.request_type='normal'::meal_request_type
 AND b.request_type='normal'::meal_request_type
 AND a.status IN ('submitted'::request_status,'approved'::request_status)
 AND b.status IN ('submitted'::request_status,'approved'::request_status)
 AND a.start_date<=b.end_date
 AND b.start_date<=a.end_date
UNION ALL
SELECT 'MANAGER_EDIT_RPC', CASE WHEN to_regprocedure('public.manager_edit_approved_meal_request(uuid,jsonb)') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL
SELECT 'LATE_CARD_RPC', CASE WHEN to_regprocedure('public.get_late_request_card(date)') IS NOT NULL THEN 'present' ELSE 'missing' END
UNION ALL
SELECT 'REQUEST_REALTIME', CASE WHEN EXISTS(
  SELECT 1 FROM pg_publication_tables
  WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='meal_requests'
) THEN 'enabled' ELSE 'not-enabled' END;
