-- Run97: persistent member ordering for member lists, meal entry and ordinary reports.
-- Additive only: no financial data, RLS policies, triggers or ranking queries are changed.
begin;

DO $$
BEGIN
  IF to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.hostels') IS NULL
     OR to_regclass('public.monthly_periods') IS NULL THEN
    RAISE EXCEPTION 'Run97 preflight failed: required Hostel Life tables are missing.';
  END IF;
  IF to_regprocedure('private.assert_hostel_manager(uuid,uuid,boolean,boolean)') IS NULL
     OR to_regprocedure('private.my_hostel_id()') IS NULL THEN
    RAISE EXCEPTION 'Run97 preflight failed: expected manager authorization helpers are missing.';
  END IF;
END $$;

ALTER TABLE public.hostel_memberships
  ADD COLUMN IF NOT EXISTS member_order integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.hostel_memberships'::regclass
      AND conname = 'hostel_memberships_member_order_positive_check'
  ) THEN
    ALTER TABLE public.hostel_memberships
      ADD CONSTRAINT hostel_memberships_member_order_positive_check
      CHECK (member_order IS NULL OR member_order >= 1) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.hostel_memberships
  VALIDATE CONSTRAINT hostel_memberships_member_order_positive_check;

CREATE INDEX IF NOT EXISTS hostel_memberships_hostel_member_order_idx
  ON public.hostel_memberships (hostel_id, member_order, id)
  WHERE status IN ('active','inactive');

-- Preserve the current alphabetical display as the initial saved order.
-- New memberships in an already-ordered hostel stay NULL (and therefore append last)
-- until a manager explicitly saves a new sequence.
WITH initial_order AS (
  SELECT hm.id,
         row_number() OVER (
           PARTITION BY hm.hostel_id
           ORDER BY lower(coalesce(nullif(pg_catalog.btrim(p.full_name),''),'সদস্য')),
                    hm.joined_at, hm.id
         )::integer AS order_no
  FROM public.hostel_memberships hm
  JOIN public.profiles p ON p.id = hm.user_id
  WHERE hm.status IN ('active','inactive')
    AND NOT p.is_blocked
)
UPDATE public.hostel_memberships hm
SET member_order = initial_order.order_no
FROM initial_order
WHERE hm.id = initial_order.id
  AND hm.member_order IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.hostel_memberships existing
    WHERE existing.hostel_id = hm.hostel_id
      AND existing.member_order IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.get_member_directory_v4()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hostel uuid;
  v_period public.monthly_periods%rowtype;
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  v_hostel := private.my_hostel_id();
  IF v_hostel IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE hostel_id = v_hostel AND status = 'running'
  ORDER BY start_date DESC
  LIMIT 1;
  IF FOUND THEN PERFORM private.finalize_due_days(v_hostel, v_period.id); END IF;

  SELECT coalesce(jsonb_agg(x.row_data ORDER BY x.member_order NULLS LAST, x.member_name, x.joined_at, x.membership_id),'[]'::jsonb)
  INTO v_result
  FROM (
    SELECT p.full_name AS member_name,
           m.member_order,
           m.joined_at,
           m.id AS membership_id,
           jsonb_build_object(
             'membership_id',m.id,'member_id',m.id,'user_id',m.user_id,
             'member_name',p.full_name,'full_name',p.full_name,'phone',p.phone,
             'role',m.role,'member_status',m.status,'status',m.status,
             'member_order',m.member_order,
             'is_primary_manager',CASE WHEN v_period.id IS NOT NULL THEN v_period.primary_manager_membership_id=m.id ELSE m.role='manager' END,
             'is_assistant_manager',CASE WHEN v_period.id IS NOT NULL THEN EXISTS(SELECT 1 FROM public.period_assistant_managers a WHERE a.period_id=v_period.id AND a.membership_id=m.id) ELSE false END,
             'meal_activity',CASE WHEN v_period.id IS NULL THEN 'এখনো মাস শুরু হয়নি' WHEN EXISTS(
               SELECT 1 FROM public.daily_meal_records r
               JOIN public.daily_meal_days d ON d.id=r.daily_meal_day_id
               WHERE r.period_id=v_period.id AND r.member_id=m.id AND NOT r.cancelled AND d.status='finalized'
             ) THEN 'এই মাসে মিল আছে' ELSE 'এই মাসে মিল নেই' END,
             'final_meals',coalesce((private.member_financials(v_period.id,m.id)->>'final_meals')::numeric,0),
             'meals',coalesce((private.member_financials(v_period.id,m.id)->>'meals')::numeric,0),
             'deposit',coalesce((private.member_financials(v_period.id,m.id)->>'deposit')::numeric,0),
             'meal_cost',coalesce((private.member_financials(v_period.id,m.id)->>'meal_cost')::numeric,0),
             'other_expense',coalesce((private.member_financials(v_period.id,m.id)->>'other_expense')::numeric,0),
             'balance',coalesce((private.member_financials(v_period.id,m.id)->>'balance')::numeric,0)
           ) AS row_data
    FROM public.hostel_memberships m
    JOIN public.profiles p ON p.id=m.user_id
    WHERE m.hostel_id=v_hostel
      AND m.status IN ('active','inactive')
      AND NOT p.is_blocked
  ) x;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.manager_save_hostel_member_order(p_membership_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hostel uuid;
  v_period_id uuid;
  v_expected_count integer;
  v_unique_count integer;
  v_valid_count integer;
  v_updated_count integer;
BEGIN
  PERFORM private.assert_signed_in();
  v_hostel := private.my_hostel_id();
  IF v_hostel IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='কোনো সক্রিয় মেস পাওয়া যায়নি।', ERRCODE='42501';
  END IF;

  -- Authorize before taking a serialization lock, then re-check after locking
  -- the hostel row so a concurrent period/manager change cannot widen access.
  SELECT mp.id INTO v_period_id
  FROM public.monthly_periods mp
  WHERE mp.hostel_id=v_hostel AND mp.status='running'
  ORDER BY mp.start_date DESC
  LIMIT 1;
  PERFORM private.assert_hostel_manager(v_hostel,v_period_id,false,false);

  -- Serialize ordering changes with membership inserts that reference this hostel.
  PERFORM 1 FROM public.hostels h WHERE h.id=v_hostel FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='মেসের তথ্য পাওয়া যায়নি।', ERRCODE='P0002';
  END IF;

  SELECT mp.id INTO v_period_id
  FROM public.monthly_periods mp
  WHERE mp.hostel_id=v_hostel AND mp.status='running'
  ORDER BY mp.start_date DESC
  LIMIT 1;
  PERFORM private.assert_hostel_manager(v_hostel,v_period_id,false,false);

  IF p_membership_ids IS NULL OR cardinality(p_membership_ids)=0 THEN
    RAISE EXCEPTION USING MESSAGE='সদস্যের সম্পূর্ণ ক্রম নির্বাচন করুন।', ERRCODE='22023';
  END IF;

  SELECT count(DISTINCT requested.membership_id)::integer
  INTO v_unique_count
  FROM unnest(p_membership_ids) AS requested(membership_id);
  IF v_unique_count <> cardinality(p_membership_ids) THEN
    RAISE EXCEPTION USING MESSAGE='সদস্যের তালিকায় খালি বা duplicate সদস্য রয়েছে।', ERRCODE='22023';
  END IF;

  SELECT count(*)::integer INTO v_expected_count
  FROM public.hostel_memberships hm
  JOIN public.profiles p ON p.id=hm.user_id
  WHERE hm.hostel_id=v_hostel
    AND hm.status IN ('active','inactive')
    AND NOT p.is_blocked;

  SELECT count(*)::integer INTO v_valid_count
  FROM unnest(p_membership_ids) AS requested(membership_id)
  JOIN public.hostel_memberships hm
    ON hm.id=requested.membership_id
   AND hm.hostel_id=v_hostel
   AND hm.status IN ('active','inactive')
  JOIN public.profiles p ON p.id=hm.user_id AND NOT p.is_blocked;

  IF v_valid_count <> cardinality(p_membership_ids)
     OR v_expected_count <> cardinality(p_membership_ids) THEN
    RAISE EXCEPTION USING MESSAGE='সদস্য তালিকা পরিবর্তিত হয়েছে। তালিকা নতুন করে লোড করে আবার সংরক্ষণ করুন।', ERRCODE='40001';
  END IF;

  PERFORM hm.id
  FROM public.hostel_memberships hm
  JOIN public.profiles p ON p.id=hm.user_id
  WHERE hm.hostel_id=v_hostel
    AND hm.status IN ('active','inactive')
    AND NOT p.is_blocked
  ORDER BY hm.id
  FOR UPDATE OF hm;

  UPDATE public.hostel_memberships hm
  SET member_order=requested.sequence_no::integer,
      updated_at=now()
  FROM unnest(p_membership_ids) WITH ORDINALITY AS requested(membership_id,sequence_no)
  WHERE hm.id=requested.membership_id
    AND hm.hostel_id=v_hostel;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> v_expected_count THEN
    RAISE EXCEPTION USING MESSAGE='সদস্যের সম্পূর্ণ ক্রম সংরক্ষণ করা যায়নি।', ERRCODE='40001';
  END IF;

  RETURN jsonb_build_object('success',true,'updated_count',v_updated_count);
END;
$$;

REVOKE ALL ON FUNCTION public.manager_save_hostel_member_order(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_save_hostel_member_order(uuid[]) TO authenticated;
COMMENT ON FUNCTION public.manager_save_hostel_member_order(uuid[]) IS
  'Manager/assigned assistant manager only. Saves one complete hostel-scoped member display order; does not alter financial or ranking data.';

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
      'member_status',hm.status,'member_order',hm.member_order)
    || coalesce(private.member_financials(v_period.id,hm.id),'{}'::jsonb)
    order by hm.member_order nulls last,p.full_name,hm.joined_at,hm.id),'[]'::jsonb)
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

NOTIFY pgrst, 'reload schema';
COMMIT;
