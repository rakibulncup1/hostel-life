-- Run46: quieter Activity Timeline, explicit rolling IP counters, and IP-only retention.
-- Additive and transactional. Business meal rows, IP security controls and audit history stay intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $preflight$
DECLARE v_missing text[];
BEGIN
  IF to_regclass('private.hl_activity_events') IS NULL
     OR to_regclass('private.hl_security_events') IS NULL
     OR to_regclass('private.hl_security_ip_blocks') IS NULL
     OR to_regclass('private.hl_password_reset_ip_attempts') IS NULL
     OR to_regclass('public.daily_meal_days') IS NULL
     OR to_regclass('public.daily_meal_records') IS NULL
     OR to_regclass('public.monthly_periods') IS NULL
     OR to_regclass('public.meal_requests') IS NULL
     OR to_regclass('public.archive_period_audit') IS NULL THEN
    RAISE EXCEPTION 'Run46 preflight failed: expected Hostel Life activity/security/meal tables are missing.' USING ERRCODE='55000';
  END IF;

  IF to_regprocedure('private.hl_capture_activity_event()') IS NULL
     OR to_regprocedure('private.finalize_due_days(uuid,uuid)') IS NULL
     OR to_regprocedure('private.apply_request_days(uuid)') IS NULL
     OR to_regprocedure('private.apply_request_days_for_finalized_day_ids(uuid,uuid[])') IS NULL
     OR to_regprocedure('public.close_current_month(boolean)') IS NULL
     OR to_regprocedure('public.platform_admin_list_security_events_v4(text,text,text,text,timestamptz,timestamptz,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'Run46 preflight failed: expected current activity/finalization/security functions are missing.' USING ERRCODE='55000';
  END IF;

  SELECT array_agg(format('%s.%s',x.table_name,x.column_name) ORDER BY x.table_name,x.column_name)
  INTO v_missing
  FROM (VALUES
    ('hl_security_events','country_code'),('hl_security_events','city'),('hl_security_events','region'),('hl_security_events','region_code'),
    ('hl_security_ip_blocks','country_code'),('hl_security_ip_blocks','city'),('hl_security_ip_blocks','region'),('hl_security_ip_blocks','region_code'),
    ('hl_password_reset_ip_attempts','country_code'),('hl_password_reset_ip_attempts','city'),('hl_password_reset_ip_attempts','region'),('hl_password_reset_ip_attempts','region_code')
  ) x(table_name,column_name)
  LEFT JOIN information_schema.columns c
    ON c.table_schema='private' AND c.table_name=x.table_name AND c.column_name=x.column_name
  WHERE c.column_name IS NULL;

  IF COALESCE(array_length(v_missing,1),0)>0 THEN
    RAISE EXCEPTION 'Run46 preflight failed: expected optional geo columns are missing: %',array_to_string(v_missing,', ')
      USING ERRCODE='55000';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION private.hl_capture_activity_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_new jsonb := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  v_row jsonb;
  v_hostel_id uuid;
  v_actor uuid := auth.uid();
  v_subject uuid;
  v_target_id text;
  v_event_type text;
  v_changed text[] := ARRAY[]::text[];
  v_membership_id uuid;
  v_details jsonb := '{}'::jsonb;
  v_profile_hostel_id uuid;
  v_linked_hostel boolean := false;
BEGIN
  -- Internal bulk operations can suppress row-by-row telemetry and write one summary event.
  IF COALESCE(pg_catalog.current_setting('hostel_life.suppress_activity_capture', true), '') = 'on' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- One row per calendar date is required application data, not a user action.
  -- Its INSERT is therefore intentionally excluded from the Activity Timeline.
  IF TG_TABLE_NAME='daily_meal_days' AND TG_OP='INSERT' THEN RETURN NEW; END IF;

  v_row := CASE WHEN TG_OP='DELETE' THEN v_old ELSE v_new END;

  -- Cascades (for example Super Delete of a hostel/period) already have a
  -- top-level administrative event. Skip nested row triggers so FK cleanup
  -- cannot create misleading history or hold a reference to a deleting hostel.
  IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;

  IF TG_OP='UPDATE' THEN
    SELECT COALESCE(array_agg(k ORDER BY k),'{}'::text[]) INTO v_changed
    FROM jsonb_object_keys(v_new) AS keys(k)
    WHERE v_old->k IS DISTINCT FROM v_new->k
      AND k NOT IN ('updated_at','last_seen_at');
    IF TG_TABLE_NAME='profiles' THEN
      SELECT COALESCE(array_agg(field_name ORDER BY field_name),'{}'::text[]) INTO v_changed
      FROM unnest(v_changed) AS changed(field_name)
      WHERE field_name IN ('full_name','phone','avatar_url','role');
    END IF;
    IF COALESCE(array_length(v_changed,1),0)=0 THEN RETURN NEW; END IF;
  END IF;

  IF TG_TABLE_NAME='profiles' THEN
    BEGIN v_subject := NULLIF(v_row->>'id','')::uuid; EXCEPTION WHEN OTHERS THEN v_subject:=NULL; END;
  ELSIF TG_TABLE_NAME='notifications' THEN
    BEGIN v_subject := NULLIF(v_row->>'recipient_user_id','')::uuid; EXCEPTION WHEN OTHERS THEN v_subject:=NULL; END;
  END IF;

  IF v_hostel_id IS NULL AND v_row ? 'hostel_id' THEN
    BEGIN v_hostel_id := NULLIF(v_row->>'hostel_id','')::uuid; EXCEPTION WHEN OTHERS THEN v_hostel_id:=NULL; END;
  END IF;

  IF TG_TABLE_NAME='market_entry_items' THEN
    SELECT me.hostel_id INTO v_hostel_id FROM public.market_entries me
    WHERE me.id=NULLIF(v_row->>'market_entry_id','')::uuid;
  END IF;

  IF v_actor IS NULL THEN
    BEGIN
      v_actor := COALESCE(
        NULLIF(v_row->>'created_by','')::uuid,
        NULLIF(v_row->>'updated_by','')::uuid,
        NULLIF(v_row->>'reviewed_by','')::uuid,
        NULLIF(v_row->>'granted_by','')::uuid,
        NULLIF(v_row->>'actor_user_id','')::uuid,
        NULLIF(v_row->>'assigned_by','')::uuid
      );
    EXCEPTION WHEN OTHERS THEN v_actor:=NULL; END;
  END IF;

  BEGIN
    v_membership_id := CASE TG_TABLE_NAME
      WHEN 'daily_meal_records' THEN NULLIF(v_row->>'member_id','')::uuid
      WHEN 'meal_requests' THEN NULLIF(v_row->>'membership_id','')::uuid
      WHEN 'market_entries' THEN NULLIF(v_row->>'buyer_membership_id','')::uuid
      WHEN 'ledger_transactions' THEN NULLIF(v_row->>'member_id','')::uuid
      WHEN 'khala_money_entries' THEN NULLIF(v_row->>'member_id','')::uuid
      WHEN 'hostel_memberships' THEN NULLIF(v_row->>'id','')::uuid
      WHEN 'period_assistant_managers' THEN NULLIF(v_row->>'membership_id','')::uuid
      WHEN 'archive_edit_permissions' THEN NULLIF(v_row->>'membership_id','')::uuid
      ELSE NULL
    END;
  EXCEPTION WHEN OTHERS THEN v_membership_id:=NULL; END;
  IF v_membership_id IS NOT NULL THEN
    SELECT m.user_id INTO v_subject FROM public.hostel_memberships m WHERE m.id=v_membership_id;
  END IF;
  IF TG_TABLE_NAME='hostel_memberships' THEN
    BEGIN v_subject := NULLIF(v_row->>'user_id','')::uuid; EXCEPTION WHEN OTHERS THEN v_subject:=NULL; END;
  END IF;
  IF TG_TABLE_NAME='market_entry_items' THEN
    v_subject := NULL;
  END IF;
  IF TG_TABLE_NAME='platform_audit_log' THEN
    v_subject := NULL;
    v_details := jsonb_build_object(
      'platform_action',v_row->>'action',
      'target_type',v_row->>'target_type',
      'target_id',v_row->>'target_id'
    );
    -- Link Super Admin actions to the affected hostel/member when possible.
    -- Never assign a deleted Auth user to the FK-backed subject column.
    IF v_row->>'target_type'='user' THEN
      BEGIN v_subject := NULLIF(v_row->>'target_id','')::uuid; EXCEPTION WHEN OTHERS THEN v_subject:=NULL; END;
      IF v_subject IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=v_subject) THEN v_subject:=NULL; END IF;
      IF v_subject IS NOT NULL THEN
        SELECT m.hostel_id INTO v_hostel_id FROM public.hostel_memberships m
        WHERE m.user_id=v_subject ORDER BY m.created_at DESC LIMIT 1;
      END IF;
    ELSIF v_row->>'target_type'='hostel' THEN
      BEGIN
        v_hostel_id := NULLIF(v_row->>'target_id','')::uuid;
        IF v_hostel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.hostels h WHERE h.id=v_hostel_id) THEN v_hostel_id:=NULL; END IF;
      EXCEPTION WHEN OTHERS THEN v_hostel_id:=NULL; END;
    ELSIF v_row->>'target_type'='member' THEN
      BEGIN v_hostel_id := NULLIF(v_row->'details'->>'hostel_id','')::uuid; EXCEPTION WHEN OTHERS THEN v_hostel_id:=NULL; END;
      BEGIN v_subject := NULLIF(v_row->'details'->>'user_id','')::uuid; EXCEPTION WHEN OTHERS THEN v_subject:=NULL; END;
      IF v_subject IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=v_subject) THEN v_subject:=NULL; END IF;
      IF v_hostel_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.hostels h WHERE h.id=v_hostel_id) THEN v_hostel_id:=NULL; END IF;
    ELSIF v_row->>'target_type'='monthly_periods' THEN
      BEGIN
        SELECT mp.hostel_id INTO v_hostel_id FROM public.monthly_periods mp
        WHERE mp.id=NULLIF(v_row->>'target_id','')::uuid;
      EXCEPTION WHEN OTHERS THEN v_hostel_id:=NULL; END;
    END IF;
  ELSE
    v_details := jsonb_build_object('changed_fields',to_jsonb(v_changed));
  END IF;


  v_target_id := CASE WHEN TG_TABLE_NAME='platform_audit_log' THEN v_row->>'target_id'
    ELSE COALESCE(v_row->>'id',v_row->>'period_id',v_row->>'daily_meal_day_id',v_row->>'market_entry_id') END;
  v_event_type := CASE TG_TABLE_NAME
    WHEN 'hostel_memberships' THEN 'membership.'||lower(TG_OP)
    WHEN 'monthly_periods' THEN 'period.'||lower(TG_OP)
    WHEN 'daily_meal_days' THEN 'meal_day.'||lower(TG_OP)
    WHEN 'daily_meal_records' THEN 'meal_record.'||lower(TG_OP)
    WHEN 'meal_requests' THEN 'meal_request.'||lower(TG_OP)
    WHEN 'market_entries' THEN 'market_entry.'||lower(TG_OP)
    WHEN 'market_entry_items' THEN 'market_item.'||lower(TG_OP)
    WHEN 'ledger_transactions' THEN 'ledger_entry.'||lower(TG_OP)
    WHEN 'khala_money_entries' THEN 'khala_payment.'||lower(TG_OP)
    WHEN 'period_assistant_managers' THEN 'assistant_manager.'||lower(TG_OP)
    WHEN 'archive_edit_permissions' THEN 'archive_permission.'||lower(TG_OP)
    WHEN 'notifications' THEN 'notification.sent'
    WHEN 'platform_audit_log' THEN 'platform.'||COALESCE(NULLIF(v_row->>'action',''),lower(TG_OP))
    ELSE lower(TG_TABLE_NAME)||'.'||lower(TG_OP)
  END;

  -- Profile edits (name/phone/avatar) affect the same account across all
  -- memberships. Record only changed field names, once per current hostel.
  IF TG_TABLE_NAME='profiles' THEN
    IF v_subject IS NOT NULL THEN
      FOR v_profile_hostel_id IN
        SELECT DISTINCT m.hostel_id FROM public.hostel_memberships m WHERE m.user_id=v_subject
      LOOP
        v_linked_hostel := true;
        INSERT INTO private.hl_activity_events(
          hostel_id,actor_user_id,subject_user_id,event_type,source_table,target_id,metadata
        ) VALUES(
          v_profile_hostel_id,v_actor,v_subject,v_event_type,TG_TABLE_NAME,v_target_id,v_details
        );
      END LOOP;
    END IF;
    IF NOT v_linked_hostel THEN
      INSERT INTO private.hl_activity_events(
        hostel_id,actor_user_id,subject_user_id,event_type,source_table,target_id,metadata
      ) VALUES(NULL,v_actor,v_subject,v_event_type,TG_TABLE_NAME,v_target_id,v_details);
    END IF;
    RETURN NEW;
  END IF;

  -- User-level platform actions (block/unblock/flag) apply to the account,
  -- so surface the same event in each hostel where that account is a member.
  IF TG_TABLE_NAME='platform_audit_log' AND v_row->>'target_type'='user' THEN
    IF v_subject IS NOT NULL THEN
      FOR v_profile_hostel_id IN
        SELECT DISTINCT m.hostel_id FROM public.hostel_memberships m WHERE m.user_id=v_subject
      LOOP
        v_linked_hostel := true;
        INSERT INTO private.hl_activity_events(
          hostel_id,actor_user_id,subject_user_id,event_type,source_table,target_id,metadata
        ) VALUES(
          v_profile_hostel_id,v_actor,v_subject,v_event_type,TG_TABLE_NAME,v_target_id,v_details
        );
      END LOOP;
    END IF;
    IF NOT v_linked_hostel THEN
      INSERT INTO private.hl_activity_events(
        hostel_id,actor_user_id,subject_user_id,event_type,source_table,target_id,metadata
      ) VALUES(NULL,v_actor,v_subject,v_event_type,TG_TABLE_NAME,v_target_id,v_details);
    END IF;
    RETURN NEW;
  END IF;

  -- Events without a known actor are still useful for system state transitions,
  -- but only allowlisted tables reach this trigger.
  INSERT INTO private.hl_activity_events(
    hostel_id,actor_user_id,subject_user_id,event_type,source_table,target_id,metadata
  ) VALUES(
    v_hostel_id,v_actor,v_subject,v_event_type,TG_TABLE_NAME,v_target_id,v_details
  );

  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;


CREATE OR REPLACE FUNCTION private.finalize_due_days(p_hostel_id uuid,p_period_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_days integer := 0;
  v_record_rows integer := 0;
  v_request_id uuid;
  v_due_day_ids uuid[] := array[]::uuid[];
  v_previous_capture_setting text := '';
begin
  if p_hostel_id is null then return 0; end if;

  -- Identify exact due rows; never use updated_at to infer which rows changed.
  select coalesce(array_agg(d.id), array[]::uuid[])
  into v_due_day_ids
  from public.daily_meal_days d
  join public.monthly_periods mp on mp.id=d.period_id
  where d.hostel_id=p_hostel_id and mp.status='running'
    and (p_period_id is null or mp.id=p_period_id)
    and d.status in ('open','locked')
    and d.finalizes_at is not null and d.finalizes_at<=v_now;

  if cardinality(v_due_day_ids)=0 then return 0; end if;

  -- This function performs one intentional system transition across many rows.
  -- Suppress row-level Activity Log noise, but keep all business row changes.
  v_previous_capture_setting := coalesce(pg_catalog.current_setting('hostel_life.suppress_activity_capture', true), '');
  perform pg_catalog.set_config('hostel_life.suppress_activity_capture', 'on', true);
  begin
    -- Freeze the normal snapshot before applying approved late/correction deltas.
    update public.daily_meal_records r
    set final_breakfast=coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0),
        final_lunch=coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0),
        final_dinner=coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0),
        finalization_source=coalesce(r.finalization_source,'auto_cutoff'),
        finalized_at=coalesce(r.finalized_at,v_now),
        updated_by=auth.uid(),updated_at=v_now
    where r.daily_meal_day_id=any(v_due_day_ids) and not r.cancelled;
    get diagnostics v_record_rows=row_count;

    update public.daily_meal_days d
    set status='finalized',finalized_at=coalesce(d.finalized_at,v_now),updated_at=v_now
    where d.id=any(v_due_day_ids) and d.status in ('open','locked');
    get diagnostics v_days=row_count;

    -- Approved special values are applied only after the normal snapshot is frozen.
    for v_request_id in
      select distinct r.id
      from public.meal_requests r
      cross join lateral jsonb_array_elements(r.days) item(value)
      join public.daily_meal_days d on d.period_id=r.period_id and d.meal_date=(item.value->>'meal_date')::date
      join public.monthly_periods mp on mp.id=r.period_id
      where r.hostel_id=p_hostel_id and mp.status='running'
        and (p_period_id is null or r.period_id=p_period_id)
        and r.status='approved' and (r.is_late_request or r.request_type='correction')
        and d.id=any(v_due_day_ids) and d.status='finalized'
      order by r.id
    loop
      perform private.apply_request_days(v_request_id);
    end loop;
  exception when others then
    perform pg_catalog.set_config('hostel_life.suppress_activity_capture', v_previous_capture_setting, true);
    raise;
  end;
  perform pg_catalog.set_config('hostel_life.suppress_activity_capture', v_previous_capture_setting, true);

  if v_days>0 then
    insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
    select p_hostel_id,mp.id,null,'auto_finalize',
      format('%s দিনের মিল cutoff অনুযায়ী স্বয়ংক্রিয়ভাবে চূড়ান্ত হয়েছে',count(*)::text),
      jsonb_build_object('finalized_day_count',count(*),'finalized_at',v_now,'source','auto_cutoff_with_approved_special_requests')
    from public.daily_meal_days d join public.monthly_periods mp on mp.id=d.period_id
    where d.id=any(v_due_day_ids) and d.status='finalized'
    group by mp.id;

    -- One compact system event replaces dozens of row-level timeline entries.
    IF v_previous_capture_setting <> 'on' THEN
      insert into private.hl_activity_events(
        hostel_id,actor_user_id,subject_user_id,event_type,source_table,target_id,metadata
      ) values(
        p_hostel_id,null,null,'meal_day.auto_finalized','daily_meal_days',
        coalesce(p_period_id::text,'automatic'),
        jsonb_build_object(
          'finalized_day_count',v_days,
          'finalized_meal_record_count',v_record_rows,
          'source','auto_cutoff'
        )
      );
    END IF;
  end if;
  return v_days;
end $$;

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
  v_previous_capture_setting text := '';
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

  -- Month close updates many meal rows as one business operation. Keep the
  -- meaningful request/period events, but suppress repetitive per-day/record rows.
  v_previous_capture_setting := coalesce(pg_catalog.current_setting('hostel_life.suppress_activity_capture', true), '');
  PERFORM pg_catalog.set_config('hostel_life.suppress_activity_capture', 'on', true);
  BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config('hostel_life.suppress_activity_capture', v_previous_capture_setting, true);
    RAISE;
  END;
  PERFORM pg_catalog.set_config('hostel_life.suppress_activity_capture', v_previous_capture_setting, true);
  v_finalized_days := v_auto_finalized_days + v_manual_finalized_days;

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

  INSERT INTO private.hl_activity_events(
    hostel_id,actor_user_id,subject_user_id,event_type,source_table,target_id,metadata
  ) VALUES(
    v_hostel,auth.uid(),NULL,'meal_day.period_closed','daily_meal_days',v_period.id::text,
    jsonb_build_object(
      'period_id',v_period.id,
      'cancelled_future_meal_day_count',v_cancelled_days,
      'cancelled_future_meal_record_count',v_cancelled_records,
      'finalized_day_count',v_finalized_days,
      'source','month_close'
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

-- Enforce the IP-only policy at the database boundary as well as in the Worker/Edge code.
-- Existing writer RPC signatures remain compatible, but any stale caller that still
-- supplies country/city/region values cannot persist them.
CREATE OR REPLACE FUNCTION private.hl_enforce_ip_only_security_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  NEW.country_code := NULL;
  NEW.city := NULL;
  NEW.region := NULL;
  NEW.region_code := NULL;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.hl_enforce_ip_only_security_metadata() FROM PUBLIC,anon,authenticated,service_role;

DO $ip_only_triggers$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['hl_security_events','hl_security_ip_blocks','hl_password_reset_ip_attempts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS hl_enforce_ip_only_geo ON private.%I',v_table);
    EXECUTE format(
      'CREATE TRIGGER hl_enforce_ip_only_geo BEFORE INSERT OR UPDATE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.hl_enforce_ip_only_security_metadata()',
      v_table
    );
  END LOOP;
END;
$ip_only_triggers$;

-- Remove previously retained approximate geo metadata from security telemetry.
-- IP addresses, event timestamps, fingerprints, failure codes, block scopes/reasons,
-- attempt counts and expiry data are deliberately preserved. Columns stay nullable
-- for backwards-compatible RPC/function signatures; no schema/authorization changes.
UPDATE private.hl_security_events
SET country_code=NULL,city=NULL,region=NULL,region_code=NULL
WHERE country_code IS NOT NULL OR city IS NOT NULL OR region IS NOT NULL OR region_code IS NOT NULL;

UPDATE private.hl_security_ip_blocks
SET country_code=NULL,city=NULL,region=NULL,region_code=NULL
WHERE country_code IS NOT NULL OR city IS NOT NULL OR region IS NOT NULL OR region_code IS NOT NULL;

UPDATE private.hl_password_reset_ip_attempts
SET country_code=NULL,city=NULL,region=NULL,region_code=NULL
WHERE country_code IS NOT NULL OR city IS NOT NULL OR region IS NOT NULL OR region_code IS NOT NULL;

-- Existing V3/V4 RPC already computes exact rolling 60-second and 15-minute
-- counts. Grant and function definitions are unchanged. This migration's UI
-- displays both counters unconditionally so a legitimate zero is visible.

NOTIFY pgrst,'reload schema';
COMMIT;

-- Next: run supabase/verify/Verify_Run46_activity_timeline_security_counts.sql
-- Diagnostic: supabase/diagnostics/Activity_Event_Repeat_Audit_READ_ONLY.sql
