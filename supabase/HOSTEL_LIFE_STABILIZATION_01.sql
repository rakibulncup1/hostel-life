-- ================================================================
-- HOSTEL LIFE — STABILIZATION-01
-- Purpose: recover core manager/member/period/report flows after
-- cumulative frontend + backend integration regressions.
--
-- SAFE PATCH:
-- - No DROP/TRUNCATE/DELETE on application data.
-- - Does not rerun Master SQL or Repair V2.0.2.
-- - Adds resilient read RPCs and hardens new-month creation.
-- - Replaces one private helper with a guard-added equivalent.
-- ================================================================

begin;

-- ------------------------------------------------
-- 1) Resilient member directory
-- Avoids the old directory's dependency chain through private
-- financial helper functions when managers only need member identity.
-- It also provides the same accounting fields for existing screens.
-- ------------------------------------------------
create or replace function public.get_member_directory_v2()
returns table(
  membership_id uuid,
  member_name text,
  member_status public.membership_status,
  role public.membership_role,
  meal_activity text,
  final_meals numeric,
  deposit numeric,
  meal_cost numeric,
  other_expense numeric,
  balance numeric
)
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare
  v_hostel uuid;
  v_period uuid;
  v_rate numeric:=0;
  r record;
begin
  perform private.assert_authenticated();
  v_hostel:=private.current_hostel_id(true);
  if v_hostel is null then
    raise exception using message='আপনি কোনো মেসের সদস্য নন।';
  end if;
  if not private.is_active_member(v_hostel) then
    raise exception using message='মেসের সক্রিয় সদস্য হওয়া প্রয়োজন।';
  end if;

  select mp.id into v_period
  from public.monthly_periods mp
  where mp.hostel_id=v_hostel and mp.status='running'
  order by mp.start_date desc,mp.created_at desc
  limit 1;

  if v_period is not null then
    select case when total_meals>0 then total_market/total_meals else 0 end
      into v_rate
    from (
      select
        coalesce((select sum(me.total_amount) from public.market_entries me where me.period_id=v_period and me.status='active'),0) as total_market,
        coalesce((select sum(coalesce(d.final_breakfast,0)+coalesce(d.final_lunch,0)+coalesce(d.final_dinner,0)) from public.daily_meal_records d where d.period_id=v_period and not d.cancelled),0) as total_meals
    ) s;
  end if;

  for r in
    select hm.id,p.full_name,hm.status,hm.role
    from public.hostel_memberships hm
    join public.profiles p on p.id=hm.user_id
    where hm.hostel_id=v_hostel
    order by case when hm.status='active' then 0 else 1 end,p.full_name
  loop
    if v_period is null then
      final_meals:=0; deposit:=0; meal_cost:=0; other_expense:=0; balance:=0;
      meal_activity:='এই মাসে মিল নেই';
    else
      select coalesce(sum(coalesce(d.final_breakfast,0)+coalesce(d.final_lunch,0)+coalesce(d.final_dinner,0)),0)
        into final_meals
      from public.daily_meal_records d
      where d.period_id=v_period and d.member_id=r.id and not d.cancelled;

      select coalesce(sum(lt.amount),0)
        into deposit
      from public.ledger_transactions lt
      where lt.period_id=v_period and lt.member_id=r.id
        and (
          lt.ledger_type in ('deposit','market_deposit')
          or (
            lt.ledger_type='adjustment'
            and exists(
              select 1 from public.ledger_transactions parent
              where parent.id=lt.parent_transaction_id
                and parent.ledger_type in ('deposit','market_deposit')
            )
          )
        );

      select greatest(0,-coalesce(sum(lt.amount),0))
        into other_expense
      from public.ledger_transactions lt
      where lt.period_id=v_period and lt.member_id=r.id
        and (
          lt.ledger_type='other_expense'
          or (
            lt.ledger_type='adjustment'
            and exists(
              select 1 from public.ledger_transactions parent
              where parent.id=lt.parent_transaction_id
                and parent.ledger_type='other_expense'
            )
          )
        );

      meal_cost:=round(final_meals*v_rate,2);

      select round(coalesce(sum(lt.amount),0)-meal_cost,2)
        into balance
      from public.ledger_transactions lt
      where lt.period_id=v_period and lt.member_id=r.id;

      if exists(
        select 1 from public.daily_meal_records d
        where d.period_id=v_period and d.member_id=r.id and not d.cancelled
          and (
            coalesce(d.planned_breakfast,0)>0 or coalesce(d.planned_lunch,0)>0 or coalesce(d.planned_dinner,0)>0
            or coalesce(d.actual_breakfast,0)>0 or coalesce(d.actual_lunch,0)>0 or coalesce(d.actual_dinner,0)>0
            or coalesce(d.final_breakfast,0)>0 or coalesce(d.final_lunch,0)>0 or coalesce(d.final_dinner,0)>0
          )
      ) then
        meal_activity:='এই মাসে মিল আছে';
      else
        meal_activity:='এই মাসে মিল নেই';
      end if;
    end if;

    membership_id:=r.id;
    member_name:=r.full_name;
    member_status:=r.status;
    role:=r.role;
    return next;
  end loop;
end;
$$;

grant execute on function public.get_member_directory_v2() to authenticated;

-- ------------------------------------------------
-- 2) Stable running-period context
-- Avoids maybeSingle() failures when legacy data contains more
-- than one running period. The response exposes the count so UI/QA
-- can flag the data-integrity condition instead of crashing.
-- ------------------------------------------------
create or replace function public.get_running_period_context()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare
  v_hostel uuid;
  v_period public.monthly_periods;
  v_count integer;
begin
  perform private.assert_authenticated();
  v_hostel:=private.current_hostel_id(true);
  if v_hostel is null then
    raise exception using message='আপনি কোনো মেসের সদস্য নন।';
  end if;

  select count(*) into v_count
  from public.monthly_periods mp
  where mp.hostel_id=v_hostel and mp.status='running';

  select * into v_period
  from public.monthly_periods mp
  where mp.hostel_id=v_hostel and mp.status='running'
  order by mp.start_date desc,mp.created_at desc
  limit 1;

  return jsonb_build_object(
    'period',case when v_period.id is null then null else jsonb_build_object(
      'id',v_period.id,
      'label',v_period.label,
      'start_date',v_period.start_date,
      'end_date',v_period.end_date,
      'status',v_period.status
    ) end,
    'running_period_count',v_count,
    'has_multiple_running_periods',v_count>1,
    'today',private.current_local_date(v_hostel)
  );
end;
$$;

grant execute on function public.get_running_period_context() to authenticated;

-- ------------------------------------------------
-- 3) Manager/assistant Khala period loader
-- ------------------------------------------------
create or replace function public.get_khala_entry_periods_v2()
returns table(
  period_id uuid,
  label text,
  start_date date,
  end_date date,
  is_current boolean,
  permission_reason text
)
language sql
stable
security definer
set search_path=public,pg_catalog
as $$
  with ctx as (
    select
      private.current_hostel_id(true) as hostel_id,
      private.current_membership_id(true) as actor_id
  )
  select
    mp.id,
    mp.label,
    mp.start_date,
    mp.end_date,
    (mp.status='running') as is_current,
    case
      when mp.status='running' then 'বর্তমান মাস'
      else 'আগের মাসের খালার টাকা (১৫ দিন পর্যন্ত)'
    end
  from public.monthly_periods mp
  cross join ctx
  where mp.hostel_id=ctx.hostel_id
    and (
      (
        mp.status='running'
        and (
          mp.primary_manager_membership_id=ctx.actor_id
          or exists(
            select 1
            from public.period_assistant_managers pam
            where pam.period_id=mp.id and pam.membership_id=ctx.actor_id
          )
        )
      )
      or
      (
        mp.status='archived'
        and mp.manager_at_close_membership_id=ctx.actor_id
        and private.current_local_date(ctx.hostel_id)<=((date_trunc('month',mp.start_date)::date + interval '1 month 14 days')::date)
      )
    )
  order by case when mp.status='running' then 0 else 1 end,mp.end_date desc;
$$;

grant execute on function public.get_khala_entry_periods_v2() to authenticated;

-- ------------------------------------------------
-- 4) Read-only month close preflight
-- ------------------------------------------------
create or replace function public.get_month_close_preflight()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare
  v_hostel uuid;
  v_actor uuid;
  v_period public.monthly_periods;
  v_today date;
  v_future_requests integer:=0;
  v_overlap_pairs integer:=0;
  v_active_members integer:=0;
  v_running_count integer:=0;
begin
  perform private.assert_authenticated();
  v_hostel:=private.current_hostel_id(true);
  v_actor:=private.current_membership_id(true);
  if v_hostel is null or v_actor is null then
    raise exception using message='মেসের সক্রিয় সদস্য হওয়া প্রয়োজন।';
  end if;

  select count(*) into v_running_count
  from public.monthly_periods mp
  where mp.hostel_id=v_hostel and mp.status='running';

  select * into v_period
  from public.monthly_periods mp
  where mp.hostel_id=v_hostel and mp.status='running'
  order by mp.start_date desc,mp.created_at desc
  limit 1;

  select count(*) into v_active_members
  from public.hostel_memberships hm
  where hm.hostel_id=v_hostel and hm.status='active';

  if v_period.id is not null then
    v_today:=private.current_local_date(v_hostel);
    select count(*) into v_future_requests
    from public.meal_requests mr
    where mr.period_id=v_period.id
      and mr.status in ('submitted','approved')
      and mr.end_date>v_today;

    select count(*) into v_overlap_pairs
    from public.meal_requests a
    join public.meal_requests b
      on b.id>a.id
     and b.member_id=a.member_id
     and b.period_id=a.period_id
     and b.request_type=a.request_type
     and a.status in ('submitted','approved')
     and b.status in ('submitted','approved')
     and a.request_type='normal'
     and a.start_date<=b.end_date
     and b.start_date<=a.end_date
    where a.period_id=v_period.id;
  else
    v_today:=private.current_local_date(v_hostel);
  end if;

  if v_period.id is null or v_period.primary_manager_membership_id<>v_actor then
    raise exception using message='শুধু বর্তমান প্রধান ম্যানেজার এই preflight দেখতে পারবেন।';
  end if;

  return jsonb_build_object(
    'today',v_today,
    'running_period_count',v_running_count,
    'period',jsonb_build_object('id',v_period.id,'label',v_period.label,'start_date',v_period.start_date,'end_date',v_period.end_date),
    'active_member_count',v_active_members,
    'future_active_request_count',v_future_requests,
    'overlap_pair_count',v_overlap_pairs,
    'can_close',v_period.id is not null and v_period.primary_manager_membership_id=v_actor
  );
end;
$$;

grant execute on function public.get_month_close_preflight() to authenticated;

-- ------------------------------------------------
-- 5) Harden new-month creation against duplicate running periods
-- Keep the original V2.0.2 behavior otherwise unchanged.
-- ------------------------------------------------
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
  v_assistant record;
begin
  v_hostel:=private.current_hostel_id(true);
  v_actor:=private.current_membership_id(true);

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
  order by end_date desc
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
    raise exception using message=format('নতুন মাসের শুরুর তারিখ অবশ্যই %s হতে হবে।',to_char(v_required_start,'DD Mon YYYY'));
  end if;

  if private.current_local_date(v_hostel)<p_start_date then
    raise exception using message='নতুন মাসের শুরুর তারিখ এখনও আসেনি।';
  end if;
  if p_end_date<p_start_date then
    raise exception using message='শেষ তারিখ শুরুর তারিখের আগে হতে পারবে না।';
  end if;

  select coalesce(max(calendar_month_sequence),0) into v_count
  from public.monthly_periods mp
  where mp.hostel_id=v_hostel
    and extract(year from mp.start_date)=extract(year from p_start_date)
    and extract(month from mp.start_date)=extract(month from p_start_date);

  v_label:=private.period_label_for_sequence(p_start_date,v_count+1);
  v_new_end:=greatest(p_end_date,private.current_local_date(v_hostel));

  insert into public.monthly_periods(
    hostel_id,label,start_date,end_date,status,
    manager_at_start_membership_id,primary_manager_membership_id,calendar_month_sequence
  ) values(
    v_hostel,v_label,p_start_date,v_new_end,'running',v_actor,v_actor,v_count+1
  ) returning id into v_new_id;

  if v_old.primary_manager_membership_id=v_actor
     and v_old.manager_at_close_membership_id=v_actor then
    for v_assistant in
      select pam.membership_id
      from public.period_assistant_managers pam
      join public.hostel_memberships hm on hm.id=pam.membership_id
      where pam.period_id=v_old.id and hm.hostel_id=v_hostel and hm.status='active'
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
    'carried_assistants',v_old.primary_manager_membership_id=v_actor
  );
end;
$$;

commit;

-- ================================================================
-- END STABILIZATION-01
-- ================================================================
