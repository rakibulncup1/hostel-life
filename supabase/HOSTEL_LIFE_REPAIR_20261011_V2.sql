-- HOSTEL LIFE targeted repair / 2026-10-11
-- BACKUP FIRST. Run in SQL Editor as postgres, once, in a transaction.
-- This patch DOES NOT reopen a closed month or remove financial records.
BEGIN;

CREATE OR REPLACE FUNCTION public.change_manager(p_new_membership_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_hostel uuid;
  v_old uuid;
  v_period public.monthly_periods;
  v_new_user uuid;
begin
  perform private.assert_authenticated();
  v_hostel:=private.current_hostel_id(true);
  v_old:=private.current_membership_id(true);

  -- The manager role is a hostel-wide administrative identity even when no period runs.
  IF NOT EXISTS (
    SELECT 1 FROM public.hostel_memberships
    WHERE id=v_old AND hostel_id=v_hostel AND status='active' AND role='manager'
  ) THEN
    RAISE EXCEPTION USING message='শুধু বর্তমান প্রধান ম্যানেজার ম্যানেজার পরিবর্তন করতে পারবেন।';
  END IF;

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE hostel_id=v_hostel AND status='running'
  FOR UPDATE;
  if p_new_membership_id=v_old then
    raise exception using message='নিজেকে আবার ম্যানেজার করার প্রয়োজন নেই।';
  end if;

  select user_id into v_new_user
  from public.hostel_memberships
  where id=p_new_membership_id and hostel_id=v_hostel and status='active';

  if v_new_user is null then
    raise exception using message='নির্বাচিত সদস্য সক্রিয় সদস্য নন।';
  end if;

  update public.hostel_memberships set role='member',updated_at=now() where id=v_old;
  update public.hostel_memberships set role='manager',updated_at=now() where id=p_new_membership_id;

  IF v_period.id IS NOT NULL THEN
    UPDATE public.monthly_periods
       SET primary_manager_membership_id=p_new_membership_id,updated_at=now()
     WHERE id=v_period.id;
  END IF;

  -- Old assistants lose access immediately when primary manager changes.
  IF v_period.id IS NOT NULL THEN
    DELETE FROM public.period_assistant_managers WHERE period_id=v_period.id;
  END IF;

  insert into public.notifications(hostel_id,notification_type,title,body,created_by)
  values(v_hostel,'system','ম্যানেজার পরিবর্তন হয়েছে','মেসের নতুন প্রধান ম্যানেজার নির্ধারণ করা হয়েছে।',p_new_membership_id);

  return jsonb_build_object(
    'old_manager_membership_id',v_old,
    'new_manager_membership_id',p_new_membership_id,
    'new_manager_user_id',v_new_user
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.get_account_history_v2(p_period_id uuid DEFAULT NULL::uuid, p_member_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 200)
 RETURNS TABLE(transaction_id uuid, member_id uuid, member_name text, entry_date date, amount numeric, transaction_type ledger_type, description text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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

  -- Every active hostel member may read the entire hostel ledger.
  -- Write rights remain restricted by separate manager RPCs.
  IF p_member_id IS NOT NULL THEN
    PERFORM private.assert_membership(p_member_id,v_hostel,false);
  END IF;
  v_target_member:=p_member_id;

  return query
  select
    lt.id,
    lt.member_id,
    p.full_name,
    lt.entry_date,
    CASE WHEN lt.ledger_type IN ('deposit','other_expense') AND lt.parent_transaction_id IS NULL
      THEN lt.amount + COALESCE((SELECT SUM(adj.amount) FROM public.ledger_transactions adj
        WHERE adj.parent_transaction_id=lt.id AND adj.ledger_type='adjustment'),0)
      ELSE lt.amount END AS amount,
    lt.ledger_type,
    lt.description,
    lt.created_at
  from public.ledger_transactions lt
  join public.hostel_memberships hm on hm.id=lt.member_id
  join public.profiles p on p.id=hm.user_id
  where lt.hostel_id=v_hostel
    and lt.period_id=v_period
    and (v_target_member is null or lt.member_id=v_target_member)
    -- Adjustment rows are audit records; their amounts are incorporated in the original ledger row.
    and NOT (lt.ledger_type='adjustment' AND lt.parent_transaction_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.ledger_transactions original
        WHERE original.id=lt.parent_transaction_id AND original.ledger_type IN ('deposit','other_expense')))
  order by lt.entry_date desc,lt.created_at desc
  limit greatest(1,least(coalesce(p_limit,200),1000));
end;
$function$;


-- Preserve the manager-only permission for transaction edits.
-- Ledger changes remain adjustment rows; no historical entries are overwritten.
COMMIT;


-- HOSTEL LIFE v2 targeted repairs. Database snapshot: 2026-10-11.
-- BACK UP database before applying. This is not a full Super Admin installation.
-- Existing closed periods are not reopened. Do not use this patch to bypass archived-month permissions.
BEGIN;

CREATE OR REPLACE FUNCTION public.manager_adjust_transaction(p_transaction_id uuid, p_new_amount numeric, p_description text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$;
declare v_actor uuid; v_orig public.ledger_transactions; v_current numeric; v_delta numeric; v_id uuid;
begin
  perform private.assert_authenticated(); v_actor:=private.current_membership_id(true);
  select * into v_orig from public.ledger_transactions where id=p_transaction_id and ledger_type in ('deposit','other_expense') and parent_transaction_id is null for update;
  if v_orig.id is null then raise exception using message='এই লেনদেন সরাসরি সংশোধন করা যাবে না।'; end if;
  if v_orig.hostel_id IS DISTINCT FROM private.current_hostel_id(true) OR NOT private.is_manager(v_orig.hostel_id) OR NOT private.can_correct_period(v_orig.period_id) then raise exception using message='এই লেনদেন সংশোধনের অনুমতি নেই।'; end if;
  select coalesce(sum(amount),0) into v_current from public.ledger_transactions where id=p_transaction_id or parent_transaction_id=p_transaction_id;
  if v_orig.ledger_type='deposit' and (p_new_amount is null or p_new_amount<0) then raise exception using message='ডিপোজিটের সংশোধিত পরিমাণ শূন্য বা তার বেশি হতে হবে।'; end if;
  if v_orig.ledger_type='other_expense' and (p_new_amount is null or p_new_amount>0) then raise exception using message='খরচের সংশোধিত পরিমাণ শূন্য বা ঋণাত্মক হতে হবে।'; end if;
  v_delta:=p_new_amount-v_current;
  if v_delta=0 then return p_transaction_id; end if;
  insert into public.ledger_transactions(hostel_id,period_id,member_id,ledger_type,ledger_group,amount,reference_type,reference_id,parent_transaction_id,entry_date,description,created_by)
  values(v_orig.hostel_id,v_orig.period_id,v_orig.member_id,'adjustment',case when v_delta>0 then 'deposit' else 'expense' end,v_delta,'adjustment',v_orig.id,v_orig.id,v_orig.entry_date,nullif(trim(coalesce(p_description,'ম্যানেজার সংশোধন')),''),v_actor)
  returning id into v_id;
  return v_id;
end;
$function$


CREATE OR REPLACE FUNCTION public.create_market_entry(p_entry_date date, p_buyer_membership_id uuid, p_items jsonb, p_credit_to_buyer boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$;
declare
  v_creator uuid;
  v_hostel uuid;
  v_period uuid;
  v_market_id uuid;
  v_total numeric(14,2):=0;
  v_can_operate boolean:=false;
  v_buyer_status public.membership_status;
  x record;
  v_notification uuid;
begin
  perform private.assert_authenticated();
  v_creator:=private.current_membership_id(true); v_hostel:=private.current_hostel_id(true);
  if v_creator is null then raise exception using message='সক্রিয় সদস্য হওয়া প্রয়োজন।'; end if;
  if p_entry_date>private.current_local_date(v_hostel) then raise exception using message='বাজারের তারিখ ভবিষ্যতের হতে পারবে না।'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception using message='কমপক্ষে একটি বাজারের আইটেম দিতে হবে।'; end if;

  select status into v_buyer_status from public.hostel_memberships where id=p_buyer_membership_id and hostel_id=v_hostel;
  if v_buyer_status is distinct from 'active'::public.membership_status then raise exception using message='বাজার যার নামে হবে সেই সদস্য পাওয়া যায়নি।'; end if;

  v_period:=private.period_for_hostel_date(v_hostel,p_entry_date);
  if v_period is null then raise exception using message='এই তারিখ কোনো মেস মাসের মধ্যে নেই।'; end if;
  v_can_operate:=private.can_manage_period(v_period);

  if not v_can_operate and p_buyer_membership_id<>v_creator then raise exception using message='সাধারণ সদস্য শুধু নিজের নামে বাজার দিতে পারবেন।'; end if;
  if not v_can_operate and not exists(select 1 from public.monthly_periods where id=v_period and status='running') then raise exception using message='সাধারণ সদস্য শুধু চলমান মাসে বাজার দিতে পারবেন।'; end if;
  if not v_can_operate and not exists(select 1 from public.monthly_periods where id=v_period and status='running') then raise exception using message='সাধারণ সদস্য শুধু চলমান মাসে বাজার দিতে পারবেন।'; end if;
  if v_can_operate is false and p_buyer_membership_id<>v_creator then raise exception using message='এই সদস্যের নামে বাজার দেওয়ার অনুমতি নেই।'; end if;
  if v_can_operate and not exists(select 1 from public.monthly_periods where id=v_period) then raise exception using message='মাসটি পাওয়া যায়নি।'; end if;

  for x in select value from jsonb_array_elements(p_items) loop
    if nullif(trim(x.value->>'item_name'),'') is null then raise exception using message='প্রতিটি বাজার আইটেমের নাম দিতে হবে।'; end if;
    begin
      if coalesce((x.value->>'amount')::numeric,-1)<0 then raise exception using message='বাজারের amount সঠিক নয়।'; end if;
    exception when invalid_text_representation then raise exception using message='বাজারের amount সঠিক নয়.'; end;
  end loop;

  select coalesce(sum(x.amount),0) into v_total from jsonb_to_recordset(p_items) as x(item_name text,quantity text,amount numeric);

  insert into public.market_entries(hostel_id,period_id,buyer_membership_id,entry_date,total_amount,credit_to_buyer,status,created_by)
  values(v_hostel,v_period,p_buyer_membership_id,p_entry_date,v_total,p_credit_to_buyer,'active',v_creator)
  returning id into v_market_id;

  insert into public.market_items(market_entry_id,serial_no,item_name,quantity,amount)
  select v_market_id,x.ord::int,trim(x.value->>'item_name'),coalesce(x.value->>'quantity',''),(x.value->>'amount')::numeric
  from jsonb_array_elements(p_items) with ordinality x(value,ord);

  if p_credit_to_buyer and v_total>0 then
    insert into public.ledger_transactions(hostel_id,period_id,member_id,ledger_type,ledger_group,amount,reference_type,reference_id,entry_date,description,created_by)
    values(v_hostel,v_period,p_buyer_membership_id,'market_deposit','deposit',v_total,'market_entry',v_market_id,p_entry_date,'বাজারের টাকা ডিপোজিট হিসেবে যুক্ত',v_creator);
  end if;

  insert into public.notifications(hostel_id,notification_type,title,body,reference_type,reference_id,created_by)
  values(v_hostel,'market_entry','নতুন বাজার এন্ট্রি',
    (select p.full_name from public.profiles p join public.hostel_memberships hm on hm.user_id=p.id where hm.id=p_buyer_membership_id)
    ||' '||to_char(p_entry_date,'DD Mon YYYY')||' তারিখে ৳'||to_char(v_total,'FM999999990.00')||' বাজার করেছে।',
    'market_entry',v_market_id,v_creator)
  returning id into v_notification;

  return jsonb_build_object('market_entry_id',v_market_id,'total_amount',v_total,'credit_to_buyer',p_credit_to_buyer,'status','active');
end;
$function$


CREATE OR REPLACE FUNCTION public.manager_update_market_entry(p_market_entry_id uuid, p_entry_date date, p_buyer_membership_id uuid, p_items jsonb, p_credit_to_buyer boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$;
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

  if v_old.id is null OR v_old.hostel_id IS DISTINCT FROM v_hostel OR v_old.status <> 'active' then
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
        reference_type,reference_id,parent_transaction_id,entry_date,description,created_by
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
      reference_type,reference_id,entry_date,description,created_by
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
$function$


-- Only authenticated members can call these SECURITY DEFINER RPCs.
REVOKE ALL ON FUNCTION public.manager_adjust_transaction(uuid,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_adjust_transaction(uuid,numeric,text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_market_entry(date,uuid,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_market_entry(date,uuid,jsonb,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.manager_update_market_entry(uuid,date,uuid,jsonb,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_update_market_entry(uuid,date,uuid,jsonb,boolean,text) TO authenticated;
COMMIT;
