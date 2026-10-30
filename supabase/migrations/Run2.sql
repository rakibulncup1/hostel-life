-- ============================================================================
-- HOSTEL LIFE — MEAL WORKFLOW / ACCOUNT HISTORY FIX MIGRATION
-- Run ONCE in Supabase SQL Editor on the existing project after the Master SQL.
-- Does not drop tables or remove member/financial history.
-- ============================================================================
begin;

-- 1) Correct the daily meal cutoff to 10:00 PM Dhaka on the previous date.
--    Finalization remains 9:00 PM Dhaka on the meal date.
update public.daily_meal_days d
set cutoff_at = (((d.meal_date - 1)::timestamp + time '22:00') at time zone 'Asia/Dhaka'),
    finalizes_at = ((d.meal_date::timestamp + time '21:00') at time zone 'Asia/Dhaka'),
    updated_at = now()
where d.cutoff_at is distinct from (((d.meal_date - 1)::timestamp + time '22:00') at time zone 'Asia/Dhaka')
   or d.finalizes_at is distinct from ((d.meal_date::timestamp + time '21:00') at time zone 'Asia/Dhaka');

create or replace function private.ensure_period_days(p_period_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_period public.monthly_periods%rowtype; v_day date;
begin
  select * into v_period from public.monthly_periods where id = p_period_id;
  if not found then raise exception using message='মাসের তথ্য পাওয়া যায়নি।', errcode='P0002'; end if;
  v_day := v_period.start_date;
  while v_day <= v_period.end_date loop
    insert into public.daily_meal_days as existing_day(hostel_id,period_id,meal_date,cutoff_at,finalizes_at)
    values (
      v_period.hostel_id, v_period.id, v_day,
      (((v_day - 1)::timestamp + time '22:00') at time zone 'Asia/Dhaka'),
      ((v_day::timestamp + time '21:00') at time zone 'Asia/Dhaka')
    )
    on conflict(period_id,meal_date) do update
      set cutoff_at = excluded.cutoff_at,
          finalizes_at = excluded.finalizes_at
      where existing_day.cutoff_at is distinct from excluded.cutoff_at
         or existing_day.finalizes_at is distinct from excluded.finalizes_at;
    v_day := v_day + 1;
  end loop;
end $$;

-- 2) Keep historical normal-meal baseline intact when older versions had already
--    applied an approved late/correction request directly to an unfinalized card.
--    This repair only touches rows whose updated_by and exact updated_at match
--    the reviewer/time of an approved special request. Emergency overrides are
--    explicitly excluded. It is intentionally narrow and is safe to re-run.
with repaired as (
  update public.daily_meal_records r
  set planned_breakfast = coalesce((
        select (normal_day.value->>'breakfast')::numeric
        from public.meal_requests normal_request
        cross join lateral jsonb_array_elements(normal_request.days) normal_day(value)
        where normal_request.period_id = r.period_id
          and normal_request.membership_id = r.member_id
          and normal_request.status in ('approved','submitted')
          and (normal_request.status='approved' or (normal_request.submitted_at < d.cutoff_at))
          and normal_request.request_type = 'normal'
          and not normal_request.is_late_request
          and (normal_day.value->>'meal_date')::date = d.meal_date
        order by normal_request.submitted_at desc limit 1
      ), 0),
      planned_lunch = coalesce((
        select (normal_day.value->>'lunch')::numeric
        from public.meal_requests normal_request
        cross join lateral jsonb_array_elements(normal_request.days) normal_day(value)
        where normal_request.period_id = r.period_id
          and normal_request.membership_id = r.member_id
          and normal_request.status in ('approved','submitted')
          and (normal_request.status='approved' or (normal_request.submitted_at < d.cutoff_at))
          and normal_request.request_type = 'normal'
          and not normal_request.is_late_request
          and (normal_day.value->>'meal_date')::date = d.meal_date
        order by normal_request.submitted_at desc limit 1
      ), 0),
      planned_dinner = coalesce((
        select (normal_day.value->>'dinner')::numeric
        from public.meal_requests normal_request
        cross join lateral jsonb_array_elements(normal_request.days) normal_day(value)
        where normal_request.period_id = r.period_id
          and normal_request.membership_id = r.member_id
          and normal_request.status in ('approved','submitted')
          and (normal_request.status='approved' or (normal_request.submitted_at < d.cutoff_at))
          and normal_request.request_type = 'normal'
          and not normal_request.is_late_request
          and (normal_day.value->>'meal_date')::date = d.meal_date
        order by normal_request.submitted_at desc limit 1
      ), 0),
      actual_breakfast = null, actual_lunch = null, actual_dinner = null,
      final_breakfast = null, final_lunch = null, final_dinner = null,
      finalization_source = null, finalized_by = null, finalized_at = null,
      updated_at = clock_timestamp()
  from public.daily_meal_days d
  where d.id = r.daily_meal_day_id
    and d.status in ('open','locked')
    and r.member_id is not null
    and r.finalization_source is distinct from 'emergency_override'
    and exists (
      select 1
      from public.meal_requests special_request
      cross join lateral jsonb_array_elements(special_request.days) special_day(value)
      where special_request.period_id = r.period_id
        and special_request.membership_id = r.member_id
        and special_request.status = 'approved'
        and (special_request.is_late_request or special_request.request_type = 'correction')
        and special_request.reviewed_by = r.updated_by
        and special_request.reviewed_at = r.updated_at
        and (special_day.value->>'meal_date')::date = d.meal_date
    )
  returning r.hostel_id, r.period_id
)
insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
select repaired.hostel_id, repaired.period_id, null, 'repair:special_request_snapshot',
       format('%sটি অচূড়ান্ত মিলের রেকর্ডে স্বাভাবিক মিলের baseline পুনরুদ্ধার হয়েছে', count(*)::text),
       jsonb_build_object('source','meal-workflow-fix-migration','record_count',count(*),'preserved_emergency_overrides',true)
from repaired group by repaired.hostel_id, repaired.period_id;

-- Request JSON exposes both legacy and current field names used by the Frontend.
create or replace function private.get_request_json(p_request public.meal_requests)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'request_id',(p_request).id,'id',(p_request).id,
    'membership_id',(p_request).membership_id,'member_id',(p_request).membership_id,
    'member_name',(p_request).member_name_snapshot,'request_type',(p_request).request_type,
    'origin',(p_request).origin,'is_late_request',(p_request).is_late_request,
    'status',(p_request).status,'start_date',(p_request).start_date,'end_date',(p_request).end_date,
    'days',(p_request).days,'reason',(p_request).reason,
    'review_reason',(p_request).review_reason,'rejection_reason',(p_request).review_reason,
    'manager_note',(p_request).manager_note,'manager_edited',(p_request).manager_edited,
    'manager_updated_at',(p_request).manager_updated_at,'submitted_at',(p_request).submitted_at,
    'reviewed_at',(p_request).reviewed_at,'parent_request_id',(p_request).parent_request_id,
    'period_id',(p_request).period_id
  )
$$;

-- 3) Approved special requests stay outside the main snapshot until the meal day
--    is finalized. For finalized days, the newest approved absolute meal values
--    are applied. The equality check prevents repeated finalization reads from
--    duplicating correction audit entries or needlessly rewriting the row.
create or replace function private.apply_request_days(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_req public.meal_requests%rowtype;
  v_item jsonb;
  v_date date;
  v_day public.daily_meal_days%rowtype;
  v_existing public.daily_meal_records%rowtype;
  v_found boolean;
  v_b numeric; v_l numeric; v_d numeric;
  v_special boolean;
begin
  select * into v_req from public.meal_requests where id=p_request_id;
  if not found then raise exception using message='মিল অনুরোধটি পাওয়া যায়নি।',errcode='P0002'; end if;
  v_special := (v_req.is_late_request or v_req.request_type='correction');
  for v_item in select value from jsonb_array_elements(v_req.days) loop
    v_date := (v_item->>'meal_date')::date;
    v_b := coalesce((v_item->>'breakfast')::numeric,0);
    v_l := coalesce((v_item->>'lunch')::numeric,0);
    v_d := coalesce((v_item->>'dinner')::numeric,0);
    select * into v_day from public.daily_meal_days where period_id=v_req.period_id and meal_date=v_date;
    if not found then continue; end if;

    if v_special and v_day.status <> 'finalized' then
      continue;
    end if;

    if v_special and v_day.status='finalized' then
      select * into v_existing from public.daily_meal_records
      where daily_meal_day_id=v_day.id and member_id=v_req.membership_id;
      v_found := found;
      if v_found and not v_existing.cancelled
        and coalesce(v_existing.planned_breakfast,0)=v_b
        and coalesce(v_existing.planned_lunch,0)=v_l
        and coalesce(v_existing.planned_dinner,0)=v_d
        and coalesce(v_existing.actual_breakfast,0)=v_b
        and coalesce(v_existing.actual_lunch,0)=v_l
        and coalesce(v_existing.actual_dinner,0)=v_d
        and coalesce(v_existing.final_breakfast,0)=v_b
        and coalesce(v_existing.final_lunch,0)=v_l
        and coalesce(v_existing.final_dinner,0)=v_d
        and v_existing.finalization_source='request_approval' then
        continue;
      end if;
    end if;

    insert into public.daily_meal_records(
      hostel_id,period_id,daily_meal_day_id,member_id,member_name_snapshot,
      planned_breakfast,planned_lunch,planned_dinner,
      actual_breakfast,actual_lunch,actual_dinner,
      final_breakfast,final_lunch,final_dinner,finalization_source,finalized_by,finalized_at,updated_by,cancelled
    ) values (
      v_req.hostel_id,v_req.period_id,v_day.id,v_req.membership_id,v_req.member_name_snapshot,
      v_b,v_l,v_d,
      case when v_day.status in ('locked','finalized') or v_req.is_late_request or v_req.request_type='correction' then v_b end,
      case when v_day.status in ('locked','finalized') or v_req.is_late_request or v_req.request_type='correction' then v_l end,
      case when v_day.status in ('locked','finalized') or v_req.is_late_request or v_req.request_type='correction' then v_d end,
      case when v_day.status='finalized' or v_req.request_type='correction' then v_b end,
      case when v_day.status='finalized' or v_req.request_type='correction' then v_l end,
      case when v_day.status='finalized' or v_req.request_type='correction' then v_d end,
      case when v_day.status='finalized' or v_req.request_type='correction' then 'request_approval' else null end,
      case when v_day.status='finalized' or v_req.request_type='correction' then auth.uid() else null end,
      case when v_day.status='finalized' or v_req.request_type='correction' then now() else null end,
      auth.uid(),false
    )
    on conflict(daily_meal_day_id,member_id) do update set
      planned_breakfast=excluded.planned_breakfast,
      planned_lunch=excluded.planned_lunch,
      planned_dinner=excluded.planned_dinner,
      actual_breakfast=coalesce(excluded.actual_breakfast,public.daily_meal_records.actual_breakfast),
      actual_lunch=coalesce(excluded.actual_lunch,public.daily_meal_records.actual_lunch),
      actual_dinner=coalesce(excluded.actual_dinner,public.daily_meal_records.actual_dinner),
      final_breakfast=coalesce(excluded.final_breakfast,public.daily_meal_records.final_breakfast),
      final_lunch=coalesce(excluded.final_lunch,public.daily_meal_records.final_lunch),
      final_dinner=coalesce(excluded.final_dinner,public.daily_meal_records.final_dinner),
      finalization_source=coalesce(excluded.finalization_source,public.daily_meal_records.finalization_source),
      finalized_by=coalesce(excluded.finalized_by,public.daily_meal_records.finalized_by),
      finalized_at=coalesce(excluded.finalized_at,public.daily_meal_records.finalized_at),
      updated_by=auth.uid(),cancelled=false,updated_at=now();

    if v_req.request_type='correction' and v_day.status='finalized' then
      insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
      values(v_req.hostel_id,v_req.period_id,auth.uid(),'update:meal_correction',
        'মিল সংশোধন অনুমোদন করা হয়েছে',
        jsonb_build_object('request_id',v_req.id,'meal_date',v_date,'membership_id',v_req.membership_id,'days',v_item));
    end if;
  end loop;
end $$;

-- Finalization first freezes the normal snapshot, then merges all approved
-- late/correction values for each newly finalized meal day.
create or replace function private.finalize_due_days(p_hostel_id uuid,p_period_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_days integer := 0;
  v_request_id uuid;
  v_due_day_ids uuid[] := array[]::uuid[];
begin
  if p_hostel_id is null then return 0; end if;

  -- Do not identify newly finalized rows by updated_at: the common
  -- touch_updated_at trigger sets updated_at=transaction_timestamp(), not
  -- this function's clock_timestamp(). Capture exact day IDs instead.
  select coalesce(array_agg(d.id), array[]::uuid[])
  into v_due_day_ids
  from public.daily_meal_days d
  join public.monthly_periods mp on mp.id=d.period_id
  where d.hostel_id=p_hostel_id and mp.status='running'
    and (p_period_id is null or mp.id=p_period_id)
    and d.status in ('open','locked')
    and d.finalizes_at is not null and d.finalizes_at<=v_now;

  if cardinality(v_due_day_ids)=0 then return 0; end if;

  -- Freeze the normal snapshot before applying any approved late/correction delta.
  update public.daily_meal_records r
  set final_breakfast=coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0),
      final_lunch=coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0),
      final_dinner=coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0),
      finalization_source=coalesce(r.finalization_source,'auto_cutoff'),
      finalized_at=coalesce(r.finalized_at,v_now),
      updated_by=auth.uid(),updated_at=v_now
  where r.daily_meal_day_id=any(v_due_day_ids) and not r.cancelled;

  update public.daily_meal_days d
  set status='finalized',finalized_at=coalesce(d.finalized_at,v_now),updated_at=v_now
  where d.id=any(v_due_day_ids) and d.status in ('open','locked');
  get diagnostics v_days=row_count;

  -- A special request stays off the visible normal snapshot before finalization.
  -- At finalization apply all approved special values for only the IDs frozen above.
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

  if v_days>0 then
    insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
    select p_hostel_id,mp.id,null,'auto_finalize',
      format('%s দিনের মিল cutoff অনুযায়ী স্বয়ংক্রিয়ভাবে চূড়ান্ত হয়েছে',count(*)::text),
      jsonb_build_object('finalized_day_count',count(*),'finalized_at',v_now,'source','auto_cutoff_with_approved_special_requests')
    from public.daily_meal_days d join public.monthly_periods mp on mp.id=d.period_id
    where d.id=any(v_due_day_ids) and d.status='finalized'
    group by mp.id;
  end if;
  return v_days;
end $$;

-- 4) If the old version left ordinary, timely requests in submitted status,
--    rescue only those that were submitted before every cutoff and have no
--    overlapping active request. Late or ambiguous requests are not auto-approved.
do $$
declare v_req public.meal_requests%rowtype;
begin
  for v_req in
    select r.*
    from public.meal_requests r
    join public.monthly_periods mp on mp.id=r.period_id and mp.status='running'
    where r.status='submitted' and r.request_type='normal' and not r.is_late_request
      and r.membership_id is not null
      and jsonb_array_length(r.days)>0
      and not exists (
        select 1
        from jsonb_array_elements(r.days) q(value)
        left join public.daily_meal_days d on d.period_id=r.period_id and d.meal_date=(q.value->>'meal_date')::date
        where d.id is null or d.status='finalized' or d.cutoff_at is null or r.submitted_at>=d.cutoff_at
      )
      and not exists (
        select 1
        from jsonb_array_elements(r.days) q(value)
        join public.meal_requests other on other.period_id=r.period_id and other.membership_id=r.membership_id
          and other.id<>r.id and other.status in ('submitted','approved')
          and other.request_type='normal' and not other.is_late_request
        cross join lateral jsonb_array_elements(other.days) other_day(value)
        where (other_day.value->>'meal_date')::date=(q.value->>'meal_date')::date
      )
    order by r.submitted_at
  loop
    update public.meal_requests set status='approved', reviewed_at=coalesce(reviewed_at,submitted_at), reviewed_by=null, updated_at=now()
    where id=v_req.id;
    perform private.apply_request_days(v_req.id);
  end loop;
end $$;

-- Manager/assistant notification helper for newly submitted special requests.
create or replace function private.notify_meal_request_managers(p_request public.meal_requests)
returns void language plpgsql security definer set search_path = '' as $$
declare v_date date; v_title text; v_body text; v_recipient uuid;
begin
  select min((value->>'meal_date')::date) into v_date from jsonb_array_elements((p_request).days);
  if (p_request).request_type='correction' then
    v_title := 'নতুন মিল সংশোধন অনুরোধ';
    v_body := format('%s-এর %s তারিখের মিল সংশোধন অনুরোধ এসেছে। ম্যানেজমেন্ট → মিল অনুরোধ থেকে যাচাই করুন।',
      coalesce((p_request).member_name_snapshot,'একজন সদস্য'),to_char(v_date,'DD Mon YYYY'));
  else
    v_title := 'নতুন লেট মিল অনুরোধ';
    v_body := format('%s-এর %s তারিখের লেট মিল অনুরোধ এসেছে। ম্যানেজমেন্ট → মিল অনুরোধ থেকে যাচাই করুন।',
      coalesce((p_request).member_name_snapshot,'একজন সদস্য'),to_char(v_date,'DD Mon YYYY'));
  end if;

  for v_recipient in
    select distinct m.user_id
    from (
      select mp.primary_manager_membership_id as membership_id
      from public.monthly_periods mp where mp.id=(p_request).period_id and mp.primary_manager_membership_id is not null
      union all
      select a.membership_id from public.period_assistant_managers a where a.period_id=(p_request).period_id
    ) recipients
    join public.hostel_memberships m on m.id=recipients.membership_id and m.status='active'
    join public.profiles p on p.id=m.user_id and not p.is_blocked
  loop
    insert into public.notifications(hostel_id,recipient_user_id,title,body,created_by)
    values((p_request).hostel_id,v_recipient,v_title,v_body,auth.uid());
  end loop;
end $$;

-- 5) Core request creation: normal requests auto-approve; only late/correction
--    requests wait for manager review. Advisory locking closes the duplicate race.
create or replace function private.create_meal_request_internal(
 p_membership_id uuid,p_start_date date,p_end_date date,p_days jsonb,p_request_type text,p_is_late boolean,p_reason text,p_origin text,p_parent_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
      select 1 from jsonb_array_elements(p_days) q(value)
      join public.daily_meal_days d on d.period_id=v_period.id and d.meal_date=(q.value->>'meal_date')::date
      where d.status in ('finalized','cancelled') or d.cutoff_at is null or d.cutoff_at>v_now
    ) then
      raise exception using message='এই দিনের কাট-অফ শেষ হয়নি, অথবা রাত ৯টায় হিসাব চূড়ান্ত/বাতিল হয়েছে। শুধু কাট-অফ পার হওয়া কিন্তু রাত ৯টার আগে চূড়ান্ত না হওয়া দিনের জন্য সংশোধন দিন।',errcode='55000';
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
end $$;

-- 6) Late-request RPC is guarded server-side above; this explicit wrapper keeps
--    its current PostgREST signature unchanged.
create or replace function public.create_late_meal_request(p_meal_date date,p_breakfast numeric,p_lunch numeric,p_dinner numeric,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_days jsonb;
begin
  v_days:=jsonb_build_array(jsonb_build_object('meal_date',p_meal_date,'breakfast',p_breakfast,'lunch',p_lunch,'dinner',p_dinner));
  return private.create_meal_request_internal(private.my_membership_id(),p_meal_date,p_meal_date,v_days,'normal',true,p_reason,'member',null);
end $$;

-- Normal edits merge changed eligible days into the original history entry and
-- update only those still-open daily rows. Locked/final days are never replayed.
-- Manager review is limited to special requests that have not been finalized.
-- A request that missed the 9 PM freeze stays pending so the manager can reject it
-- with an explanation; approving it must never silently rewrite a final snapshot.
create or replace function public.manager_review_correction(p_request_id uuid,p_approve boolean,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_req public.meal_requests%rowtype;
begin
  select * into v_req from public.meal_requests where id=p_request_id for update;
  if not found then raise exception using message='সংশোধন অনুরোধটি পাওয়া যায়নি।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_req.hostel_id,v_req.period_id,false,true);
  perform private.finalize_due_days(v_req.hostel_id,v_req.period_id);
  if v_req.status<>'submitted' or v_req.request_type<>'correction' or v_req.is_late_request then
    raise exception using message='এই সংশোধন অনুরোধটি আর অপেক্ষমাণ নেই।',errcode='55000';
  end if;
  if p_approve and exists (
    select 1 from jsonb_array_elements(v_req.days) q(value)
    join public.daily_meal_days d on d.period_id=v_req.period_id and d.meal_date=(q.value->>'meal_date')::date
    where d.status in ('finalized','cancelled') or d.finalizes_at is null or d.finalizes_at<=clock_timestamp()
  ) then
    raise exception using message='রাত ৯টার চূড়ান্ত হিসাব হয়ে গেছে। চূড়ান্ত দিনের সংশোধন এই অনুরোধ থেকে অনুমোদন করা যাবে না।',errcode='55000';
  end if;
  update public.meal_requests
  set status=case when p_approve then 'approved' else 'rejected' end,
      review_reason=nullif(btrim(p_reason),''),reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=v_req.id returning * into v_req;
  if p_approve then perform private.apply_request_days(v_req.id); end if;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
  values(v_req.hostel_id,v_req.period_id,auth.uid(),case when p_approve then 'update:correction_approved' else 'update:correction_rejected' end,
    case when p_approve then 'মিল সংশোধন অনুমোদিত হয়েছে' else 'মিল সংশোধন প্রত্যাখ্যান হয়েছে' end,
    jsonb_build_object('request_id',v_req.id,'reason',p_reason));
  return private.get_request_json(v_req);
end $$;

create or replace function public.manager_review_late_meal_request(p_request_id uuid,p_approve boolean,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_req public.meal_requests%rowtype;
begin
  select * into v_req from public.meal_requests where id=p_request_id for update;
  if not found then raise exception using message='লেট মিল অনুরোধটি পাওয়া যায়নি।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_req.hostel_id,v_req.period_id,false,true);
  perform private.finalize_due_days(v_req.hostel_id,v_req.period_id);
  if v_req.status<>'submitted' or not v_req.is_late_request then
    raise exception using message='এই লেট মিল অনুরোধটি আর অপেক্ষমাণ নেই।',errcode='55000';
  end if;
  if p_approve and exists (
    select 1 from jsonb_array_elements(v_req.days) q(value)
    join public.daily_meal_days d on d.period_id=v_req.period_id and d.meal_date=(q.value->>'meal_date')::date
    where d.status in ('finalized','cancelled') or d.finalizes_at is null or d.finalizes_at<=clock_timestamp()
  ) then
    raise exception using message='রাত ৯টার চূড়ান্ত হিসাব হয়ে গেছে। চূড়ান্ত দিনের লেট অনুরোধ অনুমোদন করা যাবে না।',errcode='55000';
  end if;
  update public.meal_requests
  set status=case when p_approve then 'approved' else 'rejected' end,
      review_reason=nullif(btrim(p_reason),''),reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=v_req.id returning * into v_req;
  if p_approve then perform private.apply_request_days(v_req.id); end if;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
  values(v_req.hostel_id,v_req.period_id,auth.uid(),case when p_approve then 'update:late_meal_approved' else 'update:late_meal_rejected' end,
    case when p_approve then 'লেট মিল অনুরোধ অনুমোদিত হয়েছে' else 'লেট মিল অনুরোধ প্রত্যাখ্যান হয়েছে' end,
    jsonb_build_object('request_id',v_req.id,'reason',p_reason));
  return private.get_request_json(v_req);
end $$;

create or replace function public.edit_my_approved_meal_request(p_request_id uuid,p_start_date date,p_end_date date,p_days jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_req public.meal_requests%rowtype; v_period public.monthly_periods%rowtype;
  v_merged_days jsonb; v_item jsonb; v_date date; v_day public.daily_meal_days%rowtype;
  v_b numeric; v_l numeric; v_d numeric;
begin
  perform private.assert_signed_in();
  select * into v_req from public.meal_requests where id=p_request_id and membership_id=private.my_membership_id() for update;
  if not found or v_req.status<>'approved' or v_req.request_type<>'normal' or v_req.is_late_request then
    raise exception using message='শুধু নিজের অনুমোদিত সাধারণ মিল অনুরোধ সম্পাদনা করা যাবে।',errcode='42501';
  end if;
  select * into v_period from public.monthly_periods where id=v_req.period_id and status='running';
  if not found then raise exception using message='এই মাসটি আর চলমান নেই।',errcode='55000'; end if;
  if p_days is null or jsonb_typeof(p_days)<>'array' or jsonb_array_length(p_days)=0 then
    raise exception using message='কমপক্ষে একটি পরিবর্তনযোগ্য দিনের মিলের তথ্য দিতে হবে।',errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_req.membership_id::text,0));
  perform private.assert_meal_days(p_days,v_req.period_id,false);

  if exists (
    select 1 from jsonb_array_elements(p_days) requested(value)
    where not exists (
      select 1 from jsonb_array_elements(v_req.days) original(value)
      where (original.value->>'meal_date')::date=(requested.value->>'meal_date')::date
    )
  ) then
    raise exception using message='এই তারিখটি মূল অনুরোধে নেই। ইতিহাস রিফ্রেশ করে আবার চেষ্টা করুন।',errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_days) requested(value)
    join public.meal_requests other on other.period_id=v_req.period_id and other.membership_id=v_req.membership_id
      and other.id<>v_req.id and other.status in ('submitted','approved')
    cross join lateral jsonb_array_elements(other.days) other_day(value)
    where (other_day.value->>'meal_date')::date=(requested.value->>'meal_date')::date
  ) then
    raise exception using message='এই তারিখের জন্য অন্য একটি সক্রিয় অনুরোধ রয়েছে।',errcode='23505';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_days) q(value)
    join public.daily_meal_days d on d.period_id=v_req.period_id and d.meal_date=(q.value->>'meal_date')::date
    where d.status='finalized' or d.cutoff_at is null or d.cutoff_at<=clock_timestamp()
  ) then
    raise exception using message='কাট-অফ পার হওয়া বা ফাইনাল দিনের মিল এভাবে সম্পাদনা করা যাবে না। সংশোধনের অনুরোধ দিন।',errcode='55000';
  end if;

  select coalesce(jsonb_agg(
    coalesce((
      select requested.value from jsonb_array_elements(p_days) requested(value)
      where (requested.value->>'meal_date')::date=(original.value->>'meal_date')::date
      limit 1
    ), original.value) order by (original.value->>'meal_date')::date
  ),'[]'::jsonb)
  into v_merged_days from jsonb_array_elements(v_req.days) original(value);

  update public.meal_requests
  set start_date=(select min((value->>'meal_date')::date) from jsonb_array_elements(v_merged_days)),
      end_date=(select max((value->>'meal_date')::date) from jsonb_array_elements(v_merged_days)),
      days=v_merged_days,updated_at=now()
  where id=v_req.id returning * into v_req;

  for v_item in select value from jsonb_array_elements(p_days) loop
    v_date := (v_item->>'meal_date')::date;
    v_b := coalesce((v_item->>'breakfast')::numeric,0);
    v_l := coalesce((v_item->>'lunch')::numeric,0);
    v_d := coalesce((v_item->>'dinner')::numeric,0);
    select * into v_day from public.daily_meal_days where period_id=v_req.period_id and meal_date=v_date;
    if not found then raise exception using message='দিনের মিল তথ্য পাওয়া যায়নি।',errcode='P0002'; end if;
    insert into public.daily_meal_records(
      hostel_id,period_id,daily_meal_day_id,member_id,member_name_snapshot,
      planned_breakfast,planned_lunch,planned_dinner,updated_by,cancelled
    ) values(v_req.hostel_id,v_req.period_id,v_day.id,v_req.membership_id,v_req.member_name_snapshot,v_b,v_l,v_d,auth.uid(),false)
    on conflict(daily_meal_day_id,member_id) do update set
      planned_breakfast=excluded.planned_breakfast,planned_lunch=excluded.planned_lunch,planned_dinner=excluded.planned_dinner,
      updated_by=auth.uid(),cancelled=false,updated_at=now();
  end loop;

  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
  values(v_req.hostel_id,v_req.period_id,auth.uid(),'update:meal_request','অনুমোদিত মিল অনুরোধ সম্পাদিত হয়েছে',
    jsonb_build_object('request_id',v_req.id,'edited_dates',p_days,'preserved_untouched_request_days',true));
  return private.get_request_json(v_req);
end $$;


-- 7) Dashboard returns a stable normal-meal snapshot plus a separate approved
--    late/correction delta list. Special changes are merged only by finalization.
create or replace function public.get_dashboard_data()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_hostel uuid; v_member uuid; v_period public.monthly_periods%rowtype;
  v_period_json jsonb; v_day public.daily_meal_days%rowtype; v_meal jsonb;
  v_members jsonb; v_own jsonb; v_member_details jsonb:='[]'::jsonb; v_late_requests jsonb:='[]'::jsonb;
  v_total_market numeric:=0; v_total_meals numeric:=0; v_total_deposit numeric:=0; v_other numeric:=0;
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

  return jsonb_build_object(
    'has_running_period',true,'period_status','running','period',v_period_json,'meal_card',v_meal,
    'summary',jsonb_build_object('total_meals',v_total_meals,'total_market',v_total_market,
      'meal_rate',case when v_total_meals=0 then 0 else round(v_total_market/v_total_meals,4) end,
      'total_deposit',v_total_deposit,'other_expense',v_other),
    'my_account',jsonb_build_object('name',v_own->>'name','meals',(v_own->>'meals')::numeric,
      'deposit',(v_own->>'deposit')::numeric,'meal_cost',(v_own->>'meal_cost')::numeric,
      'other_expense',(v_own->>'other_expense')::numeric,'balance',(v_own->>'balance')::numeric),
    'members',v_members
  );
end $$;

-- 8) Allow a normal member to add a market entry only for their own membership.
--    Managers/assistants retain their existing ability to add for any active member.
create or replace function public.create_market_entry(p_entry_date date,p_buyer_membership_id uuid,p_items jsonb,p_credit_to_buyer boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_hostel uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype;
  v_member public.hostel_memberships%rowtype; v_entry public.market_entries%rowtype; v_total numeric;
  v_actor_membership uuid:=private.my_membership_id();
begin
  perform private.assert_signed_in();
  if not private.can_access_hostel(v_hostel) then
    raise exception using message='এই মেসে বাজার এন্ট্রি করার অনুমতি নেই।',errcode='42501';
  end if;
  if not private.can_manage_hostel(v_hostel,null,false,false) and p_buyer_membership_id is distinct from v_actor_membership then
    raise exception using message='সাধারণ সদস্য শুধু নিজের নামে বাজার এন্ট্রি করতে পারবেন।',errcode='42501';
  end if;
  select * into v_period from public.monthly_periods
  where hostel_id=v_hostel and status='running' and p_entry_date between start_date and end_date limit 1;
  if not found then raise exception using message='বাজারের তারিখটি চলমান মাসের মধ্যে হতে হবে।',errcode='22023'; end if;
  select * into v_member from public.hostel_memberships where id=p_buyer_membership_id and hostel_id=v_hostel and status='active';
  if not found then raise exception using message='বাজারকারীর সক্রিয় সদস্য-তথ্য পাওয়া যায়নি।',errcode='P0002'; end if;
  insert into public.market_entries(hostel_id,period_id,entry_date,buyer_membership_id,buyer_name_snapshot,credit_to_buyer,created_by,updated_by)
  values(v_hostel,v_period.id,p_entry_date,p_buyer_membership_id,(select full_name from public.profiles where id=v_member.user_id),coalesce(p_credit_to_buyer,true),auth.uid(),auth.uid())
  returning * into v_entry;
  v_total:=private.write_market_items(v_entry.id,p_items);
  update public.market_entries set total_amount=v_total where id=v_entry.id returning * into v_entry;
  perform private.sync_market_credit(v_entry.id);
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
  values(v_hostel,v_period.id,auth.uid(),'insert:market_entry','বাজার এন্ট্রি যোগ করা হয়েছে',
    jsonb_build_object('market_entry_id',v_entry.id,'total_amount',v_total,'credit_to_buyer',v_entry.credit_to_buyer));
  return jsonb_build_object('market_entry_id',v_entry.id,'id',v_entry.id,'total_amount',v_total,'status','active');
end $$;

-- 9) Account history includes Khala-money entries as negative expense rows.
--    The original khala_money_entries table remains the source of truth.
create or replace function public.get_account_history_v2(p_period_id uuid default null,p_member_id uuid default null,p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_hostel uuid := private.my_hostel_id();
  v_period uuid := p_period_id;
  v_result jsonb;
  v_effective_member uuid := p_member_id;
  v_can_manage boolean := false;
begin
  perform private.assert_signed_in();
  if v_hostel is null then return '[]'::jsonb; end if;

  -- Important: this is SECURITY DEFINER. A normal member must never be able to
  -- omit p_member_id and retrieve the entire hostel's financial ledger.
  v_can_manage := private.can_manage_hostel(v_hostel,null,false,false);
  if not v_can_manage then
    if v_effective_member is null then v_effective_member := private.my_membership_id(); end if;
    if v_effective_member is distinct from private.my_membership_id() then
      raise exception using message='শুধু নিজের লেনদেনের হিসাব দেখার অনুমতি আছে।',errcode='42501';
    end if;
  end if;

  if v_effective_member is not null and not exists(
    select 1 from public.hostel_memberships where id=v_effective_member and hostel_id=v_hostel
  ) then
    raise exception using message='এই সদস্যের লেনদেন দেখার অনুমতি নেই।',errcode='42501';
  end if;
  if v_period is not null and not exists(select 1 from public.monthly_periods where id=v_period and hostel_id=v_hostel) then
    raise exception using message='এই মাসের হিসাব দেখার অনুমতি নেই।',errcode='42501';
  end if;

  with combined as (
    select l.id as transaction_id,l.member_id,coalesce(p.full_name,l.member_name_snapshot,'সদস্য') as member_name,
      l.ledger_type as transaction_type,l.ledger_type as ledger_type,l.ledger_group,l.amount,l.entry_date,l.description,
      l.reference_type,l.reference_id,l.status,l.created_at,l.updated_at,'ledger'::text as source
    from public.ledger_transactions l
    left join public.hostel_memberships m on m.id=l.member_id
    left join public.profiles p on p.id=m.user_id
    where l.hostel_id=v_hostel and (v_period is null or l.period_id=v_period)
      and (v_effective_member is null or l.member_id=v_effective_member)
    union all
    select k.id as transaction_id,k.member_id,coalesce(p.full_name,k.member_name_snapshot,'সদস্য') as member_name,
      'khala_money'::text as transaction_type,'khala_money'::text as ledger_type,'khala'::text as ledger_group,
      -abs(k.amount) as amount,k.payment_date as entry_date,coalesce(k.description,'খালার টাকা') as description,
      'khala_money'::text as reference_type,k.id as reference_id,k.status,k.created_at,k.updated_at,'khala'::text as source
    from public.khala_money_entries k
    left join public.hostel_memberships m on m.id=k.member_id
    left join public.profiles p on p.id=m.user_id
    where k.hostel_id=v_hostel and (v_period is null or k.period_id=v_period)
      and (v_effective_member is null or k.member_id=v_effective_member)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'transaction_id',q.transaction_id,'id',q.transaction_id,'member_id',q.member_id,'member_name',q.member_name,
    'transaction_type',q.transaction_type,'ledger_type',q.ledger_type,'ledger_group',q.ledger_group,'amount',q.amount,
    'entry_date',q.entry_date,'description',q.description,'reference_type',q.reference_type,'reference_id',q.reference_id,
    'status',q.status,'created_at',q.created_at,'updated_at',q.updated_at,'source',q.source
  ) order by q.entry_date desc,q.created_at desc),'[]'::jsonb)
  into v_result
  from (select * from combined order by entry_date desc,created_at desc limit greatest(1,least(coalesce(p_limit,200),3000))) q;
  return v_result;
end $$;

-- Exact 9 PM finalization can be scheduled with pg_cron (optional separate SQL).
-- Dashboard/RPC requests still perform lazy finalization if Cron is not enabled.
create or replace function private.finalize_all_running_periods()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_period record; v_count integer; v_total integer := 0;
begin
  for v_period in
    select mp.id, mp.hostel_id from public.monthly_periods mp where mp.status='running'
  loop
    v_count := private.finalize_due_days(v_period.hostel_id,v_period.id);
    v_total := v_total + coalesce(v_count,0);
  end loop;
  return v_total;
end $$;
revoke all on function private.finalize_all_running_periods() from public, anon, authenticated;

commit;

-- Read-only post-migration diagnostics. Run separately if desired.
select 'daily_cutoff_rows' as check_name, count(*) as issue_count
from public.daily_meal_days d
where d.cutoff_at is distinct from (((d.meal_date - 1)::timestamp + time '22:00') at time zone 'Asia/Dhaka')
union all
select 'daily_finalization_rows', count(*)
from public.daily_meal_days d
where d.finalizes_at is distinct from ((d.meal_date::timestamp + time '21:00') at time zone 'Asia/Dhaka')
union all
select 'special_request_pending_manager_review', count(*)
from public.meal_requests r
where r.status='submitted' and (r.is_late_request or r.request_type='correction')
union all
select 'approved_normal_requests', count(*)
from public.meal_requests r
where r.status='approved' and r.request_type='normal' and not r.is_late_request;
