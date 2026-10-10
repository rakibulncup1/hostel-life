-- Hostel Life — FIX-04 targeted backend security patch
-- Purpose: keep get_account_history_v2() manager-aware.
-- No table data is changed. No reset/drop/truncate is performed.
-- Run once after Repair V2.0.2 and before/alongside Frontend FIX-04.

begin;

create or replace function public.get_account_history_v2(
  p_period_id uuid default null,
  p_member_id uuid default null,
  p_limit integer default 200
)
returns table(
  transaction_id uuid,
  member_id uuid,
  member_name text,
  entry_date date,
  amount numeric,
  transaction_type public.ledger_type,
  description text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare
  v_hostel uuid;
  v_period uuid;
  v_current_member uuid;
  v_target_member uuid;
  v_manager boolean;
begin
  perform private.assert_authenticated();
  v_hostel:=private.current_hostel_id(true);
  if v_hostel is null then
    raise exception using message='আপনি কোনো মেসের সদস্য নন।';
  end if;

  v_current_member:=private.current_membership_id(true);
  v_manager:=private.is_manager(v_hostel);

  v_period:=coalesce(
    p_period_id,
    (select id from public.monthly_periods where hostel_id=v_hostel and status='running' order by start_date desc limit 1),
    (select id from public.monthly_periods where hostel_id=v_hostel order by end_date desc limit 1)
  );

  if v_period is null then
    return;
  end if;

  if not exists(select 1 from public.monthly_periods where id=v_period and hostel_id=v_hostel) then
    raise exception using message='নির্বাচিত মাস এই মেসের নয়।';
  end if;

  -- Managers may request one member or the entire period.
  -- Regular members may only request their own account.
  if p_member_id is not null then
    perform private.assert_membership(p_member_id,v_hostel,false);
    if not v_manager and p_member_id is distinct from v_current_member then
      raise exception using message='অন্য সদস্যের ব্যক্তিগত হিসাব দেখার অনুমতি নেই।';
    end if;
    v_target_member:=p_member_id;
  elsif not v_manager then
    v_target_member:=v_current_member;
  else
    v_target_member:=null;
  end if;

  return query
  select
    lt.id,
    lt.member_id,
    p.full_name,
    lt.entry_date,
    lt.amount,
    lt.ledger_type,
    lt.description,
    lt.created_at
  from public.ledger_transactions lt
  join public.hostel_memberships hm on hm.id=lt.member_id
  join public.profiles p on p.id=hm.user_id
  where lt.hostel_id=v_hostel
    and lt.period_id=v_period
    and (v_target_member is null or lt.member_id=v_target_member)
  order by lt.entry_date desc,lt.created_at desc
  limit greatest(1,least(coalesce(p_limit,200),1000));
end;
$$;

grant execute on function public.get_account_history_v2(uuid,uuid,integer) to authenticated;

commit;

-- Read-only verification (run separately if desired):
-- select to_regprocedure('public.get_account_history_v2(uuid,uuid,integer)') as function_present;
