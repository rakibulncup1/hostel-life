-- HOSTEL LIFE — PHASE 3 BACKEND FUNCTIONAL HARDENING V1
-- Controlled migration. No DROP/TRUNCATE and no historical business-data reset.
-- Run once in Supabase SQL Editor.

BEGIN;

CREATE OR REPLACE FUNCTION private.notify_period_managers(
  p_period_id uuid,
  p_title text,
  p_body text,
  p_reference_type text,
  p_reference_id uuid,
  p_created_by uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_hostel uuid;
  v_count integer:=0;
  v_target uuid;
  v_notification uuid;
begin
  select hostel_id into v_hostel from public.monthly_periods where id=p_period_id;
  if v_hostel is null then return 0; end if;
  if p_title is null or length(trim(p_title))=0 or p_body is null or length(trim(p_body))=0 then return 0; end if;

  for v_target in
    select distinct target_membership_id
    from (
      select mp.primary_manager_membership_id as target_membership_id
      from public.monthly_periods mp
      where mp.id=p_period_id and mp.primary_manager_membership_id is not null
      union all
      select pam.membership_id
      from public.period_assistant_managers pam
      where pam.period_id=p_period_id
    ) t
    where target_membership_id is not null
  loop
    begin
      insert into public.notifications(
        hostel_id,notification_type,title,body,reference_type,reference_id,created_by,target_membership_id
      ) values(
        v_hostel,'system',trim(p_title),trim(p_body),p_reference_type,p_reference_id,p_created_by,v_target
      ) returning id into v_notification;

      perform private.seed_notification_states(v_notification,v_hostel);
      v_count:=v_count+1;
    exception when others then
      -- Notification delivery must never roll back a valid meal request.
      null;
    end;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION private.submit_meal_plan_request(p_member_id uuid, p_origin text, p_start_date date, p_end_date date, p_days jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_hostel uuid;
  v_period uuid;
  v_request uuid;
  v_today date;
  v_expected integer;
  v_count integer;
  v_distinct integer;
  v_min date;
  v_max date;
  d record;
  v_day public.daily_meal_days;
begin
  v_hostel:=private.current_hostel_id(true);
  v_today:=private.current_local_date(v_hostel);


  if p_origin not in ('member','manager_self') then raise exception using message='মিল রিকোয়েস্টের ধরন সঠিক নয়।'; end if;
  perform private.assert_membership(p_member_id,v_hostel,true);
  if p_start_date is null or p_end_date is null or p_start_date>p_end_date then
    raise exception using message='শুরুর ও শেষ তারিখ সঠিকভাবে দিতে হবে।';
  end if;
  if p_start_date<=v_today then
    raise exception using message='আজকের বা আগের দিনের জন্য সাধারণ মিল রিকোয়েস্ট দেওয়া যাবে না। পরবর্তী দিনের জন্য দিন।';
  end if;

  v_period:=private.period_for_hostel_date(v_hostel,p_start_date);
  if v_period is null or private.period_for_hostel_date(v_hostel,p_end_date) is distinct from v_period then
    raise exception using message='নির্বাচিত তারিখগুলো একই চলমান মাসের মধ্যে হতে হবে।';
  end if;
  if not exists(select 1 from public.monthly_periods mp where mp.id=v_period and mp.status='running') then
    raise exception using message='শুধু চলমান মাসের জন্য মিল দেওয়া যাবে।';
  end if;

  perform private.ensure_period_days(v_period);
  perform pg_advisory_xact_lock(hashtextextended(p_member_id::text||':'||v_period::text,0));

  select count(*)::int,count(distinct meal_date)::int,min(meal_date),max(meal_date)
    into v_count,v_distinct,v_min,v_max
  from jsonb_to_recordset(p_days) as x(meal_date date,breakfast numeric,lunch numeric,dinner numeric);
  v_expected:=p_end_date-p_start_date+1;
  if coalesce(v_count,0)<>v_expected or coalesce(v_distinct,0)<>v_expected or v_min<>p_start_date or v_max<>p_end_date then
    raise exception using message='সব দিনের মিল তথ্য সঠিকভাবে দিতে হবে।';
  end if;

  for d in select * from jsonb_to_recordset(p_days) as x(meal_date date,breakfast numeric,lunch numeric,dinner numeric) loop
    select * into v_day from public.daily_meal_days where hostel_id=v_hostel and meal_date=d.meal_date;
    if v_day.id is null then raise exception using message='নির্বাচিত দিনের মিল তথ্য পাওয়া যায়নি।'; end if;
    if d.breakfast is null or d.lunch is null or d.dinner is null or d.breakfast<0 or d.lunch<0 or d.dinner<0 or d.breakfast>50 or d.lunch>50 or d.dinner>50 then
      raise exception using message='মিলের পরিমাণ সঠিক নয়।';
    end if;
    if now()>=v_day.cutoff_at then raise exception using message=format('%s তারিখের কাট-অফ সময় শেষ হয়ে গেছে।',to_char(d.meal_date,'DD Mon YYYY')); end if;
  end loop;

  if exists(
    select 1 from public.meal_requests mr
    where mr.member_id=p_member_id and mr.period_id=v_period
      and mr.request_type='normal'
      and mr.status in ('submitted','approved')
      and p_start_date<=mr.end_date and mr.start_date<=p_end_date
  ) then
    raise exception using message='নির্বাচিত তারিখগুলোর মধ্যে এক বা একাধিক দিনের মিল আগে থেকেই দেওয়া আছে।';
  end if;

  insert into public.meal_requests(hostel_id,period_id,member_id,request_type,status,start_date,end_date,origin,submitted_at)
  values(v_hostel,v_period,p_member_id,'normal','approved',p_start_date,p_end_date,p_origin,now())
  returning id into v_request;

  for d in select * from jsonb_to_recordset(p_days) as x(meal_date date,breakfast numeric,lunch numeric,dinner numeric) loop
    insert into public.meal_request_days(request_id,meal_date,breakfast,lunch,dinner,is_current)
    values(v_request,d.meal_date,d.breakfast,d.lunch,d.dinner,true);

    insert into public.daily_meal_records(
      hostel_id,period_id,daily_meal_day_id,member_id,
      planned_breakfast,planned_lunch,planned_dinner,cancelled
    )
    select v_hostel,v_period,dmd.id,p_member_id,d.breakfast,d.lunch,d.dinner,false
    from public.daily_meal_days dmd
    where dmd.hostel_id=v_hostel and dmd.meal_date=d.meal_date
    on conflict(daily_meal_day_id,member_id) do update
      set planned_breakfast=excluded.planned_breakfast,
          planned_lunch=excluded.planned_lunch,
          planned_dinner=excluded.planned_dinner,
          cancelled=false,
          updated_at=now();

    perform private.refresh_meal_snapshot(v_hostel,d.meal_date);
  end loop;

  if p_origin='member' then
    perform private.notify_period_managers(
      v_period,
      'নতুন মিল রিকোয়েস্ট',
      format('%s থেকে %s পর্যন্ত একজন সদস্য নতুন মিল রিকোয়েস্ট পাঠিয়েছেন।',to_char(p_start_date,'DD Mon YYYY'),to_char(p_end_date,'DD Mon YYYY')),
      'meal_request',
      v_request,
      p_member_id
    );
  end if;

  return jsonb_build_object('request_id',v_request,'status','approved','origin',p_origin,'start_date',p_start_date,'end_date',p_end_date);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_meal_correction_request(p_start_date date, p_end_date date, p_days jsonb, p_parent_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
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
begin
  perform private.assert_authenticated();
  v_member:=private.current_membership_id(true);
  v_hostel:=private.current_hostel_id(true);
  if v_member is null or v_hostel is null then raise exception using message='সক্রিয় সদস্য হওয়া প্রয়োজন।'; end if;
  if p_start_date is null or p_end_date is null or p_start_date>p_end_date then raise exception using message='সংশোধনের তারিখ সঠিক নয়।'; end if;

  v_period:=private.period_for_hostel_date(v_hostel,p_start_date);
  if v_period is null or private.period_for_hostel_date(v_hostel,p_end_date) is distinct from v_period then
    raise exception using message='সংশোধনের তারিখগুলো একই চলমান মাসের মধ্যে হতে হবে।';
  end if;
  if not exists(select 1 from public.monthly_periods mp where mp.id=v_period and mp.status='running') then
    raise exception using message='শুধু চলমান মাসের মিল সংশোধনের রিকোয়েস্ট করা যাবে।';
  end if;

  if p_parent_request_id is not null then
    select * into v_parent
    from public.meal_requests
    where id=p_parent_request_id
      and hostel_id=v_hostel
      and period_id=v_period
      and member_id=v_member
      and request_type='normal'
      and status='approved';
    if v_parent.id is null then raise exception using message='মূল মিল রিকোয়েস্টটি পাওয়া যায়নি।'; end if;
    if p_start_date < v_parent.start_date or p_end_date > v_parent.end_date then
      raise exception using message='সংশোধনের তারিখ অবশ্যই মূল মিল রিকোয়েস্টের তারিখসীমার মধ্যে হতে হবে।';
    end if;
  end if;

  v_expected:=p_end_date-p_start_date+1;
  select count(*)::int,count(distinct meal_date)::int,min(meal_date),max(meal_date)
    into v_count,v_distinct,v_min,v_max
  from jsonb_to_recordset(p_days) as x(meal_date date,breakfast numeric,lunch numeric,dinner numeric);
  if coalesce(v_count,0)<>v_expected or coalesce(v_distinct,0)<>v_expected or v_min<>p_start_date or v_max<>p_end_date then
    raise exception using message='সংশোধনের সব দিনের তথ্য দিতে হবে।';
  end if;

  perform private.ensure_period_days(v_period);
  perform pg_advisory_xact_lock(hashtextextended('correction:'||v_member::text||':'||v_period::text,0));

  for d in select * from jsonb_to_recordset(p_days) as x(meal_date date,breakfast numeric,lunch numeric,dinner numeric) loop
    select * into v_day from public.daily_meal_days where hostel_id=v_hostel and meal_date=d.meal_date;
    if v_day.id is null then raise exception using message='নির্বাচিত দিনের মিল তথ্য পাওয়া যায়নি।'; end if;
    if now()<v_day.cutoff_at then
      raise exception using message=format('%s তারিখের কাট-অফ এখনো শেষ হয়নি। এই দিনের মিল সরাসরি এডিট করা যাবে।',to_char(d.meal_date,'DD Mon YYYY'));
    end if;
    if d.breakfast is null or d.lunch is null or d.dinner is null or d.breakfast<0 or d.lunch<0 or d.dinner<0 or d.breakfast>50 or d.lunch>50 or d.dinner>50 then
      raise exception using message='মিলের পরিমাণ সঠিক নয়।';
    end if;
    if exists(
      select 1 from public.meal_late_overrides mlo
      where mlo.daily_meal_day_id=v_day.id and mlo.member_id=v_member and mlo.status='approved'
    ) then
      raise exception using message=format('%s তারিখের একটি লেট মিল পরিবর্তন ইতিমধ্যে অনুমোদিত হয়েছে।',to_char(d.meal_date,'DD Mon YYYY'));
    end if;
  end loop;

  if exists(
    select 1 from public.meal_requests mr
    where mr.member_id=v_member and mr.period_id=v_period and mr.request_type='correction'
      and mr.status in ('submitted','approved')
      and p_start_date<=mr.end_date and mr.start_date<=p_end_date
  ) then
    raise exception using message='নির্বাচিত তারিখগুলোর জন্য একটি সংশোধন রিকোয়েস্ট আগে থেকেই রয়েছে।';
  end if;

  insert into public.meal_requests(
    hostel_id,period_id,member_id,request_type,status,start_date,end_date,parent_request_id,origin,submitted_at
  ) values(
    v_hostel,v_period,v_member,'correction','submitted',p_start_date,p_end_date,p_parent_request_id,'member',now()
  ) returning id into v_request;

  for d in select * from jsonb_to_recordset(p_days) as x(meal_date date,breakfast numeric,lunch numeric,dinner numeric) loop
    insert into public.meal_request_days(request_id,meal_date,breakfast,lunch,dinner,is_current)
    values(v_request,d.meal_date,d.breakfast,d.lunch,d.dinner,true);
  end loop;

  perform private.notify_period_managers(
    v_period,
    'মিল সংশোধন রিকোয়েস্ট',
    format('%s থেকে %s পর্যন্ত একজন সদস্যের মিল সংশোধন রিকোয়েস্ট এসেছে।',to_char(p_start_date,'DD Mon YYYY'),to_char(p_end_date,'DD Mon YYYY')),
    'meal_request',
    v_request,
    v_member
  );

  return jsonb_build_object('request_id',v_request,'status','submitted','request_type','correction','start_date',p_start_date,'end_date',p_end_date);
end;
$function$;

create or replace function private.start_next_period(
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_hostel uuid;
  v_actor uuid;
  v_old public.monthly_periods;
  v_existing_running uuid;
  v_new_id uuid;
  v_label text;
  v_required_start date;
  v_count integer;
  v_new_end date;
  v_calendar_end date;
  v_assistant record;
begin
  v_hostel:=private.current_hostel_id(true);
  v_actor:=private.current_membership_id(true);

  if v_hostel is null or v_actor is null then
    raise exception using message='মেসের সক্রিয় সদস্য হওয়া প্রয়োজন।';
  end if;

  -- Prevent two concurrent start requests from racing each other.
  perform pg_advisory_xact_lock(hashtextextended('period-start:'||v_hostel::text,0));

  select mp.id into v_existing_running
  from public.monthly_periods mp
  where mp.hostel_id=v_hostel and mp.status='running'
  order by mp.start_date desc,mp.created_at desc
  limit 1;

  if v_existing_running is not null then
    raise exception using message='বর্তমান মাস এখনো চলমান। নতুন মাস শুরু করার আগে বর্তমান মাস বন্ধ করুন।';
  end if;

  select * into v_old
  from public.monthly_periods
  where hostel_id=v_hostel and status='archived'
  order by end_date desc,created_at desc
  limit 1
  for update;

  if v_old.id is null then
    raise exception using message='আগের কোনো বন্ধ মাস পাওয়া যায়নি।';
  end if;

  if v_old.primary_manager_membership_id<>v_actor then
    raise exception using message='শুধু আগের মাসের প্রধান ম্যানেজার নতুন মাস শুরু করতে পারবেন।';
  end if;

  v_required_start:=v_old.end_date+1;

  if p_start_date<>v_required_start then
    if private.current_local_date(v_hostel)=v_old.end_date then
      raise exception using message='আজ যে মাসটি শেষ হয়েছে, তার পরের দিন থেকে নতুন মাস শুরু করা যাবে। আগামীকাল চেষ্টা করুন।';
    end if;
    raise exception using message=format('নতুন মাসের শুরুর তারিখ অবশ্যই %s হতে হবে.',to_char(v_required_start,'DD Mon YYYY'));
  end if;

  if private.current_local_date(v_hostel)<p_start_date then
    raise exception using message='নতুন মাসের শুরুর তারিখ এখনও আসেনি।';
  end if;

  if p_end_date is null then
    raise exception using message='নতুন মাসের শেষ তারিখ নির্ধারণ করা আবশ্যক।';
  end if;
  if p_end_date<p_start_date then
    raise exception using message='শেষ তারিখ শুরুর তারিখের আগে হতে পারবে না।';
  end if;

  v_calendar_end:=(date_trunc('month',p_start_date)+interval '1 month - 1 day')::date;
  if p_end_date>v_calendar_end then
    raise exception using message=format('একটি calendar month-এর শেষ তারিখ %s-এর পরে হতে পারবে না।',to_char(v_calendar_end,'DD Mon YYYY'));
  end if;

  select coalesce(max(mp.calendar_month_sequence),0)
    into v_count
  from public.monthly_periods mp
  where mp.hostel_id=v_hostel
    and extract(year from mp.start_date)=extract(year from p_start_date)
    and extract(month from mp.start_date)=extract(month from p_start_date);

  v_label:=private.period_label_for_sequence(p_start_date,v_count+1);
  v_new_end:=p_end_date;

  insert into public.monthly_periods(
    hostel_id,label,start_date,end_date,status,
    manager_at_start_membership_id,primary_manager_membership_id,calendar_month_sequence
  ) values(
    v_hostel,v_label,p_start_date,v_new_end,'running',v_actor,v_actor,v_count+1
  ) returning id into v_new_id;

  -- Carry assistants only when the same primary manager closes and opens.
  if v_old.primary_manager_membership_id=v_actor
     and v_old.manager_at_close_membership_id=v_actor then
    for v_assistant in
      select pam.membership_id
      from public.period_assistant_managers pam
      join public.hostel_memberships hm on hm.id=pam.membership_id
      where pam.period_id=v_old.id
        and hm.hostel_id=v_hostel
        and hm.status='active'
    loop
      if v_assistant.membership_id<>v_actor then
        insert into public.period_assistant_managers(
          hostel_id,period_id,membership_id,assigned_by
        ) values(v_hostel,v_new_id,v_assistant.membership_id,v_actor)
        on conflict(period_id,membership_id) do nothing;
      end if;
    end loop;
  end if;

  perform private.ensure_period_days(v_new_id);

  return jsonb_build_object(
    'period_id',v_new_id,
    'label',v_label,
    'start_date',p_start_date,
    'end_date',v_new_end,
    'carried_assistants',(
      v_old.primary_manager_membership_id=v_actor
      and v_old.manager_at_close_membership_id=v_actor
    )
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.close_current_month(p_confirm_future_cancel boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_hostel uuid;
  v_actor uuid;
  v_today date;
  v_period public.monthly_periods;
  v_future_count integer:=0;
  v_cancel jsonb;
  v_calendar_end date;
  v_close_date date;
begin
  perform private.assert_authenticated();
  v_hostel:=private.current_hostel_id(true);
  v_actor:=private.current_membership_id(true);
  v_today:=private.current_local_date(v_hostel);

  select * into v_period
  from public.monthly_periods
  where hostel_id=v_hostel and status='running'
  for update;

  if v_period.id is null then
    raise exception using message='কোনো চলমান মাস পাওয়া যায়নি।';
  end if;
  if v_period.primary_manager_membership_id<>v_actor then
    raise exception using message='শুধু প্রধান ম্যানেজার বর্তমান মাস শেষ করতে পারবেন।';
  end if;
  if v_today < v_period.start_date then
    raise exception using message='মাসের শুরুর তারিখ এখনও আসেনি।';
  end if;

  v_calendar_end:=(date_trunc('month',v_period.start_date)+interval '1 month - 1 day')::date;
  -- Closing can never extend a period beyond either its configured end date
  -- or the calendar month's final day.
  v_close_date:=least(v_today,v_period.end_date,v_calendar_end);
  if v_close_date < v_period.start_date then
    raise exception using message='মাসের বৈধ শেষ তারিখ নির্ধারণ করা যায়নি।';
  end if;

  select count(*) into v_future_count
  from public.meal_requests mr
  where mr.period_id=v_period.id
    and mr.status in ('submitted','approved')
    and mr.end_date>v_close_date;

  if v_future_count>0 and not p_confirm_future_cancel then
    raise exception using message=format(
      'আজকের পর থেকে এই মাসের অধীনে থাকা %sটি ভবিষ্যতের মিল রিকোয়েস্ট ক্যানসেল হয়ে যাবে। নিশ্চিত করলে মাস বন্ধ হবে।',
      v_future_count
    );
  end if;

  v_cancel:=private.cancel_period_after_date(v_period.id,v_close_date);

  update public.monthly_periods
     set end_date=v_close_date,
         status='archived',
         archived_at=now(),
         manager_at_close_membership_id=v_actor,
         updated_at=now()
   where id=v_period.id;

  perform public.generate_monthly_summary(v_period.id);

  insert into public.notifications(hostel_id,notification_type,title,body,created_by)
  values(v_hostel,'system','মাস শেষ হয়েছে',v_period.label||' মাস বন্ধ করা হয়েছে। কার্যকর শেষ তারিখ: '||to_char(v_close_date,'DD Mon YYYY')||'.',v_actor);

  return jsonb_build_object(
    'period_id',v_period.id,
    'label',v_period.label,
    'closed_date',v_close_date,
    'cancel_result',v_cancel,
    'status','archived'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.manager_set_running_period_end_date(p_new_end_date date, p_confirm_future_cancel boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_hostel uuid;
  v_actor uuid;
  v_period public.monthly_periods;
  v_today date;
  v_future_count integer:=0;
  v_cancel jsonb;
  v_calendar_end date;
begin
  perform private.assert_authenticated();
  v_hostel:=private.current_hostel_id(true);
  v_actor:=private.current_membership_id(true);
  v_today:=private.current_local_date(v_hostel);

  select * into v_period
  from public.monthly_periods
  where hostel_id=v_hostel and status='running'
  for update;

  if v_period.id is null then
    raise exception using message='কোনো চলমান মাস পাওয়া যায়নি।';
  end if;
  if v_period.primary_manager_membership_id<>v_actor then
    raise exception using message='শুধু প্রধান ম্যানেজার বর্তমান মাসের শেষ তারিখ পরিবর্তন করতে পারবেন।';
  end if;
  if p_new_end_date < v_period.start_date then
    raise exception using message='শেষ তারিখ মাসের শুরুর তারিখের আগে হতে পারবে না।';
  end if;
  if p_new_end_date is null then
    raise exception using message='মাসের শেষ তারিখ দিতে হবে।';
  end if;
  if p_new_end_date < v_today then
    raise exception using message='অতীতের কোনো তারিখ মাসের শেষ তারিখ হিসেবে নির্বাচন করা যাবে না।';
  end if;

  v_calendar_end:=(date_trunc('month',v_period.start_date)+interval '1 month - 1 day')::date;
  if p_new_end_date>v_calendar_end then
    raise exception using message=format('চলমান period-এর শেষ তারিখ calendar month-এর শেষ দিন %s-এর পরে হতে পারবে না।',to_char(v_calendar_end,'DD Mon YYYY'));
  end if;

  if p_new_end_date < v_period.end_date then
    select count(*) into v_future_count
    from public.meal_requests mr
    where mr.period_id=v_period.id
      and mr.status in ('submitted','approved')
      and mr.start_date<=v_period.end_date
      and mr.end_date>p_new_end_date;

    if v_future_count>0 and not p_confirm_future_cancel then
      raise exception using message=format(
        'সতর্কতা: %sটি ভবিষ্যৎ মিল রিকোয়েস্ট নতুন শেষ তারিখের পরে রয়েছে। নিশ্চিত করলে সেগুলো বাতিল হবে।',
        v_future_count
      );
    end if;
  end if;

  if p_new_end_date < v_period.end_date then
    v_cancel:=private.cancel_period_after_date(v_period.id,p_new_end_date);
  else
    v_cancel:='{}'::jsonb;
  end if;

  delete from public.monthly_summaries where period_id=v_period.id;

  update public.monthly_periods
     set end_date=p_new_end_date,updated_at=now()
   where id=v_period.id;

  perform private.ensure_period_days(v_period.id);

  return jsonb_build_object(
    'period_id',v_period.id,
    'old_end_date',v_period.end_date,
    'new_end_date',p_new_end_date,
    'cancel_result',v_cancel,
    'status','updated'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_meal_request_overlap_details(p_period_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(
  request_id_a uuid,
  request_id_b uuid,
  member_id_a uuid,
  member_name_a text,
  member_id_b uuid,
  member_name_b text,
  start_date_a date,
  end_date_a date,
  start_date_b date,
  end_date_b date,
  status_a text,
  status_b text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  select
    a.id, b.id,
    a.member_id, pa.full_name,
    b.member_id, pb.full_name,
    a.start_date, a.end_date,
    b.start_date, b.end_date,
    a.status::text, b.status::text
  from public.meal_requests a
  join public.meal_requests b
    on b.period_id=a.period_id
   and b.id>a.id
   and b.request_type='normal'
   and b.status in ('submitted','approved')
   and a.member_id=b.member_id
   and a.start_date<=b.end_date
   and b.start_date<=a.end_date
  join public.hostel_memberships hma on hma.id=a.member_id
  join public.profiles pa on pa.id=hma.user_id
  join public.hostel_memberships hmb on hmb.id=b.member_id
  join public.profiles pb on pb.id=hmb.user_id
  where a.request_type='normal'
    and a.status in ('submitted','approved')
    and (p_period_id is null or a.period_id=p_period_id)
    and a.hostel_id=private.current_hostel_id(true)
    and b.hostel_id=a.hostel_id
    and private.can_manage_period(a.period_id)
  order by a.start_date,b.start_date,a.id,b.id;
$function$;

REVOKE ALL ON FUNCTION private.notify_period_managers(uuid,text,text,text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_meal_request_overlap_details(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_meal_request_overlap_details(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.manager_review_correction(p_request_id uuid, p_approve boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_req public.meal_requests;
  v_actor uuid;
  v_hostel uuid;
  d record;
  v_day public.daily_meal_days;
begin
  perform private.assert_authenticated();
  v_actor:=private.current_membership_id(true);
  v_hostel:=private.current_hostel_id(true);

  select * into v_req
  from public.meal_requests
  where id=p_request_id
    and hostel_id=v_hostel
    and request_type='correction'
    and status='submitted'
  for update;

  if v_req.id is null then
    raise exception using message='সংশোধন রিকোয়েস্ট পাওয়া যায়নি বা ইতিমধ্যে পর্যালোচনা হয়েছে।';
  end if;

  if not private.can_manage_period(v_req.period_id) then
    raise exception using message='এই রিকোয়েস্ট অনুমোদনের অনুমতি নেই।';
  end if;

  if not p_approve then
    if p_reason is null or length(trim(p_reason))<1 then
      raise exception using message='বাতিল করার কারণ লিখতে হবে।';
    end if;

    update public.meal_requests
    set status='rejected',
        rejection_reason=trim(p_reason),
        reviewed_by=v_actor,
        reviewed_at=now(),
        updated_at=now()
    where id=p_request_id;

    insert into public.notifications(
      hostel_id,notification_type,title,body,reference_type,reference_id,created_by,target_membership_id
    ) values(
      v_hostel,'system','মিল সংশোধন বাতিল হয়েছে',
      'আপনার মিল সংশোধন রিকোয়েস্ট অনুমোদিত হয়নি।','meal_request',v_req.id,v_actor,v_req.member_id
    );

    return jsonb_build_object('request_id',p_request_id,'status','rejected');
  end if;

  -- Preflight every day first, so the request is never partially approved.
  for d in select * from public.meal_request_days where request_id=p_request_id order by meal_date loop
    select * into v_day
    from public.daily_meal_days
    where hostel_id=v_hostel and meal_date=d.meal_date
    for update;

    if v_day.id is null then
      raise exception using message='নির্বাচিত দিনের মিল তথ্য পাওয়া যায়নি।';
    end if;

    if now()<v_day.cutoff_at then
      raise exception using message=format(
        '%s তারিখের কাট-অফ এখনো শেষ হয়নি। এই দিনের জন্য সরাসরি এডিট করা যাবে।',
        to_char(d.meal_date,'DD Mon YYYY')
      );
    end if;
  end loop;

  -- Approved correction handling:
  -- open/locked days wait in meal_late_overrides for the scheduled 9 PM finalizer;
  -- already-finalized days are applied immediately because their publication point has passed.
  for d in select * from public.meal_request_days where request_id=p_request_id order by meal_date loop
    select * into v_day
    from public.daily_meal_days
    where hostel_id=v_hostel and meal_date=d.meal_date
    for update;

    if v_day.status='open' then
      update public.daily_meal_days
      set status='locked',
          locked_at=coalesce(locked_at,now()),
          updated_at=now()
      where id=v_day.id;
    end if;

    if exists(
      select 1 from public.meal_late_overrides mlo
      where mlo.daily_meal_day_id=v_day.id
        and mlo.member_id=v_req.member_id
        and mlo.status in ('approved','applied')
    ) then
      raise exception using message=format('%s তারিখের একটি লেট মিল পরিবর্তন ইতিমধ্যে অনুমোদিত হয়েছে।',to_char(d.meal_date,'DD Mon YYYY'));
    end if;

    if v_day.status='finalized' then
      insert into public.meal_late_overrides(
        hostel_id,period_id,daily_meal_day_id,member_id,
        source_type,source_request_id,breakfast,lunch,dinner,status,reason,approved_by,approved_at,applied_at
      ) values(
        v_hostel,v_req.period_id,v_day.id,v_req.member_id,
        'member_correction',v_req.id,d.breakfast,d.lunch,d.dinner,'applied',null,v_actor,now(),now()
      );

      update public.daily_meal_records
      set planned_breakfast=d.breakfast,
          planned_lunch=d.lunch,
          planned_dinner=d.dinner,
          final_breakfast=d.breakfast,
          final_lunch=d.lunch,
          final_dinner=d.dinner,
          cancelled=false,
          finalization_source='late_correction',
          finalized_by=v_actor,
          finalized_at=now(),
          updated_at=now()
      where daily_meal_day_id=v_day.id and member_id=v_req.member_id;

      if not found then
        insert into public.daily_meal_records(
          hostel_id,period_id,daily_meal_day_id,member_id,
          planned_breakfast,planned_lunch,planned_dinner,
          final_breakfast,final_lunch,final_dinner,
          cancelled,finalization_source,entered_by,entered_at,finalized_by,finalized_at
        ) values(
          v_hostel,v_req.period_id,v_day.id,v_req.member_id,
          d.breakfast,d.lunch,d.dinner,
          d.breakfast,d.lunch,d.dinner,
          false,'late_correction',v_actor,now(),v_actor,now()
        );
      end if;

      perform private.refresh_meal_snapshot(v_hostel,d.meal_date);
    else
      insert into public.meal_late_overrides(
        hostel_id,period_id,daily_meal_day_id,member_id,
        source_type,source_request_id,breakfast,lunch,dinner,status,reason,approved_by,approved_at
      ) values(
        v_hostel,v_req.period_id,v_day.id,v_req.member_id,
        'member_correction',v_req.id,d.breakfast,d.lunch,d.dinner,'approved',null,v_actor,now()
      );
    end if;
  end loop;

  update public.meal_requests
  set status='approved',
      reviewed_by=v_actor,
      reviewed_at=now(),
      updated_at=now()
  where id=p_request_id;

  insert into public.notifications(
    hostel_id,notification_type,title,body,reference_type,reference_id,created_by,target_membership_id
  ) values(
    v_hostel,'system','মিল সংশোধন অনুমোদিত',
    'আপনার মিল সংশোধন রিকোয়েস্ট অনুমোদন করা হয়েছে।','meal_request',v_req.id,v_actor,v_req.member_id
  );

  return jsonb_build_object('request_id',p_request_id,'status','approved','applies_at','9 PM finalization or immediate if already finalized');
end;
$function$
$function$;


CREATE INDEX IF NOT EXISTS idx_meal_requests_period_status_submitted
  ON public.meal_requests(period_id,status,submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_meal_request_days_request_date
  ON public.meal_request_days(request_id,meal_date);

-- Browser compression targets ~190 KB. Give the server a small safety headroom without touching existing files.
UPDATE storage.buckets SET file_size_limit=262144 WHERE id='hostel_documents';

COMMIT;

select 'PHASE3_BACKEND_REPAIR' as check_name, 'committed' as result
union all
select 'RUNNING_PERIODS', count(*)::text from public.monthly_periods where status='running'
union all
select 'MEAL_REQUEST_OVERLAP_PAIRS', count(*)::text
from public.meal_requests a
join public.meal_requests b
  on b.period_id=a.period_id and b.id>a.id
 and b.request_type='normal' and b.status in ('submitted','approved')
 and a.request_type='normal' and a.status in ('submitted','approved')
 and a.member_id=b.member_id
 and a.start_date<=b.end_date and b.start_date<=a.end_date
union all
select 'PROFILE_AVATAR_BUCKET_LIMIT_BYTES', coalesce((select file_size_limit::text from storage.buckets where id='hostel_documents'),'missing')
union all
select 'MEAL_FINALIZER_CRON', coalesce((select jobname||' / '||schedule from cron.job where jobname='hostel_life_meal_finalizer'),'missing');
