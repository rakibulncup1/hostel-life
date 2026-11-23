-- Run95: manager-authorized bulk creation for manual normal meal requests.
-- Reuses the existing private request validator and audit writer for every member.
-- This is additive: the existing single-member RPC and request workflow are unchanged.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('public.monthly_periods') IS NULL
     OR to_regclass('public.meal_requests') IS NULL
     OR to_regclass('public.archive_period_audit') IS NULL
     OR to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.my_hostel_id()') IS NULL
     OR to_regprocedure('private.assert_hostel_manager(uuid,uuid,boolean,boolean)') IS NULL
     OR to_regprocedure('private.create_meal_request_internal(uuid,date,date,jsonb,text,boolean,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Run95 preflight failed: required Hostel Life tables or secured meal-request helpers are missing; no changes committed.';
  END IF;
END
$preflight$;

create or replace function public.manager_create_member_meal_requests(
  p_member_ids uuid[],
  p_start_date date,
  p_end_date date,
  p_days jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_hostel uuid;
  v_member_id uuid;
  v_selected_count integer;
  v_active_count integer;
  v_created_count integer := 0;
begin
  perform private.assert_signed_in();
  v_hostel := private.my_hostel_id();
  perform private.assert_hostel_manager(v_hostel, null, false, false);

  if p_member_ids is null or cardinality(p_member_ids) = 0 then
    raise exception using message = 'অন্তত একজন সক্রিয় সদস্য নির্বাচন করুন।', errcode = '22023';
  end if;

  if cardinality(p_member_ids) > 200 then
    raise exception using message = 'একবারে সর্বোচ্চ ২০০ জন সদস্যের ম্যানুয়াল অনুরোধ তৈরি করা যাবে।', errcode = '22023';
  end if;

  if exists (select 1 from unnest(p_member_ids) as requested(member_id) where requested.member_id is null) then
    raise exception using message = 'সদস্য তালিকায় অবৈধ পরিচয় পাওয়া গেছে।', errcode = '22023';
  end if;

  select count(distinct requested.member_id)
    into v_selected_count
    from unnest(p_member_ids) as requested(member_id);
  if v_selected_count <> cardinality(p_member_ids) then
    raise exception using message = 'একই সদস্য একাধিকবার নির্বাচন করা হয়েছে।', errcode = '22023';
  end if;

  select count(*)
    into v_active_count
    from public.hostel_memberships membership
   where membership.id = any(p_member_ids)
     and membership.hostel_id = v_hostel
     and membership.status = 'active';
  if v_active_count <> cardinality(p_member_ids) then
    raise exception using message = 'নির্বাচিত সদস্যদের মধ্যে কেউ এই মেসের সক্রিয় সদস্য নন। তালিকা রিফ্রেশ করে আবার চেষ্টা করুন।', errcode = '42501';
  end if;

  -- Preserve the existing server-side date, period, duplicate, meal-value,
  -- and audit rules. A failure for any member rolls back the entire batch.
  -- Lock member identities in deterministic UUID order inside the shared
  -- request helper, reducing deadlock risk for concurrent manager batches.
  for v_member_id in
    select requested.member_id
      from unnest(p_member_ids) as requested(member_id)
     order by requested.member_id
  loop
    perform private.create_meal_request_internal(
      v_member_id,
      p_start_date,
      p_end_date,
      p_days,
      'normal',
      false,
      'ম্যানেজার কর্তৃক যোগ করা হয়েছে',
      'manager',
      null
    );
    v_created_count := v_created_count + 1;
  end loop;

  return jsonb_build_object('created_count', v_created_count);
end;
$function$;

revoke all on function public.manager_create_member_meal_requests(uuid[], date, date, jsonb) from public, anon;
grant execute on function public.manager_create_member_meal_requests(uuid[], date, date, jsonb) to authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
