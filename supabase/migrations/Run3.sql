-- Hostel Life UI/accounting correction (incremental migration)
-- Run after the existing Master SQL and 02_MEAL_WORKFLOW_FIX_MIGRATION.sql.
-- Does not drop tables, member records, meal records, or financial entries.
-- Purpose:
--   1) Make Dashboard summary include market + other expense + Khala payout.
--   2) Keep Khala money entirely outside any individual member's ledger/history.
--   3) Return period_id in Khala history so the manager list can filter the month.
--   4) Keep manager authorization and audit trail for Khala operations.

begin;

-- Keep the member balance function isolated from Khala payments. Legacy Khala
-- rows may still have member_id populated, so this change also corrects historic
-- member balances without deleting any data.
create or replace function private.member_financials(p_period_id uuid,p_membership_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_hostel uuid;
  v_member_name text;
  v_meals numeric := 0;
  v_all_meals numeric := 0;
  v_market numeric := 0;
  v_deposit numeric := 0;
  v_market_deposit numeric := 0;
  v_other numeric := 0;
  v_adjustment numeric := 0;
  v_rate numeric := 0;
  v_balance numeric := 0;
begin
  select mp.hostel_id into v_hostel from public.monthly_periods mp where mp.id=p_period_id;
  select coalesce(pr.full_name,m.member_name_snapshot,'সদস্য') into v_member_name
  from public.hostel_memberships hm
  left join public.profiles pr on pr.id=hm.user_id
  left join (select member_id,max(member_name_snapshot) member_name_snapshot from public.daily_meal_records where period_id=p_period_id group by member_id) m on m.member_id=hm.id
  where hm.id=p_membership_id;

  select coalesce(sum(
    coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0) +
    coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0) +
    coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0)
  ),0) into v_meals
  from public.daily_meal_records r join public.daily_meal_days d on d.id=r.daily_meal_day_id
  where r.period_id=p_period_id and r.member_id=p_membership_id and not r.cancelled and d.status='finalized';

  select coalesce(sum(
    coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0) +
    coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0) +
    coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0)
  ),0) into v_all_meals
  from public.daily_meal_records r join public.daily_meal_days d on d.id=r.daily_meal_day_id
  where r.period_id=p_period_id and not r.cancelled and d.status='finalized';

  select coalesce(sum(me.total_amount),0) into v_market
  from public.market_entries me where me.period_id=p_period_id and me.status='active';

  select
    coalesce(sum(case when l.ledger_type='deposit' and l.amount>0 then l.amount else 0 end),0),
    coalesce(sum(case when l.ledger_type='market_deposit' and l.amount>0 then l.amount else 0 end),0),
    coalesce(sum(case when l.ledger_type='other_expense' then abs(least(l.amount,0)) else 0 end),0),
    coalesce(sum(case when l.ledger_type='adjustment' then l.amount else 0 end),0)
  into v_deposit,v_market_deposit,v_other,v_adjustment
  from public.ledger_transactions l
  where l.period_id=p_period_id and l.member_id=p_membership_id and l.status='active';

  if v_all_meals>0 then v_rate:=v_market/v_all_meals; end if;
  -- Khala's payment is a mess-level cash outflow, never a member's expense.
  v_balance:=v_deposit+v_market_deposit+v_adjustment-(v_meals*v_rate)-v_other;
  return jsonb_build_object(
    'name',v_member_name,'member_name',v_member_name,'meals',v_meals,'final_meals',v_meals,
    'deposit',v_deposit+v_market_deposit,'cash_deposit',v_deposit,'market_deposit',v_market_deposit,
    'meal_cost',round(v_meals*v_rate,2),'other_expense',v_other,'khala_money',0,
    'balance',round(v_balance,2),'meal_rate',round(v_rate,4),'total_market',v_market,
    'khala_excluded_from_member_balance',true
  );
end $$;

-- ---------------------------------------------------------------------------
-- 1. Dashboard summary: Frontend expects total_expense and fund_remaining, and
--    the earlier RPC exposed only total_market/other_expense. Return both sets.
-- ---------------------------------------------------------------------------
create or replace function public.get_dashboard_data()
returns jsonb language plpgsql security definer set search_path = '' as $$
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
end $$;
-- ---------------------------------------------------------------------------
-- 2. Khala money must be a mess-level expense, not a member expense.
--    Keep the old RPC signature for compatibility; ignore p_member_id and
--    always store member_id=NULL for newly created entries.
-- ---------------------------------------------------------------------------
create or replace function public.manager_add_khala_money_for_period(
  p_period_id uuid,
  p_member_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_description text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_period public.monthly_periods%rowtype;
  v_row public.khala_money_entries%rowtype;
begin
  perform private.assert_signed_in();
  select * into v_period from public.monthly_periods where id=p_period_id;
  if not found then
    raise exception using message='মাসের তথ্য পাওয়া যায়নি।',errcode='P0002';
  end if;
  perform private.assert_hostel_manager(v_period.hostel_id,v_period.id,false,true);
  if p_amount is null or p_amount<=0 then
    raise exception using message='খালার টাকার পরিমাণ শূন্যের বেশি হতে হবে।',errcode='22023';
  end if;
  if p_payment_date<v_period.start_date or p_payment_date>v_period.end_date then
    raise exception using message='তারিখটি সংশ্লিষ্ট মাসের মধ্যে হতে হবে।',errcode='22023';
  end if;

  insert into public.khala_money_entries(
    hostel_id,period_id,member_id,member_name_snapshot,payment_date,amount,description,created_by
  ) values (
    v_period.hostel_id,v_period.id,null,'খালার পারিশ্রমিক',p_payment_date,round(p_amount,2),
    nullif(btrim(p_description),''),auth.uid()
  ) returning * into v_row;

  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
  values(
    v_period.hostel_id,v_period.id,auth.uid(),'insert:khala_money','খালার টাকা যোগ করা হয়েছে',
    jsonb_build_object('entry_id',v_row.id,'amount',v_row.amount,'payment_date',v_row.payment_date,'accounting_scope','mess')
  );
  return jsonb_build_object('entry_id',v_row.id,'id',v_row.id,'period_id',v_row.period_id,'amount',v_row.amount,'status','active');
end $$;

-- A manager's separate Khala list requires period_id to filter records. Always
-- expose a neutral Khala label and NULL member_id, including for legacy rows
-- that used to be linked to a specific member.
create or replace function public.get_khala_money_history_v2(p_period_id uuid default null,p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_hostel uuid := private.my_hostel_id();
  v_period uuid := p_period_id;
  v_result jsonb;
begin
  perform private.assert_signed_in();
  if not private.can_access_hostel(v_hostel) then
    raise exception using message='এই হিসাব দেখার অনুমতি নেই।',errcode='42501';
  end if;
  if v_period is null then
    select id into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1;
  end if;
  if v_period is not null and not exists(select 1 from public.monthly_periods where id=v_period and hostel_id=v_hostel) then
    raise exception using message='এই মাসের খালার টাকার তথ্য দেখার অনুমতি নেই।',errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'entry_id',k.id,'id',k.id,'hostel_id',k.hostel_id,'period_id',k.period_id,
    'member_id',null,'member_name','খালার পারিশ্রমিক',
    'amount',k.amount,'entry_date',k.payment_date,'payment_date',k.payment_date,
    'description',k.description,'status',k.status,'void_reason',k.void_reason,
    'created_at',k.created_at,'updated_at',k.updated_at
  ) order by k.payment_date desc,k.created_at desc),'[]'::jsonb)
  into v_result
  from (
    select * from public.khala_money_entries
    where hostel_id=v_hostel and (v_period is null or period_id=v_period)
    order by payment_date desc,created_at desc
    limit greatest(1,least(coalesce(p_limit,200),3000))
  ) k;
  return v_result;
end $$;

create or replace function public.get_khala_money_history(p_period_id uuid default null,p_limit integer default 200)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.get_khala_money_history_v2(p_period_id,p_limit)
$$;

-- ---------------------------------------------------------------------------
-- 3. Account history is strictly member-ledger history. Do not union Khala rows
--    into a member's transaction list, even for legacy Khala entries which had
--    a member_id before this migration.
-- ---------------------------------------------------------------------------
create or replace function public.get_account_history_v2(
  p_period_id uuid default null,
  p_member_id uuid default null,
  p_limit integer default 200
)
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
  if v_period is not null and not exists(
    select 1 from public.monthly_periods where id=v_period and hostel_id=v_hostel
  ) then
    raise exception using message='এই মাসের হিসাব দেখার অনুমতি নেই।',errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'transaction_id',l.id,'id',l.id,'member_id',l.member_id,
    'member_name',coalesce(p.full_name,l.member_name_snapshot,'সদস্য'),
    'transaction_type',l.ledger_type,'ledger_type',l.ledger_type,'ledger_group',l.ledger_group,
    'amount',l.amount,'entry_date',l.entry_date,'description',l.description,
    'reference_type',l.reference_type,'reference_id',l.reference_id,'status',l.status,
    'created_at',l.created_at,'updated_at',l.updated_at,'source','ledger'
  ) order by l.entry_date desc,l.created_at desc),'[]'::jsonb)
  into v_result
  from (
    select * from public.ledger_transactions
    where hostel_id=v_hostel and (v_period is null or period_id=v_period)
      and (v_effective_member is null or member_id=v_effective_member)
    order by entry_date desc,created_at desc
    limit greatest(1,least(coalesce(p_limit,200),3000))
  ) l
  left join public.hostel_memberships m on m.id=l.member_id
  left join public.profiles p on p.id=m.user_id;
  return v_result;
end $$;

-- Function grants were established by the Master SQL. Reapply the intended role grants explicitly.
grant execute on function public.get_dashboard_data() to authenticated;
grant execute on function public.manager_add_khala_money_for_period(uuid,uuid,numeric,date,text) to authenticated;
grant execute on function public.get_khala_money_history_v2(uuid,integer) to authenticated;
grant execute on function public.get_khala_money_history(uuid,integer) to authenticated;
grant execute on function public.get_account_history_v2(uuid,uuid,integer) to authenticated;

commit;

-- Optional read-only hint after the migration:
-- select jsonb_pretty(public.get_dashboard_data()->'summary');
-- Khala money is intentionally excluded from get_account_history_v2 and member balances.
