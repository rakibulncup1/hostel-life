-- HOSTEL LIFE / MODULE 2 — Archive Correction incremental migration
-- Requires Module 1 frontend and the precise diagnostic function definitions supplied on 2026-10-17.
-- IMPORTANT: Take a database backup. Run ONCE in Supabase SQL Editor. Do not rerun older migrations.
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='90s';
DO $hlc_guard$
DECLARE a text; b text;
BEGIN
 SELECT md5(pg_get_functiondef('public.change_manager(uuid)'::regprocedure)) INTO a;
 SELECT md5(pg_get_functiondef('public.get_dashboard_data()'::regprocedure)) INTO b;
 IF a NOT IN ('c94094c23610b404a9d6b92dc65c3d11') THEN
   RAISE EXCEPTION 'change_manager changed; actual %, expected c94094c23610b404a9d6b92dc65c3d11. STOP.',a;
 END IF;
 IF b NOT IN ('be07a8a4237e7909f153f2b7cdd9fb5f') THEN
   RAISE EXCEPTION 'get_dashboard_data changed; actual %, expected be07a8a4237e7909f153f2b7cdd9fb5f. STOP.',b;
 END IF;
 IF to_regprocedure('public.hlc_get_archive_correction_bundle(uuid)') IS NOT NULL OR to_regprocedure('public.hlc_apply_archive_correction(uuid,text,uuid,jsonb,text)') IS NOT NULL THEN
  RAISE EXCEPTION 'HLC correction RPC already exists; STOP to prevent overwrite'; END IF;
END $hlc_guard$;

CREATE OR REPLACE FUNCTION public.hlc_get_archive_correction_bundle(p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $hlc$
DECLARE v_period public.monthly_periods%rowtype; v_h uuid := private.my_hostel_id(); v_result jsonb;
BEGIN
 PERFORM private.assert_signed_in();
 SELECT * INTO v_period FROM public.monthly_periods WHERE id=p_period_id AND hostel_id=v_h AND status IN ('closed','archived');
 IF NOT FOUND THEN RAISE EXCEPTION 'অনুমোদিত বন্ধ মাস পাওয়া যায়নি' USING ERRCODE='42501'; END IF;
 IF NOT private.is_primary_manager(v_h,NULL) THEN RAISE EXCEPTION 'শুধু বর্তমান প্রধান ম্যানেজার' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
 'period',jsonb_build_object('id',v_period.id,'period_id',v_period.id,'status',v_period.status,'label',v_period.label,'start_date',v_period.start_date,'end_date',v_period.end_date),
 'final_meal',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'member_name',coalesce(p.full_name,r.member_name_snapshot,'সদস্য'),'meal_date',d.meal_date,'final_breakfast',coalesce(r.final_breakfast,0),'final_lunch',coalesce(r.final_lunch,0),'final_dinner',coalesce(r.final_dinner,0)) ORDER BY d.meal_date,p.full_name)
  FROM public.daily_meal_records r JOIN public.daily_meal_days d ON d.id=r.daily_meal_day_id LEFT JOIN public.hostel_memberships m ON m.id=r.member_id LEFT JOIN public.profiles p ON p.id=m.user_id
  WHERE r.period_id=v_period.id AND r.hostel_id=v_h AND d.period_id=v_period.id AND d.status='finalized' AND NOT r.cancelled),'[]'::jsonb),
 'market',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'entry_date',e.entry_date,'name',coalesce(e.buyer_name_snapshot,'বাজার'),'total_amount',e.total_amount,'item_count',(SELECT count(*) FROM public.market_entry_items i WHERE i.market_entry_id=e.id)) ORDER BY e.entry_date DESC)
  FROM public.market_entries e WHERE e.period_id=v_period.id AND e.hostel_id=v_h AND e.status='active'),'[]'::jsonb),
 'deposit',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'member_name',coalesce(p.full_name,l.member_name_snapshot,'সদস্য'),'entry_date',l.entry_date,'amount',l.amount) ORDER BY l.entry_date DESC)
  FROM public.ledger_transactions l LEFT JOIN public.hostel_memberships m ON m.id=l.member_id LEFT JOIN public.profiles p ON p.id=m.user_id WHERE l.period_id=v_period.id AND l.hostel_id=v_h AND l.status='active' AND l.ledger_type='deposit'),'[]'::jsonb),
 'other_expense',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'description',l.description,'entry_date',l.entry_date,'amount',abs(l.amount)) ORDER BY l.entry_date DESC)
  FROM public.ledger_transactions l WHERE l.period_id=v_period.id AND l.hostel_id=v_h AND l.status='active' AND l.ledger_type='other_expense'),'[]'::jsonb),
 'khala',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',k.id,'description',coalesce(k.description,k.member_name_snapshot,'খালার টাকা'),'payment_date',k.payment_date,'amount',k.amount) ORDER BY k.payment_date DESC)
  FROM public.khala_money_entries k WHERE k.period_id=v_period.id AND k.hostel_id=v_h AND k.status='active'),'[]'::jsonb),
 'audit',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'summary',a.summary,'action',a.action,'reason',a.details->>'reason','actor_name',coalesce(p.full_name,'ম্যানেজার'),'created_at',a.created_at) ORDER BY a.created_at DESC)
  FROM (SELECT * FROM public.archive_period_audit WHERE period_id=v_period.id AND hostel_id=v_h AND action LIKE 'hlc:%' ORDER BY created_at DESC LIMIT 100) a LEFT JOIN public.profiles p ON p.id=a.actor_user_id),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $hlc$;

CREATE OR REPLACE FUNCTION public.hlc_apply_archive_correction(p_period_id uuid,p_kind text,p_target_id uuid,p_changes jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $hlc$
DECLARE v_h uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype; v_old jsonb; v_new jsonb;
 v_amount numeric; v_b numeric; v_l numeric; v_d numeric; v_old_amount numeric; v_item_count integer;
 v_entry public.market_entries%rowtype; v_led public.ledger_transactions%rowtype; v_k public.khala_money_entries%rowtype; v_r public.daily_meal_records%rowtype;
 v_reason text:=btrim(coalesce(p_reason,'')); v_title text; v_member record;
BEGIN
 PERFORM private.assert_signed_in();
 IF NOT private.is_primary_manager(v_h,NULL) THEN RAISE EXCEPTION 'শুধু বর্তমান প্রধান ম্যানেজার' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_period FROM public.monthly_periods WHERE id=p_period_id AND hostel_id=v_h AND status IN ('closed','archived') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'অনুমোদিত বন্ধ মাস পাওয়া যায়নি' USING ERRCODE='42501'; END IF;
 IF length(v_reason) NOT BETWEEN 8 AND 500 OR p_target_id IS NULL OR p_kind NOT IN ('final_meal','market','deposit','other_expense','khala')
   OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'সংশোধনের কারণ বা তথ্য সঠিক নয়' USING ERRCODE='22023'; END IF;
 IF p_kind='final_meal' THEN
   IF (SELECT count(*) FROM jsonb_object_keys(p_changes))<>3 OR NOT (p_changes ?& array['final_breakfast','final_lunch','final_dinner']) THEN RAISE EXCEPTION 'শুধু তিনটি final meal field পরিবর্তন করা যাবে' USING ERRCODE='22023'; END IF;
   v_b:=(p_changes->>'final_breakfast')::numeric; v_l:=(p_changes->>'final_lunch')::numeric; v_d:=(p_changes->>'final_dinner')::numeric;
   IF v_b IS NULL OR v_l IS NULL OR v_d IS NULL OR v_b<0 OR v_l<0 OR v_d<0 OR v_b>50 OR v_l>50 OR v_d>50 OR v_b::text='NaN' OR v_l::text='NaN' OR v_d::text='NaN'
    OR v_b<>round(v_b,2) OR v_l<>round(v_l,2) OR v_d<>round(v_d,2) THEN RAISE EXCEPTION 'ফাইনাল মিল ০–৫০ এর মধ্যে, দুই দশমিক ঘর পর্যন্ত দিন' USING ERRCODE='22023'; END IF;
   SELECT r.* INTO v_r FROM public.daily_meal_records r JOIN public.daily_meal_days d ON d.id=r.daily_meal_day_id
    WHERE r.id=p_target_id AND r.period_id=p_period_id AND r.hostel_id=v_h AND NOT r.cancelled AND d.period_id=p_period_id AND d.status='finalized' FOR UPDATE OF r;
   IF NOT FOUND THEN RAISE EXCEPTION 'সংশোধনযোগ্য final meal নেই' USING ERRCODE='P0002'; END IF;
   v_old:=jsonb_build_object('final_breakfast',v_r.final_breakfast,'final_lunch',v_r.final_lunch,'final_dinner',v_r.final_dinner);
   IF v_r.final_breakfast IS NOT DISTINCT FROM v_b AND v_r.final_lunch IS NOT DISTINCT FROM v_l AND v_r.final_dinner IS NOT DISTINCT FROM v_d THEN RETURN jsonb_build_object('status','success','unchanged',true); END IF;
   UPDATE public.daily_meal_records SET final_breakfast=v_b,final_lunch=v_l,final_dinner=v_d,finalization_source='archive_correction',finalized_by=auth.uid(),finalized_at=now(),updated_by=auth.uid(),updated_at=now() WHERE id=p_target_id;
   v_new:=jsonb_build_object('final_breakfast',v_b,'final_lunch',v_l,'final_dinner',v_d);
 ELSIF p_kind='market' THEN
   IF (SELECT count(*) FROM jsonb_object_keys(p_changes))<>1 OR NOT(p_changes ? 'total_amount') THEN RAISE EXCEPTION 'শুধু total_amount পরিবর্তন করা যাবে' USING ERRCODE='22023'; END IF;
   v_amount:=(p_changes->>'total_amount')::numeric;
   SELECT * INTO v_entry FROM public.market_entries WHERE id=p_target_id AND period_id=p_period_id AND hostel_id=v_h AND status='active' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'বাজার এন্ট্রি নেই' USING ERRCODE='P0002'; END IF;
   SELECT count(*) INTO v_item_count FROM public.market_entry_items WHERE market_entry_id=p_target_id;
   IF v_item_count<>1 THEN RAISE EXCEPTION 'একাধিক/শূন্য বাজার আইটেম: শুধু টোটাল সংশোধন নিরাপদ নয়; আইটেমভিত্তিক সংশোধন দরকার' USING ERRCODE='55000'; END IF;
   v_old:=jsonb_build_object('total_amount',v_entry.total_amount);
   IF v_amount IS NULL OR v_amount<0 OR v_amount>100000000 OR v_amount::text='NaN' OR v_amount<>round(v_amount,2) THEN RAISE EXCEPTION 'টাকার পরিমাণ সঠিক নয়' USING ERRCODE='22023'; END IF;
   IF v_entry.total_amount = v_amount THEN RETURN jsonb_build_object('status','success','unchanged',true); END IF;
   UPDATE public.market_entry_items SET amount=v_amount WHERE market_entry_id=p_target_id;
   UPDATE public.market_entries SET total_amount=v_amount,updated_by=auth.uid(),updated_at=now() WHERE id=p_target_id;
   -- Existing canonical function synchronizes any buyer's credited market deposit.
   PERFORM private.sync_market_credit(p_target_id);
   v_new:=jsonb_build_object('total_amount',v_amount);
 ELSIF p_kind IN ('deposit','other_expense') THEN
   IF (SELECT count(*) FROM jsonb_object_keys(p_changes))<>1 OR NOT(p_changes ? 'amount') THEN RAISE EXCEPTION 'শুধু amount পরিবর্তন করা যাবে' USING ERRCODE='22023'; END IF;
   v_amount:=(p_changes->>'amount')::numeric;
   SELECT * INTO v_led FROM public.ledger_transactions WHERE id=p_target_id AND period_id=p_period_id AND hostel_id=v_h AND status='active'
    AND ledger_type=CASE WHEN p_kind='deposit' THEN 'deposit' ELSE 'other_expense' END FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'সংশোধনযোগ্য লেনদেন নেই' USING ERRCODE='P0002'; END IF;
   IF v_led.reference_type IS NOT NULL OR v_led.reference_id IS NOT NULL THEN RAISE EXCEPTION 'লিঙ্ক করা লেনদেন সরাসরি পরিবর্তন করা যাবে না' USING ERRCODE='55000'; END IF;
   v_old:=jsonb_build_object('amount',abs(v_led.amount));
   IF v_amount IS NULL OR v_amount>100000000 OR v_amount::text='NaN' OR v_amount<>round(v_amount,2) OR (p_kind='deposit' AND v_amount<=0) OR (p_kind='other_expense' AND v_amount<0) THEN RAISE EXCEPTION 'টাকার পরিমাণ সঠিক নয়' USING ERRCODE='22023'; END IF;
   IF abs(v_led.amount) = v_amount THEN RETURN jsonb_build_object('status','success','unchanged',true); END IF;
   UPDATE public.ledger_transactions SET amount=CASE WHEN p_kind='other_expense' THEN -v_amount ELSE v_amount END,updated_by=auth.uid(),updated_at=now(),adjustment_reason=v_reason WHERE id=p_target_id;
   v_new:=jsonb_build_object('amount',v_amount);
 ELSE
   IF (SELECT count(*) FROM jsonb_object_keys(p_changes))<>1 OR NOT(p_changes ? 'amount') THEN RAISE EXCEPTION 'শুধু amount পরিবর্তন করা যাবে' USING ERRCODE='22023'; END IF;
   v_amount:=(p_changes->>'amount')::numeric;
   SELECT * INTO v_k FROM public.khala_money_entries WHERE id=p_target_id AND period_id=p_period_id AND hostel_id=v_h AND status='active' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'খালার টাকার এন্ট্রি নেই' USING ERRCODE='P0002'; END IF;
   v_old:=jsonb_build_object('amount',v_k.amount);
   IF v_amount IS NULL OR v_amount<=0 OR v_amount>100000000 OR v_amount::text='NaN' OR v_amount<>round(v_amount,2) THEN RAISE EXCEPTION 'টাকার পরিমাণ সঠিক নয়' USING ERRCODE='22023'; END IF;
   IF v_k.amount = v_amount THEN RETURN jsonb_build_object('status','success','unchanged',true); END IF;
   UPDATE public.khala_money_entries SET amount=v_amount,updated_at=now() WHERE id=p_target_id;
   v_new:=jsonb_build_object('amount',v_amount);
 END IF;
 IF v_old IS NOT DISTINCT FROM v_new THEN RETURN jsonb_build_object('status','success','unchanged',true); END IF;
 INSERT INTO public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
 VALUES(v_h,p_period_id,auth.uid(),'hlc:'||p_kind,'বন্ধ মাসের হিসাব সংশোধন',jsonb_build_object('target_id',p_target_id,'reason',v_reason,'old',v_old,'new',v_new));
 FOR v_member IN SELECT user_id FROM public.hostel_memberships WHERE hostel_id=v_h AND status='active' LOOP
   INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by)
   VALUES(v_h,v_member.user_id,'পুরোনো মাসের হিসাব সংশোধন',v_period.label||' মাসের একটি হিসাব বর্তমান ম্যানেজার সংশোধন করেছেন। কারণ: '||left(v_reason,180),auth.uid());
 END LOOP;
 RETURN jsonb_build_object('status','success','period_id',p_period_id,'kind',p_kind,'target_id',p_target_id);
END $hlc$;

CREATE OR REPLACE FUNCTION public.change_manager(p_new_membership_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $hlc$
DECLARE v_hostel uuid := private.my_hostel_id(); v_period public.monthly_periods%rowtype;
 v_new public.hostel_memberships%rowtype; v_old uuid; v_actor uuid := private.my_membership_id();
BEGIN
 PERFORM private.assert_signed_in();
 IF v_hostel IS NULL OR v_actor IS NULL OR NOT private.is_primary_manager(v_hostel,NULL) THEN
  RAISE EXCEPTION 'শুধু বর্তমান প্রধান ম্যানেজার দায়িত্ব হস্তান্তর করতে পারেন' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_new FROM public.hostel_memberships WHERE id=p_new_membership_id AND hostel_id=v_hostel AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'নতুন ম্যানেজার একই মেসের সক্রিয় সদস্য নন' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_period FROM public.monthly_periods WHERE hostel_id=v_hostel AND status='running' FOR UPDATE;
 IF FOUND THEN
   IF v_period.primary_manager_membership_id IS DISTINCT FROM v_actor AND NOT private.is_super_admin() THEN
     RAISE EXCEPTION 'চলমান মাসের প্রধান ম্যানেজার হিসেবে অনুমতি নেই' USING ERRCODE='42501'; END IF;
   v_old:=v_period.primary_manager_membership_id;
   UPDATE public.monthly_periods SET primary_manager_membership_id=v_new.id,updated_at=now() WHERE id=v_period.id;
   DELETE FROM public.period_assistant_managers WHERE period_id=v_period.id AND membership_id=v_new.id;
 ELSE
   v_old:=v_actor;
 END IF;
 IF v_new.id = v_old THEN RETURN jsonb_build_object('status','success','primary_manager_membership_id',v_new.id,'unchanged',true); END IF;
 UPDATE public.hostel_memberships SET role='member',updated_at=now() WHERE hostel_id=v_hostel AND role='manager' AND id <> v_new.id;
 UPDATE public.hostel_memberships SET role='manager',updated_at=now() WHERE id=v_new.id;
 IF v_period.id IS NOT NULL THEN
  INSERT INTO public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
  VALUES(v_hostel,v_period.id,auth.uid(),'update:primary_manager','প্রধান ম্যানেজার পরিবর্তন করা হয়েছে',jsonb_build_object('previous_membership_id',v_old,'new_membership_id',v_new.id));
 END IF;
 RETURN jsonb_build_object('status','success','primary_manager_membership_id',v_new.id);
END $hlc$;
CREATE OR REPLACE FUNCTION public.get_dashboard_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hostel uuid; v_member uuid; v_period public.monthly_periods%rowtype;
  v_period_json jsonb; v_day public.daily_meal_days%rowtype; v_meal jsonb;
  v_members jsonb; v_own jsonb; v_member_details jsonb:='[]'::jsonb; v_late_requests jsonb:='[]'::jsonb;
  v_total_market numeric:=0; v_total_meals numeric:=0; v_total_deposit numeric:=0; v_other numeric:=0; v_khala numeric:=0; v_total_expense numeric:=0;
  v_now timestamptz:=clock_timestamp(); v_local timestamp; v_today date; v_target_date date;
begin
  perform private.assert_signed_in();
  v_hostel:=private.my_hostel_id(); v_member:=private.my_membership_id();
  if v_hostel is null then
    return jsonb_build_object('has_running_period',false,'period',null,'members','[]'::jsonb,'meal_card',null);
  end if;
  select * into v_period from public.monthly_periods
  where hostel_id=v_hostel and status='running' order by start_date desc limit 1;
  if not found then
    return jsonb_build_object('has_running_period',false,'period',null,'members',public.get_member_directory_v4(),'meal_card',null);
  end if;

  perform private.ensure_period_days(v_period.id);
  perform private.finalize_due_days(v_hostel,v_period.id);
  v_local := v_now at time zone 'Asia/Dhaka';
  v_today := v_local::date;
  v_target_date := v_today;
  if v_local::time >= time '22:00' and v_today+1 between v_period.start_date and v_period.end_date then
    v_target_date := v_today+1;
  end if;
  v_period_json:=jsonb_build_object('id',v_period.id,'period_id',v_period.id,'hostel_id',v_period.hostel_id,
    'label',v_period.label,'start_date',v_period.start_date,'end_date',v_period.end_date,'status',v_period.status,
    'primary_manager_membership_id',v_period.primary_manager_membership_id);

  select * into v_day from public.daily_meal_days
  where period_id=v_period.id and meal_date=v_target_date;

  if found then
    select coalesce(jsonb_agg(jsonb_build_object(
      'membership_id',m.id,'member_id',m.id,'member_name',coalesce(p.full_name,r.member_name_snapshot,'সদস্য'),
      'name',coalesce(p.full_name,r.member_name_snapshot,'সদস্য'),'membership_status',m.status,
      'breakfast',case when r.cancelled then 0 when v_day.status='finalized' then coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0)
        when r.finalization_source='emergency_override' then coalesce(r.actual_breakfast,r.planned_breakfast,0) else coalesce(r.planned_breakfast,0) end,
      'lunch',case when r.cancelled then 0 when v_day.status='finalized' then coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0)
        when r.finalization_source='emergency_override' then coalesce(r.actual_lunch,r.planned_lunch,0) else coalesce(r.planned_lunch,0) end,
      'dinner',case when r.cancelled then 0 when v_day.status='finalized' then coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0)
        when r.finalization_source='emergency_override' then coalesce(r.actual_dinner,r.planned_dinner,0) else coalesce(r.planned_dinner,0) end,
      'planned_breakfast',coalesce(r.planned_breakfast,0),'planned_lunch',coalesce(r.planned_lunch,0),'planned_dinner',coalesce(r.planned_dinner,0),
      'final_breakfast',r.final_breakfast,'final_lunch',r.final_lunch,'final_dinner',r.final_dinner,
      'total_meals',case when r.cancelled then 0 else
        (case when v_day.status='finalized' then coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0) else coalesce(r.planned_breakfast,0) end)
        +(case when v_day.status='finalized' then coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0) else coalesce(r.planned_lunch,0) end)
        +(case when v_day.status='finalized' then coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0) else coalesce(r.planned_dinner,0) end) end,
      'finalized',v_day.status='finalized'
    ) order by p.full_name),'[]'::jsonb)
    into v_member_details
    from public.hostel_memberships m
    left join public.profiles p on p.id=m.user_id
    left join public.daily_meal_records r on r.daily_meal_day_id=v_day.id and r.member_id=m.id
    where m.hostel_id=v_hostel
      and r.id is not null
      and not r.cancelled;

    select coalesce(jsonb_agg(jsonb_build_object(
      'request_id',q.id,'override_id',q.id,'membership_id',q.membership_id,'member_id',q.membership_id,
      'name',coalesce(p.full_name,q.member_name_snapshot,'সদস্য'),
      'member_name',coalesce(p.full_name,q.member_name_snapshot,'সদস্য'),
      'meal_date',v_target_date,'target_meal_date',v_target_date,
      'breakfast',coalesce((q.meal_day->>'breakfast')::numeric,0),
      'lunch',coalesce((q.meal_day->>'lunch')::numeric,0),
      'dinner',coalesce((q.meal_day->>'dinner')::numeric,0),
      'reason',coalesce(q.reason,q.review_reason),
      'source',case when q.request_type='correction' then 'member_correction' else 'member_late' end,
      'approved_at',q.reviewed_at,'visible_until',v_day.finalizes_at
    ) order by q.reviewed_at,q.submitted_at),'[]'::jsonb)
    into v_late_requests
    from (
      select r.id,r.membership_id,r.member_name_snapshot,r.request_type,r.is_late_request,r.reason,r.review_reason,r.reviewed_at,r.submitted_at,
        item.value as meal_day
      from public.meal_requests r
      cross join lateral jsonb_array_elements(r.days) item(value)
      where r.hostel_id=v_hostel and r.period_id=v_period.id and r.status='approved'
        and (r.is_late_request or r.request_type='correction')
        and (item.value->>'meal_date')::date=v_target_date
    ) q
    left join public.hostel_memberships m on m.id=q.membership_id
    left join public.profiles p on p.id=m.user_id
    where v_day.status in ('open','locked') and v_day.finalizes_at>v_now;

    select jsonb_build_object(
      'meal_date',v_day.meal_date,
      'label',case when v_target_date=v_today then 'আজকের মিল' else 'আগামীকালের মিল' end,
      'breakfast',coalesce(sum((member_row.value->>'breakfast')::numeric),0),
      'lunch',coalesce(sum((member_row.value->>'lunch')::numeric),0),
      'dinner',coalesce(sum((member_row.value->>'dinner')::numeric),0),
       'total',coalesce(sum(coalesce((member_row.value->>'breakfast')::numeric,0)+coalesce((member_row.value->>'lunch')::numeric,0)+coalesce((member_row.value->>'dinner')::numeric,0)),0),
      'status',v_day.status,
      'server_snapshot_at',v_now,
      'member_details',v_member_details,
      'late_requests',v_late_requests
    ) into v_meal from jsonb_array_elements(v_member_details) member_row(value);
  else
    v_meal := null;
  end if;

  v_members:=public.get_member_directory_v4();
  v_own:=private.member_financials(v_period.id,v_member);
  select coalesce(sum(total_amount),0) into v_total_market from public.market_entries where period_id=v_period.id and status='active';
  select coalesce(sum(coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0)+coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0)+coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0)),0)
    into v_total_meals from public.daily_meal_records r join public.daily_meal_days d on d.id=r.daily_meal_day_id
    where r.period_id=v_period.id and d.status='finalized' and not r.cancelled;
  select coalesce(sum(case when amount>0 and ledger_type in ('deposit','market_deposit') then amount else 0 end),0),
         coalesce(sum(case when ledger_type='other_expense' then abs(least(amount,0)) else 0 end),0)
   into v_total_deposit,v_other from public.ledger_transactions where period_id=v_period.id and status='active';

  select coalesce(sum(amount),0) into v_khala
  from public.khala_money_entries
  where period_id=v_period.id and hostel_id=v_hostel and status='active';
  v_total_expense := coalesce(v_total_market,0) + coalesce(v_other,0) + coalesce(v_khala,0);

  return jsonb_build_object(
    'has_running_period',true,'period_status','running','period',v_period_json,'meal_card',v_meal,
    'summary',jsonb_build_object('total_meals',v_total_meals,'total_market',v_total_market,
      'total_market_expense',v_total_market,
      'meal_rate',case when v_total_meals=0 then 0 else round(v_total_market/v_total_meals,4) end,
      'total_deposit',v_total_deposit,'other_expense',v_other,'total_other_expense',v_other,
      'khala_money',v_khala,'total_khala_money',v_khala,
      'total_expense',v_total_expense,'fund_remaining',v_total_deposit-v_total_expense),
    'my_account',jsonb_build_object('name',v_own->>'name','meals',(v_own->>'meals')::numeric,
      'deposit',(v_own->>'deposit')::numeric,'meal_cost',(v_own->>'meal_cost')::numeric,
      'other_expense',(v_own->>'other_expense')::numeric,'balance',(v_own->>'balance')::numeric),
    'members',v_members
  );
end $function$
;
REVOKE ALL ON FUNCTION public.hlc_get_archive_correction_bundle(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hlc_apply_archive_correction(uuid,text,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hlc_get_archive_correction_bundle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hlc_apply_archive_correction(uuid,text,uuid,jsonb,text) TO authenticated;
COMMIT;
