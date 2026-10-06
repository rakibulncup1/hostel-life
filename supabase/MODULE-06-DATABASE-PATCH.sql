-- Hostel Life Module 06 database patch
-- Safe market-credit reversal for repeated manager edits/voids.
-- Run once in Supabase SQL Editor before testing Module 06 manager market corrections.

begin;

create or replace function public.manager_update_market_entry(
  p_market_entry_id uuid,
  p_entry_date date,
  p_buyer_membership_id uuid,
  p_items jsonb,
  p_credit_to_buyer boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_actor uuid;
  v_hostel uuid;
  v_old public.market_entries;
  v_new_total numeric(14,2) := 0;
  v_new_period uuid;
  v_credit record;
  x record;
begin
  perform private.assert_authenticated();
  v_actor := private.current_membership_id(true);
  v_hostel := private.current_hostel_id(true);

  if v_actor is null or not private.is_manager(v_hostel) then
    raise exception using message='এই বাজার এন্ট্রি পরিবর্তন করার জন্য ম্যানেজার অনুমতি প্রয়োজন।';
  end if;

  select * into v_old
  from public.market_entries
  where id=p_market_entry_id
  for update;

  if v_old.id is null then
    raise exception using message='বাজার এন্ট্রি পাওয়া যায়নি।';
  end if;

  if not private.can_manage_period(v_old.period_id) then
    raise exception using message='পুরোনো মাসের বাজার এন্ট্রি সম্পাদনের অনুমতি নেই।';
  end if;

  v_new_period := private.period_for_hostel_date(v_hostel,p_entry_date);
  if v_new_period is null or not private.can_manage_period(v_new_period) then
    raise exception using message='নতুন তারিখের মাস সম্পাদনের অনুমতি নেই।';
  end if;

  perform private.assert_membership(p_buyer_membership_id,v_hostel,false);

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception using message='কমপক্ষে একটি বাজারের আইটেম দিতে হবে।';
  end if;

  for x in select value from jsonb_array_elements(p_items) loop
    if nullif(trim(x.value->>'item_name'),'') is null then
      raise exception using message='প্রতিটি বাজার আইটেমের নাম দিতে হবে।';
    end if;

    if (x.value->>'amount') is null then
      raise exception using message='বাজারের amount সঠিক নয়।';
    end if;

    begin
      if (x.value->>'amount')::numeric < 0 then
        raise exception using message='বাজারের amount সঠিক নয়।';
      end if;
    exception
      when invalid_text_representation then
        raise exception using message='বাজারের amount সঠিক নয়।';
    end;
  end loop;

  select coalesce(sum(x.amount),0)
    into v_new_total
  from jsonb_to_recordset(p_items) as x(item_name text,quantity text,amount numeric);

  -- Reverse every still-active market deposit associated with this market.
  -- A reversal points to the exact market-deposit row via parent_transaction_id,
  -- so an old credit is never reversed a second time.
  for v_credit in
    select lt.id, lt.amount, lt.hostel_id, lt.period_id, lt.member_id
    from public.ledger_transactions lt
    where lt.reference_type='market_entry'
      and lt.reference_id=p_market_entry_id
      and lt.ledger_type='market_deposit'
      and not exists (
        select 1
        from public.ledger_transactions rev
        where rev.parent_transaction_id=lt.id
          and rev.reference_type in ('market_credit_reversal','market_void_reversal')
      )
    for update
  loop
    if coalesce(v_credit.amount,0) <> 0 then
      insert into public.ledger_transactions(
        hostel_id,period_id,member_id,ledger_type,ledger_group,amount,
        reference_type,reference_id,parent_transaction_id,description,created_by
      ) values(
        v_credit.hostel_id,
        v_credit.period_id,
        v_credit.member_id,
        'adjustment',
        case when -v_credit.amount > 0 then 'deposit' else 'expense' end,
        -v_credit.amount,
        'market_credit_reversal',
        v_old.id,
        v_credit.id,
        coalesce(nullif(trim(p_reason),''),'বাজার এন্ট্রি সংশোধন'),
        v_actor
      );
    end if;
  end loop;

  delete from public.market_items where market_entry_id=p_market_entry_id;

  update public.market_entries
     set period_id=v_new_period,
         buyer_membership_id=p_buyer_membership_id,
         entry_date=p_entry_date,
         total_amount=v_new_total,
         credit_to_buyer=p_credit_to_buyer,
         status='active',
         voided_by=null,
         voided_at=null,
         void_reason=null,
         updated_at=now()
   where id=p_market_entry_id;

  insert into public.market_items(
    market_entry_id,serial_no,item_name,quantity,amount
  )
  select
    p_market_entry_id,
    x.ord::int,
    trim(x.value->>'item_name'),
    coalesce(x.value->>'quantity',''),
    (x.value->>'amount')::numeric
  from jsonb_array_elements(p_items) with ordinality as x(value,ord);

  if p_credit_to_buyer and v_new_total>0 then
    insert into public.ledger_transactions(
      hostel_id,period_id,member_id,ledger_type,ledger_group,amount,
      reference_type,reference_id,description,created_by
    ) values(
      v_hostel,
      v_new_period,
      p_buyer_membership_id,
      'market_deposit',
      'deposit',
      v_new_total,
      'market_entry',
      p_market_entry_id,
      'সংশোধনের পর বাজারের টাকা ডিপোজিট হিসেবে যুক্ত',
      v_actor
    );
  end if;

  return jsonb_build_object(
    'market_entry_id',p_market_entry_id,
    'total_amount',v_new_total,
    'status','active'
  );
end;
$$;

create or replace function public.manager_void_market_entry(
  p_market_entry_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_actor uuid;
  v_hostel uuid;
  v_old public.market_entries;
  v_credit record;
begin
  perform private.assert_authenticated();
  v_actor := private.current_membership_id(true);
  v_hostel := private.current_hostel_id(true);

  if v_actor is null or not private.is_manager(v_hostel) then
    raise exception using message='এই বাজার বাতিল করার জন্য ম্যানেজার অনুমতি প্রয়োজন।';
  end if;

  select * into v_old
  from public.market_entries
  where id=p_market_entry_id
  for update;

  if v_old.id is null then
    raise exception using message='বাজার এন্ট্রি পাওয়া যায়নি।';
  end if;

  if not private.can_manage_period(v_old.period_id) then
    raise exception using message='এই বাজার বাতিল করার অনুমতি নেই।';
  end if;

  if v_old.status='void' then
    raise exception using message='বাজার এন্ট্রিটি ইতিমধ্যে বাতিল।';
  end if;

  if p_reason is null or length(trim(p_reason))<1 then
    raise exception using message='বাতিল করার কারণ লিখতে হবে।';
  end if;

  for v_credit in
    select lt.id, lt.amount, lt.hostel_id, lt.period_id, lt.member_id
    from public.ledger_transactions lt
    where lt.reference_type='market_entry'
      and lt.reference_id=p_market_entry_id
      and lt.ledger_type='market_deposit'
      and not exists (
        select 1
        from public.ledger_transactions rev
        where rev.parent_transaction_id=lt.id
          and rev.reference_type in ('market_credit_reversal','market_void_reversal')
      )
    for update
  loop
    if coalesce(v_credit.amount,0) <> 0 then
      insert into public.ledger_transactions(
        hostel_id,period_id,member_id,ledger_type,ledger_group,amount,
        reference_type,reference_id,parent_transaction_id,description,created_by
      ) values(
        v_credit.hostel_id,
        v_credit.period_id,
        v_credit.member_id,
        'adjustment',
        case when -v_credit.amount > 0 then 'deposit' else 'expense' end,
        -v_credit.amount,
        'market_void_reversal',
        v_old.id,
        v_credit.id,
        trim(p_reason),
        v_actor
      );
    end if;
  end loop;

  update public.market_entries
     set status='void',
         voided_by=v_actor,
         voided_at=now(),
         void_reason=trim(p_reason),
         updated_at=now()
   where id=p_market_entry_id;

  return jsonb_build_object(
    'market_entry_id',p_market_entry_id,
    'status','void'
  );
end;
$$;

commit;
