-- Run41: same-hostel account history and complete archived monthly report.
-- SECURITY DEFINER RPCs validate the caller's active hostel and requested period.
-- No table RLS policy is widened and no personal data is returned across hostels.

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
begin
  perform private.assert_signed_in();
  if v_hostel is null then return '[]'::jsonb; end if;

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
    'created_at',l.created_at,'updated_at',l.updated_at,'source','ledger',
    'created_by',l.created_by,'created_by_name',NULLIF(pg_catalog.btrim(creator.full_name),''),
    'updated_by',l.updated_by,'updated_by_name',NULLIF(pg_catalog.btrim(editor.full_name),'')
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
  left join public.profiles p on p.id=m.user_id
  left join public.profiles creator on creator.id=l.created_by
  left join public.profiles editor on editor.id=l.updated_by;
  return v_result;
end $$;

REVOKE ALL ON FUNCTION public.get_account_history_v2(uuid,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_history_v2(uuid,uuid,integer) TO authenticated;

create or replace function public.get_archived_month_detail(p_period_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype; v_markets jsonb; v_meals jsonb; v_ledger jsonb; v_members jsonb; v_khala jsonb; v_deposit numeric; v_market numeric; v_other numeric; v_meals_total numeric; v_rate numeric;
begin
  perform private.assert_signed_in(); select * into v_period from public.monthly_periods where id=p_period_id and hostel_id=v_hostel and status in ('closed','archived');
  if not found then raise exception using message='আর্কাইভ করা মাসটি পাওয়া যায়নি।',errcode='P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',me.id,'market_entry_id',me.id,'entry_date',me.entry_date,'member_name',coalesce(p.full_name,me.buyer_name_snapshot,'সদস্য'),'buyer_name',coalesce(p.full_name,me.buyer_name_snapshot,'সদস্য'),'total',me.total_amount,'total_amount',me.total_amount,'status',me.status,'credit_to_buyer',me.credit_to_buyer,
    'items',coalesce((select jsonb_agg(jsonb_build_object('name',i.item_name,'item_name',i.item_name,'quantity',i.quantity,'amount',i.amount,'serial_no',i.serial_no) order by i.serial_no) from public.market_entry_items i where i.market_entry_id=me.id),'[]'::jsonb)) order by me.entry_date desc),'[]'::jsonb)
   into v_markets from public.market_entries me left join public.hostel_memberships m on m.id=me.buyer_membership_id left join public.profiles p on p.id=m.user_id where me.period_id=v_period.id;
  select coalesce(jsonb_agg(jsonb_build_object('date',x.meal_date,'meal_date',x.meal_date,'status',x.status,
      'breakfast',x.breakfast,'lunch',x.lunch,'dinner',x.dinner) order by x.meal_date),'[]'::jsonb)
   into v_meals
   from (
     select d.id,d.meal_date,d.status,
       coalesce(sum(coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0)),0) as breakfast,
       coalesce(sum(coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0)),0) as lunch,
       coalesce(sum(coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0)),0) as dinner
     from public.daily_meal_days d
     left join public.daily_meal_records r on r.daily_meal_day_id=d.id and not r.cancelled
     where d.period_id=v_period.id
     group by d.id,d.meal_date,d.status
   ) x;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'transaction_id',l.id,'member_id',l.member_id,'member_name',coalesce(p.full_name,l.member_name_snapshot,'সদস্য'),'ledger_type',l.ledger_type,'transaction_type',l.ledger_type,'amount',l.amount,'entry_date',l.entry_date,'description',l.description,'status',l.status,'created_at',l.created_at) order by l.entry_date desc,l.created_at desc),'[]'::jsonb)
   into v_ledger from public.ledger_transactions l left join public.hostel_memberships m on m.id=l.member_id left join public.profiles p on p.id=m.user_id where l.period_id=v_period.id;
  select coalesce(sum(amount),0) into v_deposit from public.ledger_transactions where period_id=v_period.id and status='active' and ledger_type in ('deposit','market_deposit') and amount>0;
  select coalesce(sum(total_amount),0) into v_market from public.market_entries where period_id=v_period.id and status='active';
  select coalesce(sum(abs(least(amount,0))),0) into v_other from public.ledger_transactions where period_id=v_period.id and status='active' and ledger_type='other_expense';
  v_other:=v_other+(select coalesce(sum(amount),0) from public.khala_money_entries where period_id=v_period.id and status='active');
  select coalesce(sum(coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0)+coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0)+coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0)),0)
   into v_meals_total from public.daily_meal_records r join public.daily_meal_days d on d.id=r.daily_meal_day_id where r.period_id=v_period.id and d.status='finalized' and not r.cancelled;
  v_rate:=case when v_meals_total=0 then 0 else round(v_market/v_meals_total,4) end;

  -- Use the exact same accounting helper as the live full monthly report.
  -- Membership and profile rows remain restricted to the caller's hostel.
  select coalesce(jsonb_agg(
    jsonb_build_object('membership_id',hm.id,'member_id',hm.id,
      'member_name',coalesce(nullif(pg_catalog.btrim(p.full_name),''),'সদস্য'),
      'member_status',hm.status)
    || coalesce(private.member_financials(v_period.id,hm.id),'{}'::jsonb)
    order by p.full_name),'[]'::jsonb)
    into v_members
    from public.hostel_memberships hm
    join public.profiles p on p.id=hm.user_id
    where hm.hostel_id=v_hostel and hm.status in ('active','inactive') and not p.is_blocked
      and hm.created_at < ((v_period.end_date + 1)::timestamp at time zone 'Asia/Dhaka');

  select coalesce(jsonb_agg(jsonb_build_object(
    'entry_id',k.id,'id',k.id,'member_id',k.member_id,
    'member_name',coalesce(nullif(pg_catalog.btrim(p.full_name),''),k.member_name_snapshot,'সদস্য'),
    'amount',k.amount,'entry_date',k.payment_date,'payment_date',k.payment_date,
    'description',k.description,'status',k.status,'void_reason',k.void_reason,
    'created_at',k.created_at
  ) order by k.payment_date,k.created_at),'[]'::jsonb)
    into v_khala
    from public.khala_money_entries k
    left join public.hostel_memberships hm on hm.id=k.member_id and hm.hostel_id=v_hostel
    left join public.profiles p on p.id=hm.user_id
    where k.hostel_id=v_hostel and k.period_id=v_period.id;

  return jsonb_build_object('id',v_period.id,'period_id',v_period.id,'hostel_id',v_hostel,'label',v_period.label,'start_date',v_period.start_date,'end_date',v_period.end_date,'status',v_period.status,
    'markets',v_markets,'meals',v_meals,'ledger',v_ledger,'members',v_members,'khala_entries',v_khala,
    'manager_at_close_name',(select nullif(pg_catalog.btrim(closer.full_name),'') from public.profiles closer where closer.id=v_period.closed_by),
    'total_deposit',v_deposit,'total_market_expense',v_market,'total_other_expense',v_other,'total_meals',v_meals_total,'meal_rate',v_rate,'fund_remaining',v_deposit-v_market-v_other);
end $$;

REVOKE ALL ON FUNCTION public.get_archived_month_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_archived_month_detail(uuid) TO authenticated;
