-- ============================================================================
-- HOSTEL LIFE — MASTER SUPABASE INSTALL (fresh project only)
-- Generated from the frontend RPC/service contracts in the supplied ZIP.
-- Target: Supabase PostgreSQL + PostgREST, project-local fresh database.
-- WARNING: Read INSTALL_GUIDE_BN.md before running. This is a schema install,
-- not a data recovery script. It is designed to be rerunnable on itself, but
-- do not run it on a database that already contains production data/schema.
-- ============================================================================

begin;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- 01. Core tables
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'সদস্য',
  phone text,
  avatar_url text,
  role text not null default 'user' check (role in ('user','super_admin')),
  is_blocked boolean not null default false,
  flags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hostels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  join_code text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  platform_status text not null default 'active' check (platform_status in ('active','suspended')),
  flags jsonb not null default '{}'::jsonb,
  platform_status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hostel_memberships (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member','manager')),
  status text not null default 'active' check (status in ('active','inactive')),
  joined_at timestamptz not null default now(),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hostel_id, user_id)
);
create unique index if not exists hostel_memberships_one_active_hostel_per_user
  on public.hostel_memberships(user_id) where status = 'active';
create index if not exists hostel_memberships_hostel_status_idx on public.hostel_memberships(hostel_id,status);

create table if not exists public.monthly_periods (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  label text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'running' check (status in ('running','closed','archived')),
  primary_manager_membership_id uuid references public.hostel_memberships(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create unique index if not exists monthly_periods_one_running_per_hostel
  on public.monthly_periods(hostel_id) where status = 'running';
create index if not exists monthly_periods_hostel_dates_idx on public.monthly_periods(hostel_id,start_date desc);

create table if not exists public.period_assistant_managers (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.monthly_periods(id) on delete cascade,
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  membership_id uuid not null references public.hostel_memberships(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(period_id,membership_id)
);

create table if not exists public.daily_meal_days (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  period_id uuid not null references public.monthly_periods(id) on delete cascade,
  meal_date date not null,
  status text not null default 'open' check (status in ('open','locked','finalized','cancelled')),
  cutoff_at timestamptz,
  finalizes_at timestamptz,
  locked_at timestamptz,
  finalized_at timestamptz,
  finalized_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(period_id,meal_date),
  check (meal_date is not null)
);
create index if not exists daily_meal_days_hostel_date_idx on public.daily_meal_days(hostel_id,meal_date);
create index if not exists daily_meal_days_period_status_idx on public.daily_meal_days(period_id,status,meal_date);

create table if not exists public.daily_meal_records (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  period_id uuid not null references public.monthly_periods(id) on delete cascade,
  daily_meal_day_id uuid not null references public.daily_meal_days(id) on delete cascade,
  member_id uuid references public.hostel_memberships(id) on delete set null,
  member_name_snapshot text,
  planned_breakfast numeric(7,2) check (planned_breakfast is null or planned_breakfast between 0 and 50),
  planned_lunch numeric(7,2) check (planned_lunch is null or planned_lunch between 0 and 50),
  planned_dinner numeric(7,2) check (planned_dinner is null or planned_dinner between 0 and 50),
  actual_breakfast numeric(7,2) check (actual_breakfast is null or actual_breakfast between 0 and 50),
  actual_lunch numeric(7,2) check (actual_lunch is null or actual_lunch between 0 and 50),
  actual_dinner numeric(7,2) check (actual_dinner is null or actual_dinner between 0 and 50),
  final_breakfast numeric(7,2) check (final_breakfast is null or final_breakfast between 0 and 50),
  final_lunch numeric(7,2) check (final_lunch is null or final_lunch between 0 and 50),
  final_dinner numeric(7,2) check (final_dinner is null or final_dinner between 0 and 50),
  finalization_source text,
  finalized_by uuid references auth.users(id) on delete set null,
  finalized_at timestamptz,
  cancelled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(daily_meal_day_id,member_id)
);
create index if not exists daily_meal_records_period_member_idx on public.daily_meal_records(period_id,member_id);
create index if not exists daily_meal_records_hostel_day_idx on public.daily_meal_records(hostel_id,daily_meal_day_id);

create table if not exists public.meal_requests (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  period_id uuid not null references public.monthly_periods(id) on delete cascade,
  membership_id uuid references public.hostel_memberships(id) on delete set null,
  member_name_snapshot text,
  request_type text not null default 'normal' check (request_type in ('normal','correction')),
  origin text not null default 'member' check (origin in ('member','manager','manager_self','emergency_override')),
  is_late_request boolean not null default false,
  start_date date not null,
  end_date date not null,
  days jsonb not null default '[]'::jsonb check (jsonb_typeof(days) = 'array'),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','cancelled','void')),
  reason text,
  review_reason text,
  manager_note text,
  manager_edited boolean not null default false,
  manager_updated_at timestamptz,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  parent_request_id uuid references public.meal_requests(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists meal_requests_period_status_dates_idx on public.meal_requests(period_id,status,start_date,end_date);
create index if not exists meal_requests_membership_idx on public.meal_requests(membership_id,submitted_at desc);

create table if not exists public.market_entries (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  period_id uuid not null references public.monthly_periods(id) on delete cascade,
  entry_date date not null,
  buyer_membership_id uuid references public.hostel_memberships(id) on delete set null,
  buyer_name_snapshot text,
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  credit_to_buyer boolean not null default true,
  status text not null default 'active' check (status in ('active','void')),
  void_reason text,
  voided_by uuid references auth.users(id) on delete set null,
  voided_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists market_entries_period_date_idx on public.market_entries(period_id,entry_date desc);
create index if not exists market_entries_hostel_date_idx on public.market_entries(hostel_id,entry_date desc);

create table if not exists public.market_entry_items (
  id uuid primary key default gen_random_uuid(),
  market_entry_id uuid not null references public.market_entries(id) on delete cascade,
  serial_no integer not null default 1,
  item_name text not null,
  quantity text,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  created_at timestamptz not null default now(),
  unique(market_entry_id,serial_no)
);

create table if not exists public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  period_id uuid not null references public.monthly_periods(id) on delete cascade,
  member_id uuid references public.hostel_memberships(id) on delete set null,
  member_name_snapshot text,
  entry_date date not null default ((now() at time zone 'Asia/Dhaka')::date),
  ledger_type text not null check (ledger_type in ('deposit','market_deposit','other_expense','adjustment')),
  ledger_group text not null default 'member',
  amount numeric(14,2) not null,
  description text,
  reference_type text,
  reference_id uuid,
  status text not null default 'active' check (status in ('active','void')),
  adjustment_reason text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ledger_transactions_period_date_idx on public.ledger_transactions(period_id,entry_date desc,created_at desc);
create index if not exists ledger_transactions_member_idx on public.ledger_transactions(member_id,period_id);
create index if not exists ledger_transactions_reference_idx on public.ledger_transactions(reference_type,reference_id);

create table if not exists public.khala_money_entries (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  period_id uuid not null references public.monthly_periods(id) on delete cascade,
  member_id uuid references public.hostel_memberships(id) on delete set null,
  member_name_snapshot text,
  payment_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  description text,
  status text not null default 'active' check (status in ('active','void')),
  void_reason text,
  voided_by uuid references auth.users(id) on delete set null,
  voided_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists khala_entries_period_idx on public.khala_money_entries(period_id,payment_date desc);

create table if not exists public.archive_edit_permissions (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  period_id uuid not null references public.monthly_periods(id) on delete cascade,
  membership_id uuid not null references public.hostel_memberships(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  reason text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists archive_edit_permissions_active_idx on public.archive_edit_permissions(period_id,membership_id) where revoked_at is null;

create table if not exists public.archive_period_audit (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  period_id uuid not null references public.monthly_periods(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists archive_period_audit_period_idx on public.archive_period_audit(period_id,created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  created_by uuid references auth.users(id) on delete set null,
  seen_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications(recipient_user_id,created_at desc) where deleted_at is null;

create table if not exists public.platform_settings (
  singleton boolean primary key default true check (singleton),
  announcement_enabled boolean not null default false,
  announcement_title text not null default '',
  announcement_body text not null default '',
  registration_code_required boolean not null default false,
  hostel_creation_code_required boolean not null default false,
  developer_name text not null default '',
  developer_title text not null default '',
  developer_photo_url text not null default '',
  developer_email text not null default '',
  developer_phone text not null default '',
  developer_portfolio_url text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings(singleton) values (true) on conflict (singleton) do nothing;

create table if not exists public.platform_access_codes (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('registration','hostel_creation')),
  code_hash text not null,
  max_uses integer not null check (max_uses between 1 and 1000),
  use_count integer not null default 0,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (use_count >= 0 and use_count <= max_uses)
);
create index if not exists platform_access_codes_purpose_idx on public.platform_access_codes(purpose,expires_at desc) where revoked_at is null;

create table if not exists public.platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists platform_audit_log_created_idx on public.platform_audit_log(created_at desc);

-- ---------------------------------------------------------------------------
-- 02. Security/helper functions. All SECURITY DEFINER functions pin search_path.
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create or replace function private.my_user_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select auth.uid()
$$;

create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin' and not p.is_blocked)
$$;

create or replace function private.my_membership_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.hostel_memberships m
  join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid() and m.status = 'active' and not p.is_blocked
  order by m.created_at desc limit 1
$$;

create or replace function private.my_hostel_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select m.hostel_id from public.hostel_memberships m
  join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid() and m.status = 'active' and not p.is_blocked
  order by m.created_at desc limit 1
$$;

create or replace function private.can_access_hostel(p_hostel_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hostel_memberships m
    join public.profiles p on p.id = m.user_id
    join public.hostels h on h.id = m.hostel_id
    where m.user_id = auth.uid() and m.hostel_id = p_hostel_id and m.status = 'active'
      and not p.is_blocked and h.platform_status = 'active'
  ) or private.is_super_admin()
$$;

create or replace function private.is_primary_manager(p_hostel_id uuid, p_period_id uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hostel_memberships m
    join public.profiles p on p.id = m.user_id
    where m.user_id = auth.uid() and m.hostel_id = p_hostel_id and m.status = 'active' and not p.is_blocked
      and (
        (p_period_id is not null and exists (
          select 1 from public.monthly_periods mp where mp.id = p_period_id and mp.hostel_id = p_hostel_id
            and mp.primary_manager_membership_id = m.id
        ))
        or (p_period_id is null and exists (
          select 1 from public.monthly_periods mp where mp.hostel_id = p_hostel_id and mp.status = 'running'
            and mp.primary_manager_membership_id = m.id
        ))
        or (not exists (select 1 from public.monthly_periods mp where mp.hostel_id = p_hostel_id and mp.status = 'running') and m.role = 'manager')
      )
  ) or private.is_super_admin()
$$;

create or replace function private.is_assistant_manager(p_hostel_id uuid, p_period_id uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hostel_memberships m
    join public.profiles p on p.id = m.user_id
    join public.period_assistant_managers a on a.membership_id = m.id
    join public.monthly_periods mp on mp.id = a.period_id
    where m.user_id = auth.uid() and m.hostel_id = p_hostel_id and m.status = 'active' and not p.is_blocked
      and mp.status = 'running' and (p_period_id is null or a.period_id = p_period_id)
  )
$$;

create or replace function private.can_manage_hostel(p_hostel_id uuid, p_period_id uuid default null, p_primary_only boolean default false, p_allow_archive boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_super_admin()
    or private.is_primary_manager(p_hostel_id,p_period_id)
    or (not p_primary_only and private.is_assistant_manager(p_hostel_id,p_period_id))
    or (p_allow_archive and exists (
      select 1 from public.archive_edit_permissions a
      join public.hostel_memberships m on m.id = a.membership_id
      where a.hostel_id = p_hostel_id and a.period_id = p_period_id and a.membership_id = private.my_membership_id()
        and a.revoked_at is null and (a.expires_at is null or a.expires_at > now())
        and m.status = 'active' and m.user_id = auth.uid()
    ))
$$;

create or replace function private.assert_signed_in()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception using message = 'এই কাজটি করতে আগে লগইন করুন।', errcode = '28000'; end if;
  if exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_blocked) then
    raise exception using message = 'আপনার অ্যাকাউন্টটি বর্তমানে ব্লক করা হয়েছে।', errcode = '42501';
  end if;
end $$;

create or replace function private.assert_hostel_manager(p_hostel_id uuid, p_period_id uuid default null, p_primary_only boolean default false, p_allow_archive boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_signed_in();
  if not private.can_manage_hostel(p_hostel_id,p_period_id,p_primary_only,p_allow_archive) then
    raise exception using message = case when p_primary_only then 'এই কাজটি শুধু প্রধান ম্যানেজার করতে পারবেন।' else 'এই কাজটি করার অনুমতি আপনার নেই।' end, errcode = '42501';
  end if;
end $$;

create or replace function private.current_running_period(p_hostel_id uuid)
returns public.monthly_periods language sql stable security definer set search_path = '' as $$
  select mp from public.monthly_periods mp where mp.hostel_id = p_hostel_id and mp.status = 'running' order by mp.start_date desc limit 1
$$;

create or replace function private.ensure_period_days(p_period_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_period public.monthly_periods%rowtype; v_day date;
begin
  select * into v_period from public.monthly_periods where id = p_period_id;
  if not found then raise exception using message='মাসের তথ্য পাওয়া যায়নি।', errcode='P0002'; end if;
  v_day := v_period.start_date;
  while v_day <= v_period.end_date loop
    insert into public.daily_meal_days(hostel_id,period_id,meal_date,cutoff_at,finalizes_at)
    values (v_period.hostel_id,v_period.id,v_day,(v_day::timestamp + time '21:00') at time zone 'Asia/Dhaka', (v_day::timestamp + time '21:00') at time zone 'Asia/Dhaka')
    on conflict(period_id,meal_date) do nothing;
    v_day := v_day + 1;
  end loop;
end $$;

-- Finalize days lazily on the next online read after the Dhaka cutoff.
-- This avoids depending on pg_cron being enabled in a fresh Supabase project.
-- The operation is idempotent and only touches due days in a running period.
create or replace function private.finalize_due_days(p_hostel_id uuid,p_period_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz:=clock_timestamp(); v_days integer:=0;
begin
  if p_hostel_id is null then return 0; end if;
  update public.daily_meal_records r
  set final_breakfast=coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0),
      final_lunch=coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0),
      final_dinner=coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0),
      finalization_source=coalesce(r.finalization_source,'auto_cutoff'),
      finalized_at=coalesce(r.finalized_at,v_now),
      finalized_by=r.finalized_by,
      updated_by=auth.uid(),updated_at=v_now
  from public.daily_meal_days d
  join public.monthly_periods mp on mp.id=d.period_id
  where d.id=r.daily_meal_day_id and d.hostel_id=p_hostel_id and mp.status='running'
    and (p_period_id is null or mp.id=p_period_id)
    and d.status in ('open','locked') and d.finalizes_at is not null and d.finalizes_at<=v_now
    and not r.cancelled;
  update public.daily_meal_days d
  set status='finalized',finalized_at=coalesce(d.finalized_at,v_now),finalized_by=d.finalized_by,updated_at=v_now
  from public.monthly_periods mp
  where mp.id=d.period_id and d.hostel_id=p_hostel_id and mp.status='running'
    and (p_period_id is null or mp.id=p_period_id)
    and d.status in ('open','locked') and d.finalizes_at is not null and d.finalizes_at<=v_now;
  GET DIAGNOSTICS v_days=ROW_COUNT;
  IF v_days>0 THEN
    INSERT INTO public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
    SELECT p_hostel_id,mp.id,NULL,'auto_finalize',format('%s দিনের মিল cutoff অনুযায়ী স্বয়ংক্রিয়ভাবে চূড়ান্ত হয়েছে',count(*)::text),
      jsonb_build_object('finalized_day_count',count(*),'finalized_at',v_now,'source','auto_cutoff')
    FROM public.daily_meal_days d JOIN public.monthly_periods mp ON mp.id=d.period_id
    WHERE d.hostel_id=p_hostel_id AND mp.status='running'
      AND (p_period_id IS NULL OR mp.id=p_period_id)
      AND d.status='finalized' AND d.finalized_at=v_now
    GROUP BY mp.id;
  END IF;
  return v_days;
end $$;

create or replace function private.is_valid_meal(v numeric)
returns boolean language sql immutable set search_path = '' as $$
 select v is not null and v between 0 and 50 and v * 2 = trunc(v * 2)
$$;

create or replace function private.assert_meal_days(p_days jsonb, p_period_id uuid, p_allow_cutoff boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_item jsonb; v_date date; v_period public.monthly_periods%rowtype; v_day public.daily_meal_days%rowtype;
begin
  if p_days is null or jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) = 0 then
    raise exception using message='অন্তত একটি দিনের মিলের তথ্য দিন।', errcode='22023';
  end if;
  if jsonb_array_length(p_days) > 62 then raise exception using message='একবারে সর্বোচ্চ ৬২ দিনের মিল দেওয়া যাবে।', errcode='22023'; end if;
  select * into v_period from public.monthly_periods where id=p_period_id;
  if not found or v_period.status <> 'running' then raise exception using message='বর্তমান মাসটি চালু নেই।', errcode='55000'; end if;
  for v_item in select value from jsonb_array_elements(p_days) loop
    begin v_date := (v_item->>'meal_date')::date; exception when others then raise exception using message='মিলের তারিখ সঠিক নয়।', errcode='22007'; end;
    if v_date < v_period.start_date or v_date > v_period.end_date then raise exception using message='তারিখটি চলমান মাসের সীমার বাইরে।', errcode='22023'; end if;
    if not private.is_valid_meal(coalesce((v_item->>'breakfast')::numeric,0))
      or not private.is_valid_meal(coalesce((v_item->>'lunch')::numeric,0))
      or not private.is_valid_meal(coalesce((v_item->>'dinner')::numeric,0)) then
      raise exception using message='মিলের পরিমাণ ০ থেকে ৫০-এর মধ্যে এবং ০.৫ ধাপে হতে হবে।', errcode='22023';
    end if;
    select * into v_day from public.daily_meal_days where period_id=p_period_id and meal_date=v_date;
    if not found then raise exception using message='এই তারিখের মিল-দিন প্রস্তুত নয়। মাসের তারিখগুলো আবার সিঙ্ক করুন।', errcode='P0002'; end if;
    if not p_allow_cutoff and (v_day.status='finalized' or (v_day.cutoff_at is not null and v_day.cutoff_at <= now())) then
      raise exception using message='এই তারিখের মিল দেওয়ার সময় শেষ হয়েছে। সংশোধনের অনুরোধ ব্যবহার করুন।', errcode='55000';
    end if;
  end loop;
  if exists (select (value->>'meal_date')::date from jsonb_array_elements(p_days) group by (value->>'meal_date')::date having count(*)>1) then
    raise exception using message='একই তারিখ একাধিকবার দেওয়া হয়েছে।', errcode='22023';
  end if;
end $$;

create or replace function private.apply_request_days(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_req public.meal_requests%rowtype; v_item jsonb; v_date date; v_day public.daily_meal_days%rowtype;
 v_b numeric; v_l numeric; v_d numeric;
begin
  select * into v_req from public.meal_requests where id=p_request_id;
  if not found then raise exception using message='মিল অনুরোধটি পাওয়া যায়নি।', errcode='P0002'; end if;
  for v_item in select value from jsonb_array_elements(v_req.days) loop
    v_date := (v_item->>'meal_date')::date;
    v_b := coalesce((v_item->>'breakfast')::numeric,0); v_l := coalesce((v_item->>'lunch')::numeric,0); v_d := coalesce((v_item->>'dinner')::numeric,0);
    select * into v_day from public.daily_meal_days where period_id=v_req.period_id and meal_date=v_date;
    if not found then continue; end if;
    insert into public.daily_meal_records(hostel_id,period_id,daily_meal_day_id,member_id,member_name_snapshot,
      planned_breakfast,planned_lunch,planned_dinner,actual_breakfast,actual_lunch,actual_dinner,
      final_breakfast,final_lunch,final_dinner,finalization_source,finalized_by,finalized_at,updated_by,cancelled)
    values (v_req.hostel_id,v_req.period_id,v_day.id,v_req.membership_id,v_req.member_name_snapshot,
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
      auth.uid(),false)
    on conflict(daily_meal_day_id,member_id) do update set
      planned_breakfast=excluded.planned_breakfast, planned_lunch=excluded.planned_lunch, planned_dinner=excluded.planned_dinner,
      actual_breakfast=coalesce(excluded.actual_breakfast,public.daily_meal_records.actual_breakfast),
      actual_lunch=coalesce(excluded.actual_lunch,public.daily_meal_records.actual_lunch),
      actual_dinner=coalesce(excluded.actual_dinner,public.daily_meal_records.actual_dinner),
      final_breakfast=coalesce(excluded.final_breakfast,public.daily_meal_records.final_breakfast),
      final_lunch=coalesce(excluded.final_lunch,public.daily_meal_records.final_lunch),
      final_dinner=coalesce(excluded.final_dinner,public.daily_meal_records.final_dinner),
      finalization_source=coalesce(excluded.finalization_source,public.daily_meal_records.finalization_source),
      finalized_by=coalesce(excluded.finalized_by,public.daily_meal_records.finalized_by),
      finalized_at=coalesce(excluded.finalized_at,public.daily_meal_records.finalized_at),updated_by=auth.uid(),cancelled=false,updated_at=now();
    if v_req.request_type='correction' and v_day.status='finalized' then
      insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
      values(v_req.hostel_id,v_req.period_id,auth.uid(),'update:meal_correction','মিল সংশোধন অনুমোদন করা হয়েছে',jsonb_build_object('request_id',v_req.id,'meal_date',v_date,'membership_id',v_req.membership_id,'days',v_item));
    end if;
  end loop;
end $$;

create or replace function private.consume_access_code(p_purpose text,p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_code is null or btrim(p_code)='' then return false; end if;
  update public.platform_access_codes c set use_count=c.use_count+1
   where c.id=(select x.id from public.platform_access_codes x where x.purpose=p_purpose and x.code_hash=encode(extensions.digest(upper(btrim(p_code)),'sha256'),'hex')
      and x.revoked_at is null and x.expires_at>now() and x.use_count<x.max_uses order by x.created_at desc limit 1 for update)
   returning c.id into v_id;
  return v_id is not null;
end $$;

create or replace function private.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_settings public.platform_settings%rowtype; v_code text;
begin
  select * into v_settings from public.platform_settings where singleton=true;
  v_code := coalesce(new.raw_user_meta_data->>'permission_code','');
  if coalesce(v_settings.registration_code_required,false) and not private.consume_access_code('registration',v_code) then
    raise exception using message='রেজিস্ট্রেশনের অনুমতি কোডটি ভুল, মেয়াদোত্তীর্ণ অথবা ব্যবহারসীমা শেষ।', errcode='42501';
  end if;
  insert into public.profiles(id,full_name,phone,role)
  values(new.id,coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),'সদস্য'),nullif(btrim(new.raw_user_meta_data->>'phone'),''),'user')
  on conflict(id) do update set full_name=excluded.full_name,phone=coalesce(excluded.phone,public.profiles.phone),updated_at=now();
  return new;
end $$;

drop trigger if exists on_auth_user_created_hostel_life on auth.users;
create trigger on_auth_user_created_hostel_life after insert on auth.users
for each row execute function private.handle_new_auth_user();

-- updated_at triggers
DO $$ declare t text; begin
  foreach t in array array['profiles','hostels','hostel_memberships','monthly_periods','daily_meal_days','daily_meal_records','meal_requests','market_entries','ledger_transactions','khala_money_entries'] loop
    execute format('drop trigger if exists %I on public.%I',t||'_touch_updated_at',t);
    execute format('create trigger %I before update on public.%I for each row execute function private.touch_updated_at()',t||'_touch_updated_at',t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 03. Identity, onboarding and profile RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_my_profile()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.assert_signed_in();
  select jsonb_build_object('id',p.id,'full_name',p.full_name,'phone',p.phone,'avatar_url',p.avatar_url,'role',p.role,
    'is_blocked',p.is_blocked,'created_at',p.created_at,'updated_at',p.updated_at)
  into v from public.profiles p where p.id=auth.uid();
  return v;
end $$;

create or replace function public.get_my_membership()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.assert_signed_in();
  select jsonb_build_object('membership_id',m.id,'id',m.id,'user_id',m.user_id,'hostel_id',m.hostel_id,
    'hostel_name',h.name,'hostel_status',h.platform_status,'join_code',case when m.role='manager' then h.join_code else null end,
    'role',m.role,'status',m.status,'member_status',m.status,'member_name',p.full_name,'full_name',p.full_name,
    'phone',p.phone,'joined_at',m.joined_at)
  into v from public.hostel_memberships m join public.hostels h on h.id=m.hostel_id
    join public.profiles p on p.id=m.user_id where m.user_id=auth.uid() and m.status='active' and not p.is_blocked
  order by m.created_at desc limit 1;
  return v;
end $$;

create or replace function public.get_my_operational_role()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid; v_member uuid; v_period public.monthly_periods%rowtype; v_primary boolean:=false; v_assistant boolean:=false;
begin
  perform private.assert_signed_in(); v_hostel:=private.my_hostel_id(); v_member:=private.my_membership_id();
  if v_hostel is null or v_member is null then return jsonb_build_object('is_primary_manager',false,'is_assistant_manager',false,'can_manage_month',false); end if;
  select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' order by start_date desc limit 1;
  if found then
    v_primary := v_period.primary_manager_membership_id=v_member;
    v_assistant := exists(select 1 from public.period_assistant_managers a where a.period_id=v_period.id and a.membership_id=v_member);
  else
    select role='manager' into v_primary from public.hostel_memberships where id=v_member;
  end if;
  return jsonb_build_object('is_primary_manager',coalesce(v_primary,false),'is_assistant_manager',coalesce(v_assistant,false),
    'can_manage_month',coalesce(v_primary,false),'period_id',v_period.id);
end $$;

create or replace function public.update_my_profile(p_full_name text,p_phone text default null,p_avatar_url text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.assert_signed_in();
  if p_full_name is null or length(btrim(p_full_name))<2 or length(btrim(p_full_name))>100 then
    raise exception using message='নাম কমপক্ষে ২ এবং সর্বোচ্চ ১০০ অক্ষরের হতে হবে।',errcode='22023';
  end if;
  update public.profiles set full_name=btrim(p_full_name),phone=nullif(btrim(p_phone),''),avatar_url=nullif(btrim(p_avatar_url),'')
  where id=auth.uid() returning jsonb_build_object('id',id,'full_name',full_name,'phone',phone,'avatar_url',avatar_url,'role',role) into v;
  return v;
end $$;

create or replace function public.create_hostel_secure(p_name text,p_permission_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_hostel public.hostels%rowtype; v_membership public.hostel_memberships%rowtype; v_settings public.platform_settings%rowtype; v_code text;
begin
  perform private.assert_signed_in(); v_user:=auth.uid();
  if private.my_membership_id() is not null then raise exception using message='আপনি ইতিমধ্যে একটি মেসে যুক্ত আছেন। নতুন মেস তৈরি করার আগে বর্তমান মেস থেকে বের হতে হবে।',errcode='23505'; end if;
  if p_name is null or length(btrim(p_name))<2 or length(btrim(p_name))>120 then raise exception using message='মেসের নাম ২ থেকে ১২০ অক্ষরের মধ্যে হতে হবে।',errcode='22023'; end if;
  select * into v_settings from public.platform_settings where singleton=true;
  if v_settings.hostel_creation_code_required then
    if not private.consume_access_code('hostel_creation',coalesce(p_permission_code,'')) then
      raise exception using message='মেস তৈরির অনুমতি কোডটি ভুল, মেয়াদোত্তীর্ণ অথবা ব্যবহারসীমা শেষ।',errcode='42501';
    end if;
  end if;
  v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  while exists(select 1 from public.hostels where join_code=v_code) loop v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)); end loop;
  insert into public.hostels(name,join_code,created_by) values(btrim(p_name),v_code,v_user) returning * into v_hostel;
  insert into public.hostel_memberships(hostel_id,user_id,role,status) values(v_hostel.id,v_user,'manager','active') returning * into v_membership;
  insert into public.platform_audit_log(actor_user_id,action,target_type,target_id,details)
    values(v_user,'hostel_created','hostel',v_hostel.id::text,jsonb_build_object('name',v_hostel.name));
  return jsonb_build_object('hostel_id',v_hostel.id,'id',v_hostel.id,'name',v_hostel.name,'join_code',v_hostel.join_code,'membership_id',v_membership.id,'status','created');
end $$;

create or replace function public.create_hostel(p_name text)
returns jsonb language sql security definer set search_path = '' as $$
  select public.create_hostel_secure(p_name,null)
$$;

create or replace function public.join_hostel(p_join_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel public.hostels%rowtype; v_user uuid; v_existing public.hostel_memberships%rowtype; v_m public.hostel_memberships%rowtype;
begin
  perform private.assert_signed_in(); v_user:=auth.uid();
  if p_join_code is null or btrim(p_join_code)='' then raise exception using message='Join Code লিখুন।',errcode='22023'; end if;
  select * into v_hostel from public.hostels where upper(join_code)=upper(btrim(p_join_code)) limit 1;
  if not found then raise exception using message='এই Join Code-এর কোনো মেস পাওয়া যায়নি।',errcode='P0002'; end if;
  if v_hostel.platform_status<>'active' then raise exception using message='এই মেসটি বর্তমানে স্থগিত।',errcode='55000'; end if;
  select * into v_existing from public.hostel_memberships where user_id=v_user order by created_at desc limit 1;
  if found and v_existing.hostel_id<>v_hostel.id and v_existing.status='active' then raise exception using message='আপনি ইতিমধ্যে অন্য একটি মেসে যুক্ত আছেন।',errcode='23505'; end if;
  if found and v_existing.hostel_id=v_hostel.id then
    update public.hostel_memberships set status='active',deactivated_at=null where id=v_existing.id returning * into v_m;
  else
    insert into public.hostel_memberships(hostel_id,user_id,role,status) values(v_hostel.id,v_user,'member','active') returning * into v_m;
  end if;
  return jsonb_build_object('hostel_id',v_hostel.id,'hostel_name',v_hostel.name,'membership_id',v_m.id,'role',v_m.role,'status',v_m.status);
end $$;

-- ---------------------------------------------------------------------------
-- 04. Reusable accounting/read helpers
-- ---------------------------------------------------------------------------
create or replace function private.member_financials(p_period_id uuid,p_membership_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid; v_member_name text; v_meals numeric:=0; v_all_meals numeric:=0; v_market numeric:=0;
 v_deposit numeric:=0; v_market_deposit numeric:=0; v_other numeric:=0; v_khala numeric:=0; v_adjustment numeric:=0; v_rate numeric:=0; v_balance numeric:=0;
begin
  select mp.hostel_id into v_hostel from public.monthly_periods mp where mp.id=p_period_id;
  select coalesce(pr.full_name,m.member_name_snapshot,'সদস্য') into v_member_name
    from public.hostel_memberships hm left join public.profiles pr on pr.id=hm.user_id
    left join (select member_id,max(member_name_snapshot) member_name_snapshot from public.daily_meal_records where period_id=p_period_id group by member_id) m on m.member_id=hm.id
    where hm.id=p_membership_id;
  select coalesce(sum(coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0)+coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0)+coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0)),0)
    into v_meals from public.daily_meal_records r join public.daily_meal_days d on d.id=r.daily_meal_day_id
    where r.period_id=p_period_id and r.member_id=p_membership_id and not r.cancelled and d.status='finalized';
  select coalesce(sum(coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0)+coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0)+coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0)),0)
    into v_all_meals from public.daily_meal_records r join public.daily_meal_days d on d.id=r.daily_meal_day_id
    where r.period_id=p_period_id and not r.cancelled and d.status='finalized';
  select coalesce(sum(me.total_amount),0) into v_market from public.market_entries me where me.period_id=p_period_id and me.status='active';
  select coalesce(sum(case when l.ledger_type='deposit' and l.amount>0 then l.amount else 0 end),0),
         coalesce(sum(case when l.ledger_type='market_deposit' and l.amount>0 then l.amount else 0 end),0),
         coalesce(sum(case when l.ledger_type='other_expense' then abs(least(l.amount,0)) else 0 end),0),
         coalesce(sum(case when l.ledger_type='adjustment' then l.amount else 0 end),0)
    into v_deposit,v_market_deposit,v_other,v_adjustment
    from public.ledger_transactions l where l.period_id=p_period_id and l.member_id=p_membership_id and l.status='active';
  select coalesce(sum(amount),0) into v_khala from public.khala_money_entries k where k.period_id=p_period_id and k.member_id=p_membership_id and k.status='active';
  if v_all_meals>0 then v_rate:=v_market/v_all_meals; end if;
  v_balance:=v_deposit+v_market_deposit+v_adjustment-(v_meals*v_rate)-v_other-v_khala;
  return jsonb_build_object('name',v_member_name,'member_name',v_member_name,'meals',v_meals,'final_meals',v_meals,
    'deposit',v_deposit+v_market_deposit,'cash_deposit',v_deposit,'market_deposit',v_market_deposit,
    'meal_cost',round(v_meals*v_rate,2),'other_expense',v_other+v_khala,'khala_money',v_khala,
    'balance',round(v_balance,2),'meal_rate',round(v_rate,4),'total_market',v_market);
end $$;

create or replace function private.get_request_json(p_request public.meal_requests)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('request_id',(p_request).id,'id',(p_request).id,'membership_id',(p_request).membership_id,
   'member_id',(p_request).membership_id,'member_name',(p_request).member_name_snapshot,'request_type',(p_request).request_type,
   'origin',(p_request).origin,'is_late_request',(p_request).is_late_request,'status',(p_request).status,
   'start_date',(p_request).start_date,'end_date',(p_request).end_date,'days',(p_request).days,'reason',(p_request).reason,
   'review_reason',(p_request).review_reason,'manager_note',(p_request).manager_note,'manager_edited',(p_request).manager_edited,
   'manager_updated_at',(p_request).manager_updated_at,'submitted_at',(p_request).submitted_at,'reviewed_at',(p_request).reviewed_at,
   'parent_request_id',(p_request).parent_request_id,'period_id',(p_request).period_id)
$$;

-- ---------------------------------------------------------------------------
-- 05. Member directory, running period, dashboard and offline RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_member_directory_v4()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid; v_period public.monthly_periods%rowtype; v_result jsonb;
begin
  perform private.assert_signed_in(); v_hostel:=private.my_hostel_id();
  if v_hostel is null then return '[]'::jsonb; end if;
  select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' order by start_date desc limit 1;
  if found then perform private.finalize_due_days(v_hostel,v_period.id); end if;
  select coalesce(jsonb_agg(x.row_data order by x.member_name),'[]'::jsonb) into v_result
  from (
    select p.full_name member_name,jsonb_build_object(
      'membership_id',m.id,'member_id',m.id,'user_id',m.user_id,'member_name',p.full_name,'full_name',p.full_name,'phone',p.phone,
      'role',m.role,'member_status',m.status,'status',m.status,'is_primary_manager',case when v_period.id is not null then v_period.primary_manager_membership_id=m.id else m.role='manager' end,
      'is_assistant_manager',case when v_period.id is not null then exists(select 1 from public.period_assistant_managers a where a.period_id=v_period.id and a.membership_id=m.id) else false end,
      'meal_activity',case when v_period.id is null then 'এখনো মাস শুরু হয়নি' when exists(select 1 from public.daily_meal_records r join public.daily_meal_days d on d.id=r.daily_meal_day_id where r.period_id=v_period.id and r.member_id=m.id and not r.cancelled and d.status='finalized') then 'এই মাসে মিল আছে' else 'এই মাসে মিল নেই' end,
      'final_meals',coalesce((private.member_financials(v_period.id,m.id)->>'final_meals')::numeric,0),
      'meals',coalesce((private.member_financials(v_period.id,m.id)->>'meals')::numeric,0),
      'deposit',coalesce((private.member_financials(v_period.id,m.id)->>'deposit')::numeric,0),
      'meal_cost',coalesce((private.member_financials(v_period.id,m.id)->>'meal_cost')::numeric,0),
      'other_expense',coalesce((private.member_financials(v_period.id,m.id)->>'other_expense')::numeric,0),
      'balance',coalesce((private.member_financials(v_period.id,m.id)->>'balance')::numeric,0)
    ) row_data
    from public.hostel_memberships m join public.profiles p on p.id=m.user_id
    where m.hostel_id=v_hostel and m.status in ('active','inactive') and not p.is_blocked
  ) x;
  return v_result;
end $$;

create or replace function public.get_member_directory_v3() returns jsonb language sql security definer set search_path = '' as $$ select public.get_member_directory_v4() $$;
create or replace function public.get_member_directory_v2() returns jsonb language sql security definer set search_path = '' as $$ select public.get_member_directory_v4() $$;
create or replace function public.get_member_directory() returns jsonb language sql security definer set search_path = '' as $$ select public.get_member_directory_v4() $$;

create or replace function public.get_running_period_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid; v_member uuid; v_period public.monthly_periods%rowtype; v_period_json jsonb; v_assistants jsonb;
begin
  perform private.assert_signed_in(); v_hostel:=private.my_hostel_id(); v_member:=private.my_membership_id();
  if v_hostel is null then return jsonb_build_object('has_running_period',false,'period',null); end if;
  select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' order by start_date desc limit 1;
  if not found then return jsonb_build_object('has_running_period',false,'period',null,'today',(now() at time zone 'Asia/Dhaka')::date); end if;
  select coalesce(jsonb_agg(jsonb_build_object('membership_id',m.id,'user_id',m.user_id,'member_name',p.full_name,'full_name',p.full_name,'role',m.role) order by p.full_name),'[]'::jsonb)
    into v_assistants from public.period_assistant_managers a join public.hostel_memberships m on m.id=a.membership_id join public.profiles p on p.id=m.user_id where a.period_id=v_period.id;
  v_period_json:=jsonb_build_object('id',v_period.id,'period_id',v_period.id,'hostel_id',v_period.hostel_id,'label',v_period.label,
    'start_date',v_period.start_date,'end_date',v_period.end_date,'status',v_period.status,
    'primary_manager_membership_id',v_period.primary_manager_membership_id,'assistant_managers',v_assistants,
    'is_primary_manager',v_period.primary_manager_membership_id=v_member,
    'is_assistant_manager',exists(select 1 from public.period_assistant_managers a where a.period_id=v_period.id and a.membership_id=v_member));
  return jsonb_build_object('today',(now() at time zone 'Asia/Dhaka')::date,'has_running_period',true,'period',v_period_json,
    'can_manage_month',v_period.primary_manager_membership_id=v_member);
end $$;

create or replace function public.get_month_management_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_payload jsonb; v_period jsonb; v_hostel uuid;
begin
  v_hostel:=private.my_hostel_id(); v_payload:=public.get_running_period_context(); v_period:=v_payload->'period';
  return jsonb_build_object('today',(now() at time zone 'Asia/Dhaka')::date,'has_running_period',coalesce((v_payload->>'has_running_period')::boolean,false),
    'period',v_period,'can_manage_month',case when v_hostel is null then false else private.is_primary_manager(v_hostel,case when v_period is null or v_period='null'::jsonb then null else (v_period->>'period_id')::uuid end) end);
end $$;

create or replace function public.get_dashboard_data()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid; v_member uuid; v_period public.monthly_periods%rowtype; v_period_json jsonb; v_day public.daily_meal_days%rowtype;
 v_meal jsonb; v_members jsonb; v_own jsonb; v_total_market numeric:=0; v_total_meals numeric:=0; v_total_deposit numeric:=0; v_other numeric:=0;
begin
  perform private.assert_signed_in(); v_hostel:=private.my_hostel_id(); v_member:=private.my_membership_id();
  if v_hostel is null then return jsonb_build_object('has_running_period',false,'period',null,'members','[]'::jsonb,'meal_card',null); end if;
  select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' order by start_date desc limit 1;
  if not found then return jsonb_build_object('has_running_period',false,'period',null,'members',public.get_member_directory_v4(),'meal_card',null); end if;
  perform private.finalize_due_days(v_hostel,v_period.id);
  v_period_json:=jsonb_build_object('id',v_period.id,'period_id',v_period.id,'hostel_id',v_period.hostel_id,'label',v_period.label,'start_date',v_period.start_date,'end_date',v_period.end_date,'status',v_period.status,'primary_manager_membership_id',v_period.primary_manager_membership_id);
  select * into v_day from public.daily_meal_days where period_id=v_period.id and meal_date=(now() at time zone 'Asia/Dhaka')::date;
  if found then
    select jsonb_build_object('meal_date',v_day.meal_date,'label',to_char(v_day.meal_date,'DD Mon YYYY'),'breakfast',coalesce(sum(case when not r.cancelled then coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0) else 0 end),0),
      'lunch',coalesce(sum(case when not r.cancelled then coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0) else 0 end),0),
      'dinner',coalesce(sum(case when not r.cancelled then coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0) else 0 end),0),'status',v_day.status)
      into v_meal from public.daily_meal_records r where r.daily_meal_day_id=v_day.id;
  end if;
  v_members:=public.get_member_directory_v4();
  v_own:=private.member_financials(v_period.id,v_member);
  select coalesce(sum(total_amount),0) into v_total_market from public.market_entries where period_id=v_period.id and status='active';
  select coalesce(sum(coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0)+coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0)+coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0)),0)
    into v_total_meals from public.daily_meal_records r join public.daily_meal_days d on d.id=r.daily_meal_day_id where r.period_id=v_period.id and d.status='finalized' and not r.cancelled;
  select coalesce(sum(case when amount>0 and ledger_type in ('deposit','market_deposit') then amount else 0 end),0), coalesce(sum(case when ledger_type='other_expense' then abs(least(amount,0)) else 0 end),0)
   into v_total_deposit,v_other from public.ledger_transactions where period_id=v_period.id and status='active';
  return jsonb_build_object('has_running_period',true,'period',v_period_json,'meal_card',v_meal,
    'summary',jsonb_build_object('total_meals',v_total_meals,'total_market',v_total_market,'meal_rate',case when v_total_meals=0 then 0 else round(v_total_market/v_total_meals,4) end,'total_deposit',v_total_deposit,'other_expense',v_other),
    'my_account',jsonb_build_object('name',v_own->>'name','meals',(v_own->>'meals')::numeric,'deposit',(v_own->>'deposit')::numeric,'meal_cost',(v_own->>'meal_cost')::numeric,'other_expense',(v_own->>'other_expense')::numeric,'balance',(v_own->>'balance')::numeric),
    'members',v_members);
end $$;

create or replace function public.get_meal_details(p_meal_date date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid; v_period uuid; v_result jsonb;
begin
  perform private.assert_signed_in(); v_hostel:=private.my_hostel_id();
  select id into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' and p_meal_date between start_date and end_date limit 1;
  if v_period is not null then perform private.finalize_due_days(v_hostel,v_period); end if;
  select coalesce(jsonb_agg(jsonb_build_object('membership_id',r.member_id,'member_id',r.member_id,'member_name',coalesce(p.full_name,r.member_name_snapshot,'সদস্য'),
   'breakfast',coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0),'lunch',coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0),
   'dinner',coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0),'cancelled',r.cancelled,'finalized',d.status='finalized') order by p.full_name),'[]'::jsonb)
   into v_result from public.daily_meal_days d join public.daily_meal_records r on r.daily_meal_day_id=d.id left join public.hostel_memberships m on m.id=r.member_id left join public.profiles p on p.id=m.user_id
   where d.hostel_id=v_hostel and d.period_id=v_period and d.meal_date=p_meal_date and not r.cancelled;
  return v_result;
end $$;

create or replace function public.get_offline_meal_bundle()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid; v_period public.monthly_periods%rowtype; v_days jsonb; v_rows jsonb; v_dashboard jsonb;
begin
  perform private.assert_signed_in(); v_hostel:=private.my_hostel_id();
  select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' order by start_date desc limit 1;
  if not found then return jsonb_build_object('period',null,'days','[]'::jsonb,'mealRows','[]'::jsonb,'members',public.get_member_directory_v4()); end if;
  perform private.finalize_due_days(v_hostel,v_period.id);
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'period_id',period_id,'meal_date',meal_date,'status',status,'cutoff_at',cutoff_at,'finalizes_at',finalizes_at,'locked_at',locked_at,'finalized_at',finalized_at) order by meal_date),'[]'::jsonb)
   into v_days from public.daily_meal_days where period_id=v_period.id;
  select coalesce(jsonb_agg(jsonb_build_object('date',d.meal_date,'meal_date',d.meal_date,'memberId',r.member_id,'member_id',r.member_id,'memberName',coalesce(p.full_name,r.member_name_snapshot,'সদস্য'),
   'member_name',coalesce(p.full_name,r.member_name_snapshot,'সদস্য'),'breakfast',coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0),
   'lunch',coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0),'dinner',coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0),
   'finalized',d.status='finalized','cancelled',r.cancelled) order by d.meal_date,p.full_name),'[]'::jsonb)
   into v_rows from public.daily_meal_days d join public.daily_meal_records r on r.daily_meal_day_id=d.id left join public.hostel_memberships m on m.id=r.member_id left join public.profiles p on p.id=m.user_id where d.period_id=v_period.id and not r.cancelled;
  v_dashboard:=public.get_dashboard_data();
  return jsonb_build_object('period',v_dashboard->'period','days',v_days,'mealRows',v_rows,'meal_rows',v_rows,'members',v_dashboard->'members','meal_card',v_dashboard->'meal_card','summary',v_dashboard->'summary','my_account',v_dashboard->'my_account');
end $$;

create or replace function public.get_member_period_details(p_member_id uuid,p_period_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid; v_period public.monthly_periods%rowtype; v_member public.hostel_memberships%rowtype; v_sum jsonb; v_meals jsonb; v_tx jsonb; v_markets jsonb;
begin
  perform private.assert_signed_in(); v_hostel:=private.my_hostel_id();
  select * into v_member from public.hostel_memberships where id=p_member_id and hostel_id=v_hostel;
  if not found then raise exception using message='সদস্যের তথ্য পাওয়া যায়নি।',errcode='P0002'; end if;
  if p_member_id<>private.my_membership_id() and not private.can_manage_hostel(v_hostel,p_period_id,false,true) then
    -- Same-hostel members may see the summary needed by the app, but not edit it.
    if not private.can_access_hostel(v_hostel) then raise exception using message='এই তথ্য দেখার অনুমতি নেই।',errcode='42501'; end if;
  end if;
  if p_period_id is null then select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1;
  else select * into v_period from public.monthly_periods where id=p_period_id and hostel_id=v_hostel; end if;
  if not found then return jsonb_build_object('member',jsonb_build_object('id',v_member.id,'name',(select full_name from public.profiles where id=v_member.user_id)),'period',null,'summary',jsonb_build_object(),'daily_meals','[]'::jsonb,'transactions','[]'::jsonb,'market_entries','[]'::jsonb); end if;
  if v_period.status='running' then perform private.finalize_due_days(v_hostel,v_period.id); end if;
  v_sum:=private.member_financials(v_period.id,v_member.id);
  select coalesce(jsonb_agg(jsonb_build_object('date',d.meal_date,'breakfast',coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0),'lunch',coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0),'dinner',coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0),'total',coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0)+coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0)+coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0)) order by d.meal_date),'[]'::jsonb)
   into v_meals from public.daily_meal_records r join public.daily_meal_days d on d.id=r.daily_meal_day_id where r.period_id=v_period.id and r.member_id=v_member.id and d.status='finalized' and not r.cancelled;
  select coalesce(jsonb_agg(jsonb_build_object('transaction_id',l.id,'id',l.id,'member_id',l.member_id,'member_name',l.member_name_snapshot,'transaction_type',l.ledger_type,'ledger_type',l.ledger_type,'amount',l.amount,'entry_date',l.entry_date,'description',l.description,'reference_type',l.reference_type,'reference_id',l.reference_id,'status',l.status,'created_at',l.created_at) order by l.entry_date desc,l.created_at desc),'[]'::jsonb)
   into v_tx from public.ledger_transactions l where l.period_id=v_period.id and l.member_id=v_member.id;
  select coalesce(jsonb_agg(jsonb_build_object('market_entry_id',me.id,'id',me.id,'entry_date',me.entry_date,'total_amount',me.total_amount,'buyer_membership_id',me.buyer_membership_id,
   'credit_to_buyer',me.credit_to_buyer,'status',me.status,'items',coalesce((select jsonb_agg(jsonb_build_object('name',i.item_name,'item_name',i.item_name,'quantity',i.quantity,'amount',i.amount,'serial_no',i.serial_no) order by i.serial_no) from public.market_entry_items i where i.market_entry_id=me.id),'[]'::jsonb)) order by me.entry_date desc),'[]'::jsonb)
   into v_markets from public.market_entries me where me.period_id=v_period.id and me.buyer_membership_id=v_member.id;
  return jsonb_build_object('member',jsonb_build_object('membership_id',v_member.id,'id',v_member.id,'name',(select full_name from public.profiles where id=v_member.user_id),'member_name',(select full_name from public.profiles where id=v_member.user_id)),
   'period',jsonb_build_object('id',v_period.id,'period_id',v_period.id,'label',v_period.label,'start_date',v_period.start_date,'end_date',v_period.end_date,'status',v_period.status),
   'summary',v_sum||jsonb_build_object('total_deposit',v_sum->'deposit','total_market',(select coalesce(sum(total_amount),0) from public.market_entries where period_id=v_period.id and buyer_membership_id=v_member.id and status='active')),
   'daily_meals',v_meals,'transactions',v_tx,'market_entries',v_markets);
end $$;

-- ---------------------------------------------------------------------------
-- 06. Meal-request workflow and manager meal entry RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_my_meal_requests(p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid; v_member uuid; v_result jsonb;
begin
  perform private.assert_signed_in(); v_hostel:=private.my_hostel_id(); v_member:=private.my_membership_id();
  select coalesce(jsonb_agg(private.get_request_json(q) order by q.submitted_at desc),'[]'::jsonb) into v_result
   from (select r.* from public.meal_requests r where r.hostel_id=v_hostel and r.membership_id=v_member order by r.submitted_at desc limit greatest(1,least(coalesce(p_limit,100),500))) q;
  return v_result;
end $$;
create or replace function public.get_my_meal_requests_v2(p_limit integer default 100) returns jsonb language sql stable security definer set search_path = '' as $$ select public.get_my_meal_requests(p_limit) $$;

create or replace function public.get_manager_meal_requests_v3(
 p_period_id uuid default null,p_request_type text default null,p_status text default null,p_late_only boolean default null,p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid; v_period uuid; v_result jsonb;
begin
  perform private.assert_signed_in(); v_hostel:=private.my_hostel_id();
  if v_hostel is null or not private.can_manage_hostel(v_hostel,p_period_id,false,true) then raise exception using message='মিল অনুরোধের তালিকা দেখার অনুমতি নেই।',errcode='42501'; end if;
  if p_period_id is null then select id into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1; else v_period:=p_period_id; end if;
  select coalesce(jsonb_agg(private.get_request_json(q) || jsonb_build_object('member_name',coalesce(p.full_name,q.member_name_snapshot),'member_status',m.status) order by q.submitted_at desc),'[]'::jsonb)
  into v_result from (
    select r.* from public.meal_requests r where r.hostel_id=v_hostel and (v_period is null or r.period_id=v_period)
      and (p_request_type is null or r.request_type=p_request_type)
      and (p_status is null or r.status=p_status)
      and (p_late_only is null or r.is_late_request=p_late_only)
    order by r.submitted_at desc limit greatest(1,least(coalesce(p_limit,200),1000))
  ) q left join public.hostel_memberships m on m.id=q.membership_id left join public.profiles p on p.id=m.user_id;
  return v_result;
end $$;
create or replace function public.get_manager_meal_requests_v2(p_period_id uuid default null,p_request_type text default null,p_status text default null,p_limit integer default 200)
returns jsonb language sql stable security definer set search_path = '' as $$ select public.get_manager_meal_requests_v3(p_period_id,p_request_type,p_status,null,p_limit) $$;
create or replace function public.manager_get_meal_requests(p_period_id uuid default null,p_request_type text default null,p_status text default null,p_limit integer default 200)
returns jsonb language sql stable security definer set search_path = '' as $$ select public.get_manager_meal_requests_v3(p_period_id,p_request_type,p_status,null,p_limit) $$;

create or replace function private.create_meal_request_internal(
 p_membership_id uuid,p_start_date date,p_end_date date,p_days jsonb,p_request_type text,p_is_late boolean,p_reason text,p_origin text,p_parent_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid; v_period public.monthly_periods%rowtype; v_req public.meal_requests%rowtype; v_member public.hostel_memberships%rowtype;
begin
  perform private.assert_signed_in();
  if p_start_date is null or p_end_date is null or p_end_date<p_start_date then raise exception using message='শুরুর ও শেষ তারিখ সঠিকভাবে দিন।',errcode='22023'; end if;
  select * into v_member from public.hostel_memberships where id=p_membership_id and status='active';
  if not found then raise exception using message='সক্রিয় সদস্যের তথ্য পাওয়া যায়নি।',errcode='P0002'; end if;
  v_hostel:=v_member.hostel_id;
  select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' and p_start_date>=start_date and p_end_date<=end_date order by start_date desc limit 1;
  if not found then raise exception using message='নির্বাচিত তারিখগুলো চলমান মাসের মধ্যে নেই।',errcode='22023'; end if;
  perform private.assert_meal_days(p_days,v_period.id,p_is_late or p_request_type='correction');
  if p_is_late and jsonb_array_length(p_days)<>1 then raise exception using message='লেট মিল অনুরোধে একটি দিনের তথ্য দিতে হবে।',errcode='22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_days) pd
    join public.meal_requests r on r.period_id=v_period.id and r.membership_id=p_membership_id and r.status in ('submitted','approved')
    cross join lateral jsonb_array_elements(r.days) rd
    where (pd->>'meal_date')::date=(rd->>'meal_date')::date and r.request_type='normal' and p_request_type='normal' and not p_is_late and not r.is_late_request
      and (p_parent_request_id is null or r.id<>p_parent_request_id)
  ) then raise exception using message='একই তারিখের মিলের অনুরোধ আগে থেকেই আছে। আগের অনুরোধটি সম্পাদনা বা সংশোধন করুন।',errcode='23505'; end if;
  insert into public.meal_requests(hostel_id,period_id,membership_id,member_name_snapshot,request_type,origin,is_late_request,start_date,end_date,days,reason,parent_request_id,created_by)
  values(v_hostel,v_period.id,p_membership_id,(select full_name from public.profiles where id=v_member.user_id),p_request_type,p_origin,p_is_late,p_start_date,p_end_date,p_days,nullif(btrim(p_reason),''),p_parent_request_id,auth.uid())
  returning * into v_req;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details)
   values(v_hostel,v_period.id,auth.uid(),'insert:meal_request','মিলের অনুরোধ তৈরি হয়েছে',jsonb_build_object('request_id',v_req.id,'membership_id',p_membership_id,'request_type',p_request_type,'days_count',jsonb_array_length(p_days)));
  return private.get_request_json(v_req);
end $$;

create or replace function public.create_meal_request(p_start_date date,p_end_date date,p_days jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin return private.create_meal_request_internal(private.my_membership_id(),p_start_date,p_end_date,p_days,'normal',false,null,'member',null); end $$;

create or replace function public.create_late_meal_request(p_meal_date date,p_breakfast numeric,p_lunch numeric,p_dinner numeric,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_days jsonb;
begin
  v_days:=jsonb_build_array(jsonb_build_object('meal_date',p_meal_date,'breakfast',p_breakfast,'lunch',p_lunch,'dinner',p_dinner));
  return private.create_meal_request_internal(private.my_membership_id(),p_meal_date,p_meal_date,v_days,'normal',true,p_reason,'member',null);
end $$;

create or replace function public.create_meal_correction_request(p_start_date date,p_end_date date,p_days jsonb,p_parent_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin return private.create_meal_request_internal(private.my_membership_id(),p_start_date,p_end_date,p_days,'correction',false,'সদস্যের সংশোধন অনুরোধ','member',p_parent_request_id); end $$;

create or replace function public.manager_create_member_meal_request(p_member_id uuid,p_start_date date,p_end_date date,p_days jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid;
begin
  perform private.assert_signed_in(); v_hostel:=private.my_hostel_id();
  perform private.assert_hostel_manager(v_hostel,null,false,false);
  if not exists(select 1 from public.hostel_memberships where id=p_member_id and hostel_id=v_hostel and status='active') then raise exception using message='নির্বাচিত সদস্য এই মেসের সক্রিয় সদস্য নন।',errcode='42501'; end if;
  return private.create_meal_request_internal(p_member_id,p_start_date,p_end_date,p_days,'normal',false,'ম্যানেজার কর্তৃক যোগ করা হয়েছে','manager',null);
end $$;

create or replace function public.edit_my_approved_meal_request(p_request_id uuid,p_start_date date,p_end_date date,p_days jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_req public.meal_requests%rowtype; v_period public.monthly_periods%rowtype;
begin
  perform private.assert_signed_in();
  select * into v_req from public.meal_requests where id=p_request_id and membership_id=private.my_membership_id();
  if not found or v_req.status<>'approved' or v_req.request_type<>'normal' or v_req.is_late_request then raise exception using message='শুধু নিজের অনুমোদিত সাধারণ মিল অনুরোধ সম্পাদনা করা যাবে।',errcode='42501'; end if;
  select * into v_period from public.monthly_periods where id=v_req.period_id and status='running';
  if not found then raise exception using message='এই মাসটি আর চলমান নেই।',errcode='55000'; end if;
  if exists(select 1 from jsonb_array_elements(p_days) d join public.daily_meal_days md on md.period_id=v_req.period_id and md.meal_date=(d->>'meal_date')::date where md.status='finalized' or md.cutoff_at<=now()) then
    raise exception using message='কাট-অফ পার হওয়া বা ফাইনাল দিনের মিল এভাবে সম্পাদনা করা যাবে না। সংশোধনের অনুরোধ দিন।',errcode='55000'; end if;
  perform private.assert_meal_days(p_days,v_req.period_id,false);
  update public.meal_requests set start_date=p_start_date,end_date=p_end_date,days=p_days,updated_at=now() where id=v_req.id returning * into v_req;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_req.hostel_id,v_req.period_id,auth.uid(),'update:meal_request','অনুমোদিত মিল অনুরোধ সম্পাদিত হয়েছে',jsonb_build_object('request_id',v_req.id));
  return private.get_request_json(v_req);
end $$;

create or replace function public.manager_update_submitted_meal_request(p_request_id uuid,p_days jsonb,p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_req public.meal_requests%rowtype;
begin
  select * into v_req from public.meal_requests where id=p_request_id;
  if not found then raise exception using message='মিল অনুরোধটি পাওয়া যায়নি।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_req.hostel_id,v_req.period_id,false,true);
  if v_req.status<>'submitted' then raise exception using message='শুধু অপেক্ষমাণ অনুরোধ সম্পাদনা করা যাবে।',errcode='55000'; end if;
  perform private.assert_meal_days(p_days,v_req.period_id,true);
  if exists(select 1 from jsonb_array_elements(p_days) d join public.daily_meal_days md on md.period_id=v_req.period_id and md.meal_date=(d->>'meal_date')::date where md.status='finalized') then raise exception using message='ফাইনাল হওয়া দিনের অপেক্ষমাণ অনুরোধে পরিবর্তন করা যাবে না।',errcode='55000'; end if;
  update public.meal_requests set days=p_days,start_date=(select min((value->>'meal_date')::date) from jsonb_array_elements(p_days)),end_date=(select max((value->>'meal_date')::date) from jsonb_array_elements(p_days)),manager_note=nullif(btrim(p_note),''),manager_edited=true,manager_updated_at=now(),updated_at=now() where id=v_req.id returning * into v_req;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_req.hostel_id,v_req.period_id,auth.uid(),'update:meal_request','ম্যানেজার অপেক্ষমাণ মিল অনুরোধ আপডেট করেছেন',jsonb_build_object('request_id',v_req.id,'note',p_note));
  return private.get_request_json(v_req);
end $$;

create or replace function public.manager_review_correction(p_request_id uuid,p_approve boolean,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_req public.meal_requests%rowtype;
begin
  select * into v_req from public.meal_requests where id=p_request_id;
  if not found then raise exception using message='সংশোধন অনুরোধটি পাওয়া যায়নি।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_req.hostel_id,v_req.period_id,false,true);
  if v_req.status<>'submitted' or v_req.request_type<>'correction' then raise exception using message='এই সংশোধন অনুরোধটি আর অপেক্ষমাণ নেই।',errcode='55000'; end if;
  update public.meal_requests set status=case when p_approve then 'approved' else 'rejected' end,review_reason=nullif(btrim(p_reason),''),reviewed_by=auth.uid(),reviewed_at=now() where id=v_req.id returning * into v_req;
  if p_approve then perform private.apply_request_days(v_req.id); end if;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_req.hostel_id,v_req.period_id,auth.uid(),case when p_approve then 'update:correction_approved' else 'update:correction_rejected' end,case when p_approve then 'মিল সংশোধন অনুমোদিত হয়েছে' else 'মিল সংশোধন প্রত্যাখ্যান হয়েছে' end,jsonb_build_object('request_id',v_req.id,'reason',p_reason));
  return private.get_request_json(v_req);
end $$;

create or replace function public.manager_review_late_meal_request(p_request_id uuid,p_approve boolean,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_req public.meal_requests%rowtype;
begin
  select * into v_req from public.meal_requests where id=p_request_id;
  if not found then raise exception using message='লেট মিল অনুরোধটি পাওয়া যায়নি।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_req.hostel_id,v_req.period_id,false,true);
  if v_req.status<>'submitted' or not v_req.is_late_request then raise exception using message='এই লেট মিল অনুরোধটি আর অপেক্ষমাণ নেই।',errcode='55000'; end if;
  update public.meal_requests set status=case when p_approve then 'approved' else 'rejected' end,review_reason=nullif(btrim(p_reason),''),reviewed_by=auth.uid(),reviewed_at=now() where id=v_req.id returning * into v_req;
  if p_approve then perform private.apply_request_days(v_req.id); end if;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_req.hostel_id,v_req.period_id,auth.uid(),case when p_approve then 'update:late_meal_approved' else 'update:late_meal_rejected' end,case when p_approve then 'লেট মিল অনুরোধ অনুমোদিত হয়েছে' else 'লেট মিল অনুরোধ প্রত্যাখ্যান হয়েছে' end,jsonb_build_object('request_id',v_req.id,'reason',p_reason));
  return private.get_request_json(v_req);
end $$;

create or replace function public.manager_edit_approved_meal_request(p_request_id uuid,p_days jsonb,p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_req public.meal_requests%rowtype;
begin
  select * into v_req from public.meal_requests where id=p_request_id;
  if not found then raise exception using message='মিল অনুরোধটি পাওয়া যায়নি।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_req.hostel_id,v_req.period_id,false,true);
  if v_req.status not in ('submitted','approved') then raise exception using message='এই অনুরোধটি আর সম্পাদনা করা যাবে না।',errcode='55000'; end if;
  perform private.assert_meal_days(p_days,v_req.period_id,true);
  update public.meal_requests set days=p_days,start_date=(select min((value->>'meal_date')::date) from jsonb_array_elements(p_days)),end_date=(select max((value->>'meal_date')::date) from jsonb_array_elements(p_days)),manager_note=nullif(btrim(p_note),''),manager_edited=true,manager_updated_at=now(),updated_at=now() where id=v_req.id returning * into v_req;
  if v_req.status='approved' then perform private.apply_request_days(v_req.id); end if;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_req.hostel_id,v_req.period_id,auth.uid(),'update:manager_meal_edit','ম্যানেজার মিল অনুরোধ সম্পাদনা করেছেন',jsonb_build_object('request_id',v_req.id,'note',p_note));
  return private.get_request_json(v_req);
end $$;

create or replace function public.manager_save_my_meal(p_start_date date,p_end_date date,p_days jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_req jsonb; v_member uuid:=private.my_membership_id(); v_hostel uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype; v_row public.meal_requests%rowtype;
begin
  perform private.assert_signed_in(); perform private.assert_hostel_manager(v_hostel,null,false,false);
  select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' and p_start_date>=start_date and p_end_date<=end_date limit 1;
  if not found then raise exception using message='নির্বাচিত তারিখগুলো চলমান মাসের মধ্যে নেই।',errcode='22023'; end if;
  perform private.assert_meal_days(p_days,v_period.id,false);
  insert into public.meal_requests(hostel_id,period_id,membership_id,member_name_snapshot,request_type,origin,start_date,end_date,days,status,created_by,reviewed_by,reviewed_at)
   values(v_hostel,v_period.id,v_member,(select full_name from public.profiles where id=auth.uid()),'normal','manager_self',p_start_date,p_end_date,p_days,'approved',auth.uid(),auth.uid(),now()) returning * into v_row;
  perform private.apply_request_days(v_row.id);
  return jsonb_build_object('request_id',v_row.id,'status','approved','saved_count',jsonb_array_length(p_days));
end $$;

create or replace function public.manager_emergency_override_my_meal(p_meal_date date,p_breakfast numeric,p_lunch numeric,p_dinner numeric,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_member uuid:=private.my_membership_id(); v_period public.monthly_periods%rowtype; v_day public.daily_meal_days%rowtype; v_record public.daily_meal_records%rowtype;
begin
  perform private.assert_signed_in(); perform private.assert_hostel_manager(v_hostel,null,true,false);
  if not private.is_valid_meal(p_breakfast) or not private.is_valid_meal(p_lunch) or not private.is_valid_meal(p_dinner) then raise exception using message='মিলের পরিমাণ ০ থেকে ৫০-এর মধ্যে এবং ০.৫ ধাপে হতে হবে।',errcode='22023'; end if;
  select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' and p_meal_date between start_date and end_date limit 1;
  if not found then raise exception using message='তারিখটি চলমান মাসের মধ্যে নেই।',errcode='22023'; end if;
  select * into v_day from public.daily_meal_days where period_id=v_period.id and meal_date=p_meal_date;
  if not found then raise exception using message='তারিখের মিল-দিন পাওয়া যায়নি।',errcode='P0002'; end if;
  insert into public.daily_meal_records(hostel_id,period_id,daily_meal_day_id,member_id,member_name_snapshot,planned_breakfast,planned_lunch,planned_dinner,actual_breakfast,actual_lunch,actual_dinner,final_breakfast,final_lunch,final_dinner,finalization_source,finalized_by,finalized_at,updated_by)
  values(v_hostel,v_period.id,v_day.id,v_member,(select full_name from public.profiles where id=auth.uid()),p_breakfast,p_lunch,p_dinner,p_breakfast,p_lunch,p_dinner,
    case when v_day.status='finalized' then p_breakfast end,case when v_day.status='finalized' then p_lunch end,case when v_day.status='finalized' then p_dinner end,
    'emergency_override',auth.uid(),case when v_day.status='finalized' then now() end,auth.uid())
  on conflict(daily_meal_day_id,member_id) do update set planned_breakfast=excluded.planned_breakfast,planned_lunch=excluded.planned_lunch,planned_dinner=excluded.planned_dinner,
    actual_breakfast=excluded.actual_breakfast,actual_lunch=excluded.actual_lunch,actual_dinner=excluded.actual_dinner,
    final_breakfast=coalesce(excluded.final_breakfast,public.daily_meal_records.final_breakfast),final_lunch=coalesce(excluded.final_lunch,public.daily_meal_records.final_lunch),final_dinner=coalesce(excluded.final_dinner,public.daily_meal_records.final_dinner),
    finalization_source=case when v_day.status='finalized' then 'emergency_override' else public.daily_meal_records.finalization_source end,
    finalized_by=case when v_day.status='finalized' then auth.uid() else public.daily_meal_records.finalized_by end,
    finalized_at=case when v_day.status='finalized' then now() else public.daily_meal_records.finalized_at end,updated_by=auth.uid(),updated_at=now() returning * into v_record;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_hostel,v_period.id,auth.uid(),'update:emergency_override','জরুরি মিল ওভাররাইড করা হয়েছে',jsonb_build_object('meal_date',p_meal_date,'reason',p_reason,'record_id',v_record.id));
  return jsonb_build_object('status','success','meal_date',p_meal_date,'reason',p_reason);
end $$;

create or replace function public.manager_set_meal_entries(p_entries jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item jsonb; v_hostel uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype; v_day public.daily_meal_days%rowtype; v_record public.daily_meal_records%rowtype; v_member uuid; v_date date; v_saved integer:=0;
begin
  perform private.assert_signed_in(); perform private.assert_hostel_manager(v_hostel,null,true,false);
  if p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)=0 then raise exception using message='সংরক্ষণের জন্য মিলের তথ্য নেই।',errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_entries) loop
    v_member:=(v_item->>'member_id')::uuid; v_date:=(v_item->>'meal_date')::date;
    if not private.is_valid_meal((v_item->>'breakfast')::numeric) or not private.is_valid_meal((v_item->>'lunch')::numeric) or not private.is_valid_meal((v_item->>'dinner')::numeric) then raise exception using message='মিলের পরিমাণ সঠিক নয়।',errcode='22023'; end if;
    select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' and v_date between start_date and end_date limit 1;
    if not found then raise exception using message='একটি বা একাধিক তারিখ চলমান মাসের বাইরে।',errcode='22023'; end if;
    select * into v_day from public.daily_meal_days where period_id=v_period.id and meal_date=v_date;
    if not found or v_day.status<>'finalized' then raise exception using message='শুধু চূড়ান্ত হওয়া দিনের মিল সংশোধন করা যাবে।',errcode='55000'; end if;
    select * into v_record from public.daily_meal_records where daily_meal_day_id=v_day.id and member_id=v_member and not cancelled;
    if not found or (v_record.finalized_at is null and v_record.final_breakfast is null and v_record.final_lunch is null and v_record.final_dinner is null) then
      raise exception using message='শুধু আগে চূড়ান্ত মিল থাকা সদস্যের হিসাব সংশোধন করা যাবে।',errcode='55000'; end if;
    update public.daily_meal_records set final_breakfast=(v_item->>'breakfast')::numeric,final_lunch=(v_item->>'lunch')::numeric,final_dinner=(v_item->>'dinner')::numeric,
      actual_breakfast=(v_item->>'breakfast')::numeric,actual_lunch=(v_item->>'lunch')::numeric,actual_dinner=(v_item->>'dinner')::numeric,finalization_source='manager_edit',finalized_by=auth.uid(),finalized_at=now(),updated_by=auth.uid()
      where id=v_record.id;
    insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_hostel,v_period.id,auth.uid(),'update:final_meal','চূড়ান্ত মিল সংশোধন করা হয়েছে',jsonb_build_object('record_id',v_record.id,'member_id',v_member,'meal_date',v_date,'values',v_item));
    v_saved:=v_saved+1;
  end loop;
  return jsonb_build_object('saved_count',v_saved,'status','success');
end $$;

create or replace function public.manager_check_meal_entry_conflicts(p_entries jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_item jsonb; v_member uuid; v_date date; v_name text; v_result jsonb:='[]'::jsonb; v_found boolean;
begin
  perform private.assert_signed_in(); perform private.assert_hostel_manager(v_hostel,null,true,false);
  for v_item in select value from jsonb_array_elements(coalesce(p_entries,'[]'::jsonb)) loop
    v_member:=(v_item->>'member_id')::uuid; v_date:=(v_item->>'meal_date')::date; v_found:=false;
    select p.full_name into v_name from public.hostel_memberships m join public.profiles p on p.id=m.user_id where m.id=v_member and m.hostel_id=v_hostel;
    if exists(select 1 from public.meal_requests mr cross join lateral jsonb_array_elements(mr.days) d where mr.membership_id=v_member and mr.hostel_id=v_hostel and mr.status in ('submitted','approved') and (d->>'meal_date')::date=v_date)
      or exists(select 1 from public.daily_meal_records r join public.daily_meal_days md on md.id=r.daily_meal_day_id where r.member_id=v_member and md.hostel_id=v_hostel and md.meal_date=v_date and not r.cancelled) then v_found:=true; end if;
    if v_found then v_result:=v_result||jsonb_build_array(jsonb_build_object('member_id',v_member,'meal_date',v_date,'member_name',v_name,'message','আগের মিল অনুরোধ বা মিল এন্ট্রি আছে')); end if;
  end loop;
  return v_result;
end $$;

create or replace function public.get_meal_request_overlap_details(p_period_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period uuid:=p_period_id; v_result jsonb;
begin
  perform private.assert_signed_in(); if not private.can_manage_hostel(v_hostel,p_period_id,false,true) then raise exception using message='মিল অনুরোধের সংঘর্ষের তথ্য দেখার অনুমতি নেই।',errcode='42501'; end if;
  if v_period is null then select id into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1; end if;
  select coalesce(jsonb_agg(jsonb_build_object('request_id',r.id,'member_id',r.membership_id,'member_name',coalesce(p.full_name,r.member_name_snapshot),'status',r.status,'request_type',r.request_type,'meal_date',(d->>'meal_date')::date) order by (d->>'meal_date')::date),'[]'::jsonb)
   into v_result from public.meal_requests r cross join lateral jsonb_array_elements(r.days) d left join public.hostel_memberships m on m.id=r.membership_id left join public.profiles p on p.id=m.user_id
   where r.hostel_id=v_hostel and r.period_id=v_period and r.status in ('submitted','approved')
     and exists(select 1 from public.meal_requests r2 cross join lateral jsonb_array_elements(r2.days) d2 where r2.id<>r.id and r2.membership_id=r.membership_id and r2.period_id=r.period_id and r2.status in ('submitted','approved') and (d2->>'meal_date')::date=(d->>'meal_date')::date);
  return v_result;
end $$;

-- Tighten period-aware permissions: historical edits require an explicit archive
-- grant (unless the caller is a Super Admin); current-role authority is for a
-- currently running period only.
create or replace function private.can_manage_hostel(p_hostel_id uuid, p_period_id uuid default null, p_primary_only boolean default false, p_allow_archive boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_super_admin()
    or exists (
      select 1 from public.monthly_periods mp
      where mp.hostel_id=p_hostel_id and mp.status='running' and (p_period_id is null or mp.id=p_period_id)
        and (
          exists(select 1 from public.hostel_memberships m join public.profiles p on p.id=m.user_id where m.id=mp.primary_manager_membership_id and m.user_id=auth.uid() and m.status='active' and not p.is_blocked)
          or (not p_primary_only and exists(select 1 from public.period_assistant_managers a join public.hostel_memberships m on m.id=a.membership_id join public.profiles p on p.id=m.user_id where a.period_id=mp.id and m.user_id=auth.uid() and m.status='active' and not p.is_blocked))
        )
    )
    or (p_period_id is null and exists(
      select 1 from public.hostel_memberships m join public.profiles p on p.id=m.user_id
      where m.hostel_id=p_hostel_id and m.user_id=auth.uid() and m.role='manager' and m.status='active' and not p.is_blocked
        and not exists(select 1 from public.monthly_periods mp where mp.hostel_id=p_hostel_id and mp.status='running')
    ))
    or (p_allow_archive and exists (
      select 1 from public.archive_edit_permissions a join public.hostel_memberships m on m.id=a.membership_id
      where a.hostel_id=p_hostel_id and a.period_id=p_period_id and a.membership_id=private.my_membership_id()
        and a.revoked_at is null and (a.expires_at is null or a.expires_at>now()) and m.status='active' and m.user_id=auth.uid()
    ))
$$;

-- ---------------------------------------------------------------------------
-- 07. Market, ledger and khala-money writes
-- ---------------------------------------------------------------------------
create or replace function private.write_market_items(p_entry_id uuid,p_items jsonb)
returns numeric language plpgsql security definer set search_path = '' as $$
declare v_item jsonb; v_name text; v_qty text; v_amount numeric; v_total numeric:=0; v_serial integer:=0;
begin
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception using message='বাজারের অন্তত একটি আইটেম যোগ করুন।',errcode='22023'; end if;
  if jsonb_array_length(p_items)>100 then raise exception using message='একটি বাজারে সর্বোচ্চ ১০০টি আইটেম যোগ করা যাবে।',errcode='22023'; end if;
  delete from public.market_entry_items where market_entry_id=p_entry_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_name:=btrim(coalesce(v_item->>'item_name',v_item->>'name',''));
    v_qty:=nullif(btrim(coalesce(v_item->>'quantity','')),'');
    begin v_amount:=coalesce((v_item->>'amount')::numeric,0); exception when others then raise exception using message='বাজারের টাকার পরিমাণ সঠিক নয়।',errcode='22023'; end;
    if v_name='' or length(v_name)>160 or v_amount<0 then raise exception using message='প্রতিটি বাজার আইটেমের নাম ও সঠিক টাকার পরিমাণ দিতে হবে।',errcode='22023'; end if;
    v_serial:=v_serial+1; v_total:=v_total+v_amount;
    insert into public.market_entry_items(market_entry_id,serial_no,item_name,quantity,amount) values(p_entry_id,v_serial,v_name,v_qty,round(v_amount,2));
  end loop;
  return round(v_total,2);
end $$;

create or replace function private.sync_market_credit(p_entry_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_entry public.market_entries%rowtype;
begin
  select * into v_entry from public.market_entries where id=p_entry_id;
  if not found then return; end if;
  update public.ledger_transactions set status='void',amount=0,updated_by=auth.uid(),updated_at=now()
    where reference_type='market_entry' and reference_id=v_entry.id and ledger_type='market_deposit';
  if v_entry.status='active' and v_entry.credit_to_buyer and v_entry.buyer_membership_id is not null then
    insert into public.ledger_transactions(hostel_id,period_id,member_id,member_name_snapshot,entry_date,ledger_type,ledger_group,amount,description,reference_type,reference_id,created_by)
    values(v_entry.hostel_id,v_entry.period_id,v_entry.buyer_membership_id,v_entry.buyer_name_snapshot,v_entry.entry_date,'market_deposit','market',v_entry.total_amount,'বাজারের টাকা সদস্যের জমায় যোগ', 'market_entry',v_entry.id,auth.uid());
  end if;
end $$;

create or replace function public.create_market_entry(p_entry_date date,p_buyer_membership_id uuid,p_items jsonb,p_credit_to_buyer boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype; v_member public.hostel_memberships%rowtype; v_entry public.market_entries%rowtype; v_total numeric;
begin
  perform private.assert_signed_in(); perform private.assert_hostel_manager(v_hostel,null,false,false);
  select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' and p_entry_date between start_date and end_date limit 1;
  if not found then raise exception using message='বাজারের তারিখটি চলমান মাসের মধ্যে হতে হবে।',errcode='22023'; end if;
  select * into v_member from public.hostel_memberships where id=p_buyer_membership_id and hostel_id=v_hostel and status='active';
  if not found then raise exception using message='বাজারকারীর সক্রিয় সদস্য-তথ্য পাওয়া যায়নি।',errcode='P0002'; end if;
  insert into public.market_entries(hostel_id,period_id,entry_date,buyer_membership_id,buyer_name_snapshot,credit_to_buyer,created_by,updated_by)
   values(v_hostel,v_period.id,p_entry_date,p_buyer_membership_id,(select full_name from public.profiles where id=v_member.user_id),coalesce(p_credit_to_buyer,true),auth.uid(),auth.uid()) returning * into v_entry;
  v_total:=private.write_market_items(v_entry.id,p_items);
  update public.market_entries set total_amount=v_total where id=v_entry.id returning * into v_entry;
  perform private.sync_market_credit(v_entry.id);
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_hostel,v_period.id,auth.uid(),'insert:market_entry','বাজার এন্ট্রি যোগ করা হয়েছে',jsonb_build_object('market_entry_id',v_entry.id,'total_amount',v_total,'credit_to_buyer',v_entry.credit_to_buyer));
  return jsonb_build_object('market_entry_id',v_entry.id,'id',v_entry.id,'total_amount',v_total,'status','active');
end $$;

create or replace function public.manager_update_market_entry(p_market_entry_id uuid,p_entry_date date,p_buyer_membership_id uuid,p_items jsonb,p_credit_to_buyer boolean,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_entry public.market_entries%rowtype; v_member public.hostel_memberships%rowtype; v_total numeric; v_old_total numeric; v_old jsonb;
begin
  perform private.assert_signed_in();
  select * into v_entry from public.market_entries where id=p_market_entry_id;
  if not found then raise exception using message='বাজার এন্ট্রি পাওয়া যায়নি।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_entry.hostel_id,v_entry.period_id,false,true);
  if v_entry.status='void' then raise exception using message='বাতিল করা বাজার এন্ট্রি সম্পাদনা করা যায় না।',errcode='55000'; end if;
  if v_entry.period_id is distinct from (select id from public.monthly_periods where id=v_entry.period_id and hostel_id=v_entry.hostel_id and status='running')
     and not exists(select 1 from public.archive_edit_permissions a where a.period_id=v_entry.period_id and a.membership_id=private.my_membership_id() and a.revoked_at is null and (a.expires_at is null or a.expires_at>now()))
     and not private.is_super_admin() then raise exception using message='পুরোনো মাসের বাজার সম্পাদনার জন্য আলাদা অনুমতি প্রয়োজন।',errcode='42501'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception using message='বাজার সংশোধনের কারণ লিখুন।',errcode='22023'; end if;
  if p_entry_date is null or p_entry_date<(select start_date from public.monthly_periods where id=v_entry.period_id) or p_entry_date>(select end_date from public.monthly_periods where id=v_entry.period_id) then raise exception using message='বাজারের তারিখ সংশ্লিষ্ট মাসের সীমার বাইরে।',errcode='22023'; end if;
  select * into v_member from public.hostel_memberships where id=p_buyer_membership_id and hostel_id=v_entry.hostel_id and status='active';
  if not found then raise exception using message='বাজারকারীর সক্রিয় সদস্য-তথ্য পাওয়া যায়নি।',errcode='P0002'; end if;
  v_old_total:=v_entry.total_amount;
  select coalesce(jsonb_agg(jsonb_build_object('item_name',item_name,'quantity',quantity,'amount',amount,'serial_no',serial_no) order by serial_no),'[]'::jsonb) into v_old from public.market_entry_items where market_entry_id=v_entry.id;
  v_total:=private.write_market_items(v_entry.id,p_items);
  update public.market_entries set entry_date=p_entry_date,buyer_membership_id=p_buyer_membership_id,buyer_name_snapshot=(select full_name from public.profiles where id=v_member.user_id),total_amount=v_total,credit_to_buyer=coalesce(p_credit_to_buyer,false),updated_by=auth.uid(),updated_at=now() where id=v_entry.id returning * into v_entry;
  perform private.sync_market_credit(v_entry.id);
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_entry.hostel_id,v_entry.period_id,auth.uid(),'update:market_entry','বাজার এন্ট্রি সংশোধন করা হয়েছে',jsonb_build_object('market_entry_id',v_entry.id,'reason',p_reason,'old_items',v_old,'new_items',p_items,'old_total',v_old_total,'new_total',v_total));
  return jsonb_build_object('market_entry_id',v_entry.id,'id',v_entry.id,'total_amount',v_total,'status','updated');
end $$;

create or replace function public.manager_void_market_entry(p_market_entry_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_entry public.market_entries%rowtype;
begin
  perform private.assert_signed_in(); select * into v_entry from public.market_entries where id=p_market_entry_id;
  if not found then raise exception using message='বাজার এন্ট্রি পাওয়া যায়নি।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_entry.hostel_id,v_entry.period_id,false,true);
  if v_entry.status='void' then return jsonb_build_object('status','void','market_entry_id',v_entry.id); end if;
  if nullif(btrim(p_reason),'') is null then raise exception using message='বাজার বাতিলের কারণ লিখুন।',errcode='22023'; end if;
  update public.market_entries set status='void',void_reason=btrim(p_reason),voided_by=auth.uid(),voided_at=now(),updated_by=auth.uid() where id=v_entry.id;
  perform private.sync_market_credit(v_entry.id);
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_entry.hostel_id,v_entry.period_id,auth.uid(),'update:market_void','বাজার এন্ট্রি বাতিল করা হয়েছে',jsonb_build_object('market_entry_id',v_entry.id,'reason',p_reason));
  return jsonb_build_object('status','void','market_entry_id',v_entry.id);
end $$;

create or replace function public.manager_add_deposit(p_member_id uuid,p_amount numeric,p_date date,p_description text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype; v_member public.hostel_memberships%rowtype; v_row public.ledger_transactions%rowtype;
begin
  perform private.assert_signed_in(); perform private.assert_hostel_manager(v_hostel,null,false,false);
  if p_amount is null or p_amount<=0 or p_amount>100000000 then raise exception using message='জমার পরিমাণ শূন্যের বেশি ও যুক্তিসংগত হতে হবে।',errcode='22023'; end if;
  select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' and p_date between start_date and end_date limit 1;
  if not found then raise exception using message='জমার তারিখ চলমান মাসের মধ্যে হতে হবে।',errcode='22023'; end if;
  select * into v_member from public.hostel_memberships where id=p_member_id and hostel_id=v_hostel and status='active';
  if not found then raise exception using message='সদস্যের তথ্য পাওয়া যায়নি।',errcode='P0002'; end if;
  insert into public.ledger_transactions(hostel_id,period_id,member_id,member_name_snapshot,entry_date,ledger_type,ledger_group,amount,description,created_by)
   values(v_hostel,v_period.id,p_member_id,(select full_name from public.profiles where id=v_member.user_id),p_date,'deposit','deposit',round(p_amount,2),nullif(btrim(p_description),''),auth.uid()) returning * into v_row;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_hostel,v_period.id,auth.uid(),'insert:deposit','সদস্যের জমা যোগ করা হয়েছে',jsonb_build_object('transaction_id',v_row.id,'member_id',p_member_id,'amount',p_amount));
  return jsonb_build_object('transaction_id',v_row.id,'id',v_row.id,'amount',v_row.amount,'status','success');
end $$;

create or replace function public.manager_add_other_expense(p_member_id uuid,p_amount numeric,p_date date,p_description text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype; v_member public.hostel_memberships%rowtype; v_row public.ledger_transactions%rowtype;
begin
  perform private.assert_signed_in(); perform private.assert_hostel_manager(v_hostel,null,false,false);
  if p_amount is null or p_amount<=0 or p_amount>100000000 then raise exception using message='খরচের পরিমাণ শূন্যের বেশি ও যুক্তিসংগত হতে হবে।',errcode='22023'; end if;
  if p_description is null or btrim(p_description)='' then raise exception using message='খরচের বিবরণ লিখুন।',errcode='22023'; end if;
  select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' and p_date between start_date and end_date limit 1;
  if not found then raise exception using message='খরচের তারিখ চলমান মাসের মধ্যে হতে হবে।',errcode='22023'; end if;
  select * into v_member from public.hostel_memberships where id=p_member_id and hostel_id=v_hostel and status='active';
  if not found then raise exception using message='সদস্যের তথ্য পাওয়া যায়নি।',errcode='P0002'; end if;
  insert into public.ledger_transactions(hostel_id,period_id,member_id,member_name_snapshot,entry_date,ledger_type,ledger_group,amount,description,created_by)
   values(v_hostel,v_period.id,p_member_id,(select full_name from public.profiles where id=v_member.user_id),p_date,'other_expense','other_expense',-abs(round(p_amount,2)),btrim(p_description),auth.uid()) returning * into v_row;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_hostel,v_period.id,auth.uid(),'insert:other_expense','অন্যান্য খরচ যোগ করা হয়েছে',jsonb_build_object('transaction_id',v_row.id,'member_id',p_member_id,'amount',p_amount));
  return jsonb_build_object('transaction_id',v_row.id,'id',v_row.id,'amount',v_row.amount,'status','success');
end $$;

create or replace function public.manager_adjust_transaction(p_transaction_id uuid,p_new_amount numeric,p_description text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.ledger_transactions%rowtype; v_old numeric;
begin
  perform private.assert_signed_in(); select * into v_row from public.ledger_transactions where id=p_transaction_id;
  if not found then raise exception using message='লেনদেনটি পাওয়া যায়নি।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_row.hostel_id,v_row.period_id,false,true);
  if v_row.status='void' then raise exception using message='বাতিল লেনদেন সংশোধন করা যায় না।',errcode='55000'; end if;
  if p_new_amount is null or abs(p_new_amount)>100000000 then raise exception using message='সংশোধিত টাকার পরিমাণ সঠিক নয়।',errcode='22023'; end if;
  if v_row.ledger_type='deposit' and p_new_amount<=0 then raise exception using message='জমার পরিমাণ শূন্যের বেশি হতে হবে।',errcode='22023'; end if;
  if v_row.ledger_type='other_expense' and p_new_amount>=0 then p_new_amount:=-abs(p_new_amount); end if;
  v_old:=v_row.amount;
  update public.ledger_transactions set amount=round(p_new_amount,2),description=coalesce(nullif(btrim(p_description),''),description),adjustment_reason=p_description,updated_by=auth.uid() where id=v_row.id returning * into v_row;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_row.hostel_id,v_row.period_id,auth.uid(),'update:transaction','লেনদেনের পরিমাণ সংশোধন করা হয়েছে',jsonb_build_object('transaction_id',v_row.id,'old_amount',v_old,'new_amount',v_row.amount,'description',p_description));
  return jsonb_build_object('transaction_id',v_row.id,'id',v_row.id,'amount',v_row.amount,'status','success');
end $$;

create or replace function public.manager_add_khala_money_for_period(p_period_id uuid,p_member_id uuid,p_amount numeric,p_payment_date date,p_description text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_period public.monthly_periods%rowtype; v_member public.hostel_memberships%rowtype; v_row public.khala_money_entries%rowtype;
begin
  perform private.assert_signed_in(); select * into v_period from public.monthly_periods where id=p_period_id;
  if not found then raise exception using message='মাসের তথ্য পাওয়া যায়নি।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_period.hostel_id,v_period.id,false,true);
  if p_amount is null or p_amount<=0 then raise exception using message='খালার টাকার পরিমাণ শূন্যের বেশি হতে হবে।',errcode='22023'; end if;
  if p_payment_date<v_period.start_date or p_payment_date>v_period.end_date then raise exception using message='তারিখটি সংশ্লিষ্ট মাসের মধ্যে হতে হবে।',errcode='22023'; end if;
  select * into v_member from public.hostel_memberships where id=p_member_id and hostel_id=v_period.hostel_id;
  if not found then raise exception using message='সদস্যের তথ্য পাওয়া যায়নি।',errcode='P0002'; end if;
  insert into public.khala_money_entries(hostel_id,period_id,member_id,member_name_snapshot,payment_date,amount,description,created_by)
   values(v_period.hostel_id,v_period.id,p_member_id,(select full_name from public.profiles where id=v_member.user_id),p_payment_date,round(p_amount,2),nullif(btrim(p_description),''),auth.uid()) returning * into v_row;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_period.hostel_id,v_period.id,auth.uid(),'insert:khala_money','খালার টাকা যোগ করা হয়েছে',jsonb_build_object('entry_id',v_row.id,'member_id',p_member_id,'amount',p_amount));
  return jsonb_build_object('entry_id',v_row.id,'id',v_row.id,'amount',v_row.amount,'status','active');
end $$;

create or replace function public.manager_void_khala_money(p_entry_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.khala_money_entries%rowtype;
begin
  perform private.assert_signed_in(); select * into v_row from public.khala_money_entries where id=p_entry_id;
  if not found then raise exception using message='খালার টাকার এন্ট্রি পাওয়া যায়নি।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_row.hostel_id,v_row.period_id,false,true);
  if nullif(btrim(p_reason),'') is null then raise exception using message='বাতিলের কারণ লিখুন।',errcode='22023'; end if;
  update public.khala_money_entries set status='void',void_reason=btrim(p_reason),voided_by=auth.uid(),voided_at=now() where id=v_row.id;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_row.hostel_id,v_row.period_id,auth.uid(),'update:khala_void','খালার টাকার এন্ট্রি বাতিল হয়েছে',jsonb_build_object('entry_id',v_row.id,'reason',p_reason));
  return jsonb_build_object('entry_id',v_row.id,'status','void');
end $$;

-- ---------------------------------------------------------------------------
-- 08. History/read RPCs used by the frontend
-- ---------------------------------------------------------------------------
create or replace function public.get_market_history_v2(p_period_id uuid default null,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period uuid:=p_period_id; v_result jsonb;
begin
  perform private.assert_signed_in();
  if v_hostel is null then return '[]'::jsonb; end if;
  if v_period is null then select id into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1; end if;
  if v_period is not null and not exists(select 1 from public.monthly_periods where id=v_period and hostel_id=v_hostel) then raise exception using message='এই মাসের বাজারের তথ্য দেখার অনুমতি নেই।',errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('market_entry_id',me.id,'id',me.id,'entry_date',me.entry_date,'period_id',me.period_id,
    'buyer_membership_id',me.buyer_membership_id,'member_id',me.buyer_membership_id,'buyer_name',coalesce(p.full_name,me.buyer_name_snapshot,'সদস্য'),
    'member_name',coalesce(p.full_name,me.buyer_name_snapshot,'সদস্য'),'total_amount',me.total_amount,'credit_to_buyer',me.credit_to_buyer,
    'status',me.status,'void_reason',me.void_reason,'created_at',me.created_at,'updated_at',me.updated_at,
    'items',coalesce((select jsonb_agg(jsonb_build_object('serial_no',i.serial_no,'item_name',i.item_name,'name',i.item_name,'quantity',i.quantity,'amount',i.amount) order by i.serial_no) from public.market_entry_items i where i.market_entry_id=me.id),'[]'::jsonb)) order by me.entry_date desc,me.created_at desc),'[]'::jsonb)
  into v_result from (select * from public.market_entries where hostel_id=v_hostel and (v_period is null or period_id=v_period) order by entry_date desc,created_at desc limit greatest(1,least(coalesce(p_limit,100),2000))) me
  left join public.hostel_memberships m on m.id=me.buyer_membership_id left join public.profiles p on p.id=m.user_id;
  return v_result;
end $$;
create or replace function public.get_market_history(p_period_id uuid default null,p_limit integer default 100) returns jsonb language sql stable security definer set search_path = '' as $$ select public.get_market_history_v2(p_period_id,p_limit) $$;

create or replace function public.get_market_detail_v2(p_market_entry_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_entry public.market_entries%rowtype; v_result jsonb;
begin
  perform private.assert_signed_in(); select * into v_entry from public.market_entries where id=p_market_entry_id and hostel_id=v_hostel;
  if not found then raise exception using message='বাজারের বিস্তারিত পাওয়া যায়নি।',errcode='P0002'; end if;
  select jsonb_build_object('market_entry_id',v_entry.id,'id',v_entry.id,'entry_date',v_entry.entry_date,'period_id',v_entry.period_id,
    'buyer_membership_id',v_entry.buyer_membership_id,'buyer_name',coalesce(p.full_name,v_entry.buyer_name_snapshot,'সদস্য'),'member_name',coalesce(p.full_name,v_entry.buyer_name_snapshot,'সদস্য'),
    'total_amount',v_entry.total_amount,'credit_to_buyer',v_entry.credit_to_buyer,'status',v_entry.status,'void_reason',v_entry.void_reason,
    'created_at',v_entry.created_at,'updated_at',v_entry.updated_at,'items',coalesce((select jsonb_agg(jsonb_build_object('serial_no',i.serial_no,'item_name',i.item_name,'name',i.item_name,'quantity',i.quantity,'amount',i.amount) order by i.serial_no) from public.market_entry_items i where i.market_entry_id=v_entry.id),'[]'::jsonb))
    into v_result from (select 1) x left join public.hostel_memberships m on m.id=v_entry.buyer_membership_id left join public.profiles p on p.id=m.user_id;
  return v_result;
end $$;
create or replace function public.get_market_detail(p_market_entry_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$ select public.get_market_detail_v2(p_market_entry_id) $$;

create or replace function public.get_account_history_v2(p_period_id uuid default null,p_member_id uuid default null,p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period uuid:=p_period_id; v_result jsonb;
begin
  perform private.assert_signed_in();
  if v_hostel is null then return '[]'::jsonb; end if;
  if p_member_id is not null and not exists(select 1 from public.hostel_memberships where id=p_member_id and hostel_id=v_hostel) then raise exception using message='এই সদস্যের লেনদেন দেখার অনুমতি নেই।',errcode='42501'; end if;
  if v_period is not null and not exists(select 1 from public.monthly_periods where id=v_period and hostel_id=v_hostel) then raise exception using message='এই মাসের হিসাব দেখার অনুমতি নেই।',errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('transaction_id',l.id,'id',l.id,'member_id',l.member_id,'member_name',coalesce(p.full_name,l.member_name_snapshot,'সদস্য'),
   'transaction_type',l.ledger_type,'ledger_type',l.ledger_type,'ledger_group',l.ledger_group,'amount',l.amount,'entry_date',l.entry_date,'description',l.description,
   'reference_type',l.reference_type,'reference_id',l.reference_id,'status',l.status,'created_at',l.created_at,'updated_at',l.updated_at) order by l.entry_date desc,l.created_at desc),'[]'::jsonb)
   into v_result from (select * from public.ledger_transactions where hostel_id=v_hostel and (v_period is null or period_id=v_period) and (p_member_id is null or member_id=p_member_id) order by entry_date desc,created_at desc limit greatest(1,least(coalesce(p_limit,200),3000))) l
   left join public.hostel_memberships m on m.id=l.member_id left join public.profiles p on p.id=m.user_id;
  return v_result;
end $$;

create or replace function public.get_khala_money_history_v2(p_period_id uuid default null,p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period uuid:=p_period_id; v_result jsonb;
begin
  perform private.assert_signed_in();
  if not private.can_access_hostel(v_hostel) then raise exception using message='এই হিসাব দেখার অনুমতি নেই।',errcode='42501'; end if;
  if v_period is null then select id into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1; end if;
  select coalesce(jsonb_agg(jsonb_build_object('entry_id',k.id,'id',k.id,'member_id',k.member_id,'member_name',coalesce(p.full_name,k.member_name_snapshot,'সদস্য'),
   'amount',k.amount,'entry_date',k.payment_date,'payment_date',k.payment_date,'description',k.description,'status',k.status,'void_reason',k.void_reason,'created_at',k.created_at) order by k.payment_date desc,k.created_at desc),'[]'::jsonb)
  into v_result from (select * from public.khala_money_entries where hostel_id=v_hostel and (v_period is null or period_id=v_period) order by payment_date desc,created_at desc limit greatest(1,least(coalesce(p_limit,200),3000))) k
  left join public.hostel_memberships m on m.id=k.member_id left join public.profiles p on p.id=m.user_id;
  return v_result;
end $$;
create or replace function public.get_khala_money_history(p_period_id uuid default null,p_limit integer default 200) returns jsonb language sql stable security definer set search_path = '' as $$ select public.get_khala_money_history_v2(p_period_id,p_limit) $$;

create or replace function public.get_previous_months()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_result jsonb;
begin
  perform private.assert_signed_in();
  select coalesce(jsonb_agg(jsonb_build_object('id',mp.id,'period_id',mp.id,'hostel_id',mp.hostel_id,'label',mp.label,'start_date',mp.start_date,'end_date',mp.end_date,'status',mp.status,'primary_manager_membership_id',mp.primary_manager_membership_id,
    'total_deposit',(select coalesce(sum(amount),0) from public.ledger_transactions l where l.period_id=mp.id and l.status='active' and l.ledger_type in ('deposit','market_deposit')),
    'total_market_expense',(select coalesce(sum(total_amount),0) from public.market_entries me where me.period_id=mp.id and me.status='active'),
    'total_other_expense',(select coalesce(sum(abs(least(amount,0))),0) from public.ledger_transactions l where l.period_id=mp.id and l.status='active' and l.ledger_type='other_expense') + (select coalesce(sum(amount),0) from public.khala_money_entries k where k.period_id=mp.id and k.status='active'),
    'total_meals',(select coalesce(sum(coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0)+coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0)+coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0)),0) from public.daily_meal_records r join public.daily_meal_days d on d.id=r.daily_meal_day_id where r.period_id=mp.id and d.status='finalized' and not r.cancelled),
    'created_at',mp.created_at) order by mp.start_date desc),'[]'::jsonb) into v_result
  from public.monthly_periods mp where mp.hostel_id=v_hostel and mp.status in ('closed','archived');
  return v_result;
end $$;

create or replace function public.get_archived_month_detail(p_period_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype; v_markets jsonb; v_meals jsonb; v_ledger jsonb; v_deposit numeric; v_market numeric; v_other numeric; v_meals_total numeric; v_rate numeric;
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
  return jsonb_build_object('id',v_period.id,'period_id',v_period.id,'hostel_id',v_hostel,'label',v_period.label,'start_date',v_period.start_date,'end_date',v_period.end_date,'status',v_period.status,
    'markets',v_markets,'meals',v_meals,'ledger',v_ledger,'total_deposit',v_deposit,'total_market_expense',v_market,'total_other_expense',v_other,'total_meals',v_meals_total,'meal_rate',v_rate,'fund_remaining',v_deposit-v_market-v_other);
end $$;

create or replace function public.get_archive_period_audit(p_period_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_result jsonb;
begin
  perform private.assert_signed_in();
  if not exists(select 1 from public.monthly_periods where id=p_period_id and hostel_id=v_hostel) then raise exception using message='এই আর্কাইভের তথ্য দেখার অনুমতি নেই।',errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'summary',a.summary,'details',a.details,'created_at',a.created_at,'actor_user_id',a.actor_user_id,'actor_name',coalesce(p.full_name,'সিস্টেম')) order by a.created_at desc),'[]'::jsonb)
  into v_result from public.archive_period_audit a left join public.profiles p on p.id=a.actor_user_id where a.period_id=p_period_id;
  return v_result;
end $$;

create or replace function public.get_my_archive_editable_periods()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_member uuid:=private.my_membership_id(); v_result jsonb;
begin
  perform private.assert_signed_in();
  select coalesce(jsonb_agg(jsonb_build_object('period_id',mp.id,'id',mp.id,'label',mp.label,'start_date',mp.start_date,'end_date',mp.end_date,'permission_id',a.id,'reason',a.reason,'expires_at',a.expires_at) order by mp.start_date desc),'[]'::jsonb)
  into v_result from public.archive_edit_permissions a join public.monthly_periods mp on mp.id=a.period_id where a.membership_id=v_member and a.revoked_at is null and (a.expires_at is null or a.expires_at>now()) and mp.status in ('closed','archived');
  return v_result;
end $$;

create or replace function public.get_khala_entry_periods_v2()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_result jsonb;
begin
  perform private.assert_signed_in(); if not private.can_manage_hostel(v_hostel,null,false,true) then raise exception using message='খালার টাকার হিসাব দেখার অনুমতি নেই।',errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'period_id',id,'label',label,'start_date',start_date,'end_date',end_date,'status',status) order by start_date desc),'[]'::jsonb) into v_result
  from public.monthly_periods where hostel_id=v_hostel and status in ('running','closed','archived');
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- 09. Month lifecycle, role assignment, membership and archive permissions
-- ---------------------------------------------------------------------------
create or replace function public.get_month_close_preflight()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype; v_future_requests integer:=0; v_future_days integer:=0; v_unfinalized integer:=0;
begin
  perform private.assert_signed_in(); perform private.assert_hostel_manager(v_hostel,null,true,false);
  select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1;
  if not found then return jsonb_build_object('has_running_period',false,'can_close',false,'future_request_count',0,'future_day_count',0,'unfinalized_day_count',0,'requires_confirmation',false); end if;
  select count(*) into v_future_requests from public.meal_requests r where r.period_id=v_period.id and r.status in ('submitted','approved') and exists(select 1 from jsonb_array_elements(r.days) d where (d->>'meal_date')::date>(now() at time zone 'Asia/Dhaka')::date);
  select count(*) into v_future_days from public.daily_meal_days d where d.period_id=v_period.id and d.meal_date>(now() at time zone 'Asia/Dhaka')::date and d.status<>'cancelled';
  select count(*) into v_unfinalized from public.daily_meal_days d where d.period_id=v_period.id and d.status not in ('finalized','cancelled');
  return jsonb_build_object('has_running_period',true,'can_close',true,'period_id',v_period.id,'period_label',v_period.label,
    'future_request_count',v_future_requests,'future_day_count',v_future_days,'unfinalized_day_count',v_unfinalized,
    'requires_confirmation',(v_future_requests>0 or v_future_days>0),'message',case when v_future_requests>0 or v_future_days>0 then 'মাস বন্ধ করলে ভবিষ্যতের মিল-অনুরোধ বাতিল হতে পারে।' else 'মাস বন্ধ করার জন্য প্রস্তুত।' end);
end $$;

create or replace function public.start_new_month(p_start_date date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_member uuid:=private.my_membership_id(); v_last public.monthly_periods%rowtype; v_new public.monthly_periods%rowtype; v_end date;
begin
  perform private.assert_signed_in();
  if v_hostel is null or v_member is null then raise exception using message='মাস শুরু করতে আপনাকে একটি মেসের সক্রিয় সদস্য হতে হবে।',errcode='42501'; end if;
  if exists(select 1 from public.monthly_periods where hostel_id=v_hostel and status='running') then raise exception using message='একটি মাস ইতিমধ্যে চালু আছে। আগে সেটি বন্ধ করুন।',errcode='23505'; end if;
  if not private.is_primary_manager(v_hostel,null) then raise exception using message='নতুন মাস শুধু প্রধান ম্যানেজার শুরু করতে পারবেন।',errcode='42501'; end if;
  if p_start_date is null then raise exception using message='মাস শুরুর তারিখ দিন।',errcode='22023'; end if;
  select * into v_last from public.monthly_periods where hostel_id=v_hostel and status in ('closed','archived') order by end_date desc limit 1;
  if found and p_start_date<>v_last.end_date+1 then raise exception using message=format('নতুন মাসের শুরুর তারিখ আগের মাসের শেষ দিনের পরের দিন (%s) হতে হবে।',v_last.end_date+1),errcode='22023'; end if;
  if not found and p_start_date>(now() at time zone 'Asia/Dhaka')::date+31 then raise exception using message='মাস শুরুর তারিখ ৩১ দিনের বেশি ভবিষ্যতে হতে পারবে না।',errcode='22023'; end if;
  v_end:=(date_trunc('month',p_start_date::timestamp)+interval '1 month - 1 day')::date;
  if found and v_end<p_start_date then v_end:=p_start_date; end if;
  insert into public.monthly_periods(hostel_id,label,start_date,end_date,status,primary_manager_membership_id,created_by)
   values(v_hostel,to_char(p_start_date,'Mon YYYY'),p_start_date,v_end,'running',v_member,auth.uid()) returning * into v_new;
  perform private.ensure_period_days(v_new.id);
  delete from public.period_assistant_managers where hostel_id=v_hostel and period_id<>v_new.id;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_hostel,v_new.id,auth.uid(),'insert:period','নতুন মাস শুরু হয়েছে',jsonb_build_object('period_id',v_new.id,'start_date',v_new.start_date,'end_date',v_new.end_date));
  return jsonb_build_object('period_id',v_new.id,'id',v_new.id,'label',v_new.label,'start_date',v_new.start_date,'end_date',v_new.end_date,'status',v_new.status);
end $$;

create or replace function public.close_current_month(p_confirm_future_cancel boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype; v_future_count integer:=0; v_cancelled integer:=0;
begin
  perform private.assert_signed_in();
  select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1;
  if not found then raise exception using message='বন্ধ করার মতো কোনো চলমান মাস নেই।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_hostel,v_period.id,true,false);
  select count(*) into v_future_count from public.meal_requests r where r.period_id=v_period.id and r.status in ('submitted','approved') and exists(select 1 from jsonb_array_elements(r.days) d where (d->>'meal_date')::date>(now() at time zone 'Asia/Dhaka')::date);
  if v_future_count>0 and not coalesce(p_confirm_future_cancel,false) then raise exception using message=format('মাস বন্ধ করলে %sটি ভবিষ্যতের মিল অনুরোধ প্রভাবিত হবে। নিশ্চিত করতে আবার চেষ্টা করুন।',v_future_count),errcode='55000'; end if;
  if coalesce(p_confirm_future_cancel,false) then
    update public.meal_requests r set status='cancelled',review_reason='মাস বন্ধের সময় ভবিষ্যতের অনুরোধ বাতিল',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
      where r.period_id=v_period.id and r.status in ('submitted','approved') and exists(select 1 from jsonb_array_elements(r.days) d where (d->>'meal_date')::date>(now() at time zone 'Asia/Dhaka')::date);
    get diagnostics v_cancelled = row_count;
    update public.daily_meal_records r set cancelled=true,updated_by=auth.uid(),updated_at=now() from public.daily_meal_days d
      where r.daily_meal_day_id=d.id and d.period_id=v_period.id and d.meal_date>(now() at time zone 'Asia/Dhaka')::date;
    update public.daily_meal_days set status='cancelled' where period_id=v_period.id and meal_date>(now() at time zone 'Asia/Dhaka')::date;
  end if;
  -- Freeze every remaining day and snapshot planned/actual into final values.
  update public.daily_meal_records r set
    final_breakfast=coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0),
    final_lunch=coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0),
    final_dinner=coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0),
    finalized_by=coalesce(r.finalized_by,auth.uid()),finalized_at=coalesce(r.finalized_at,now()),
    finalization_source=coalesce(r.finalization_source,'month_close'),updated_by=auth.uid(),updated_at=now()
   from public.daily_meal_days d where r.daily_meal_day_id=d.id and d.period_id=v_period.id and d.status<>'cancelled' and not r.cancelled;
  update public.daily_meal_days set status='finalized',finalized_at=coalesce(finalized_at,now()),finalized_by=coalesce(finalized_by,auth.uid()),updated_at=now()
   where period_id=v_period.id and status<>'cancelled';
  update public.monthly_periods set status='closed',closed_by=auth.uid(),closed_at=now(),updated_at=now() where id=v_period.id returning * into v_period;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_hostel,v_period.id,auth.uid(),'update:period_closed','মাস বন্ধ করা হয়েছে',jsonb_build_object('cancelled_requests',v_cancelled,'period_id',v_period.id));
  return jsonb_build_object('status','closed','period_id',v_period.id,'label',v_period.label,'cancelled_requests',v_cancelled);
end $$;

create or replace function public.manager_set_running_period_end_date(p_new_end_date date,p_confirm_future_cancel boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype; v_count integer:=0;
begin
  perform private.assert_signed_in(); select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1;
  if not found then raise exception using message='কোনো চলমান মাস পাওয়া যায়নি।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_hostel,v_period.id,true,false);
  if p_new_end_date<v_period.start_date then raise exception using message='মাসের শেষ তারিখ শুরুর তারিখের আগে হতে পারবে না।',errcode='22023'; end if;
  select count(*) into v_count from public.meal_requests r where r.period_id=v_period.id and r.status in ('submitted','approved') and exists(select 1 from jsonb_array_elements(r.days) d where (d->>'meal_date')::date>p_new_end_date);
  if v_count>0 and not coalesce(p_confirm_future_cancel,false) then raise exception using message=format('নতুন শেষ তারিখের পরে %sটি অনুরোধ রয়েছে। নিশ্চিত করে আবার চেষ্টা করুন।',v_count),errcode='55000'; end if;
  if coalesce(p_confirm_future_cancel,false) then
    update public.meal_requests r set status='cancelled',review_reason='মাসের শেষ তারিখ পরিবর্তনের কারণে বাতিল',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    where r.period_id=v_period.id and r.status in ('submitted','approved') and exists(select 1 from jsonb_array_elements(r.days) d where (d->>'meal_date')::date>p_new_end_date);
    update public.daily_meal_records r set cancelled=true,updated_by=auth.uid() from public.daily_meal_days d where r.daily_meal_day_id=d.id and d.period_id=v_period.id and d.meal_date>p_new_end_date;
    update public.daily_meal_days set status='cancelled' where period_id=v_period.id and meal_date>p_new_end_date;
  end if;
  update public.monthly_periods set end_date=p_new_end_date,updated_at=now() where id=v_period.id returning * into v_period;
  perform private.ensure_period_days(v_period.id);
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_hostel,v_period.id,auth.uid(),'update:period_end_date','মাসের শেষ তারিখ পরিবর্তন করা হয়েছে',jsonb_build_object('end_date',p_new_end_date,'cancelled_request_count',v_count));
  return jsonb_build_object('period_id',v_period.id,'end_date',v_period.end_date,'status','updated');
end $$;

create or replace function public.change_manager(p_new_membership_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype; v_new public.hostel_memberships%rowtype; v_old uuid;
begin
  perform private.assert_signed_in(); select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1;
  if not found then raise exception using message='ম্যানেজার পরিবর্তন করতে একটি চলমান মাস থাকতে হবে।',errcode='55000'; end if;
  perform private.assert_hostel_manager(v_hostel,v_period.id,true,false);
  select * into v_new from public.hostel_memberships where id=p_new_membership_id and hostel_id=v_hostel and status='active';
  if not found then raise exception using message='নির্বাচিত নতুন ম্যানেজার সক্রিয় সদস্য নন।',errcode='P0002'; end if;
  v_old:=v_period.primary_manager_membership_id;
  update public.monthly_periods set primary_manager_membership_id=v_new.id where id=v_period.id;
  update public.hostel_memberships set role=case when id=v_new.id then 'manager' else 'member' end where hostel_id=v_hostel and role='manager' and id in (v_old,v_new.id);
  delete from public.period_assistant_managers where period_id=v_period.id and membership_id=v_new.id;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_hostel,v_period.id,auth.uid(),'update:primary_manager','প্রধান ম্যানেজার পরিবর্তন করা হয়েছে',jsonb_build_object('previous_membership_id',v_old,'new_membership_id',v_new.id));
  return jsonb_build_object('status','success','primary_manager_membership_id',v_new.id);
end $$;

create or replace function public.get_period_assistants(p_period_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period uuid:=p_period_id; v_result jsonb;
begin
  perform private.assert_signed_in(); if v_period is null then select id into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1; end if;
  if v_period is null or not exists(select 1 from public.monthly_periods where id=v_period and hostel_id=v_hostel) then return '[]'::jsonb; end if;
  if not private.can_manage_hostel(v_hostel,v_period,false,true) then raise exception using message='সহকারী ম্যানেজারের তালিকা দেখার অনুমতি নেই।',errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('membership_id',m.id,'id',m.id,'user_id',m.user_id,'member_name',p.full_name,'full_name',p.full_name,'role',m.role,'status',m.status) order by p.full_name),'[]'::jsonb) into v_result
   from public.period_assistant_managers a join public.hostel_memberships m on m.id=a.membership_id join public.profiles p on p.id=m.user_id where a.period_id=v_period;
  return v_result;
end $$;

create or replace function public.set_period_assistant_managers(p_membership_ids uuid[],p_period_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period uuid:=p_period_id; v_member uuid;
begin
  perform private.assert_signed_in(); if v_period is null then select id into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1; end if;
  if v_period is null or not exists(select 1 from public.monthly_periods where id=v_period and hostel_id=v_hostel and status='running') then raise exception using message='চলমান মাস পাওয়া যায়নি।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_hostel,v_period,true,false);
  if coalesce(array_length(p_membership_ids,1),0)>10 then raise exception using message='সর্বোচ্চ ১০ জন সহকারী ম্যানেজার রাখা যাবে।',errcode='22023'; end if;
  if exists(select 1 from unnest(coalesce(p_membership_ids,'{}'::uuid[])) x where not exists(select 1 from public.hostel_memberships m where m.id=x and m.hostel_id=v_hostel and m.status='active') or x=(select primary_manager_membership_id from public.monthly_periods where id=v_period)) then
    raise exception using message='সহকারী হিসেবে শুধু একই মেসের সক্রিয় অন্য সদস্য নির্বাচন করুন।',errcode='22023'; end if;
  delete from public.period_assistant_managers where period_id=v_period;
  foreach v_member in array coalesce(p_membership_ids,'{}'::uuid[]) loop insert into public.period_assistant_managers(period_id,hostel_id,membership_id,assigned_by) values(v_period,v_hostel,v_member,auth.uid()) on conflict(period_id,membership_id) do nothing; end loop;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_hostel,v_period,auth.uid(),'update:assistant_managers','সহকারী ম্যানেজারদের তালিকা আপডেট হয়েছে',jsonb_build_object('membership_ids',to_jsonb(coalesce(p_membership_ids,'{}'::uuid[]))));
  return jsonb_build_object('status','success','assistant_count',coalesce(array_length(p_membership_ids,1),0));
end $$;

create or replace function public.deactivate_member(p_membership_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_m public.hostel_memberships%rowtype; v_period public.monthly_periods%rowtype;
begin
  perform private.assert_signed_in(); select * into v_m from public.hostel_memberships where id=p_membership_id and hostel_id=v_hostel;
  if not found then raise exception using message='সদস্যের তথ্য পাওয়া যায়নি।',errcode='P0002'; end if;
  select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1;
  perform private.assert_hostel_manager(v_hostel,v_period.id,false,false);
  if v_m.user_id=auth.uid() then raise exception using message='নিজের সদস্যপদ এভাবে নিষ্ক্রিয় করা যাবে না।',errcode='42501'; end if;
  if v_period.primary_manager_membership_id=v_m.id then raise exception using message='প্রধান ম্যানেজারকে নিষ্ক্রিয় করার আগে ম্যানেজার পরিবর্তন করুন।',errcode='55000'; end if;
  update public.hostel_memberships set status='inactive',deactivated_at=now() where id=v_m.id;
  delete from public.period_assistant_managers where membership_id=v_m.id;
  return jsonb_build_object('membership_id',v_m.id,'status','inactive');
end $$;

create or replace function public.reactivate_member(p_membership_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_m public.hostel_memberships%rowtype;
begin
  perform private.assert_signed_in(); perform private.assert_hostel_manager(v_hostel,null,false,false);
  select * into v_m from public.hostel_memberships where id=p_membership_id and hostel_id=v_hostel;
  if not found then raise exception using message='সদস্যের তথ্য পাওয়া যায়নি।',errcode='P0002'; end if;
  update public.hostel_memberships set status='active',deactivated_at=null where id=v_m.id;
  return jsonb_build_object('membership_id',v_m.id,'status','active');
end $$;

create or replace function public.manager_update_hostel(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_result jsonb;
begin
  perform private.assert_signed_in(); perform private.assert_hostel_manager(v_hostel,null,true,false);
  if p_name is null or length(btrim(p_name))<2 or length(btrim(p_name))>120 then raise exception using message='মেসের নাম ২ থেকে ১২০ অক্ষরের মধ্যে হতে হবে।',errcode='22023'; end if;
  update public.hostels set name=btrim(p_name) where id=v_hostel returning jsonb_build_object('hostel_id',id,'id',id,'name',name,'updated_at',updated_at) into v_result;
  return v_result;
end $$;

create or replace function public.regenerate_join_code()
returns text language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_code text;
begin
  perform private.assert_signed_in(); perform private.assert_hostel_manager(v_hostel,null,true,false);
  v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  while exists(select 1 from public.hostels where join_code=v_code) loop v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)); end loop;
  update public.hostels set join_code=v_code where id=v_hostel;
  return v_code;
end $$;

create or replace function public.get_archive_management_items()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_result jsonb;
begin
  perform private.assert_signed_in(); perform private.assert_hostel_manager(v_hostel,null,true,false);
  select coalesce(jsonb_agg(jsonb_build_object('period_id',mp.id,'id',mp.id,'label',mp.label,'start_date',mp.start_date,'end_date',mp.end_date,'status',mp.status,
   'primary_manager_membership_id',mp.primary_manager_membership_id,'permission_count',(select count(*) from public.archive_edit_permissions a where a.period_id=mp.id and a.revoked_at is null and (a.expires_at is null or a.expires_at>now()))) order by mp.start_date desc),'[]'::jsonb)
   into v_result from public.monthly_periods mp where mp.hostel_id=v_hostel and mp.status in ('closed','archived');
  return v_result;
end $$;

create or replace function public.reopen_archived_period(p_period_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype;
begin
  perform private.assert_signed_in(); perform private.assert_hostel_manager(v_hostel,null,true,false);
  if exists(select 1 from public.monthly_periods where hostel_id=v_hostel and status='running') then raise exception using message='আর্কাইভ খোলার আগে বর্তমান চলমান মাস বন্ধ করুন।',errcode='55000'; end if;
  select * into v_period from public.monthly_periods where id=p_period_id and hostel_id=v_hostel and status in ('closed','archived');
  if not found then raise exception using message='নির্বাচিত আর্কাইভ পাওয়া যায়নি।',errcode='P0002'; end if;
  update public.monthly_periods set status='running',closed_at=null,closed_by=null where id=v_period.id returning * into v_period;
  update public.daily_meal_days set status=case when meal_date<(now() at time zone 'Asia/Dhaka')::date then 'finalized' else 'open' end,updated_at=now() where period_id=v_period.id and status<>'cancelled';
  perform private.ensure_period_days(v_period.id);
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_hostel,v_period.id,auth.uid(),'update:archive_reopened','পুরোনো মাস পুনরায় খোলা হয়েছে',jsonb_build_object('period_id',v_period.id));
  return jsonb_build_object('period_id',v_period.id,'id',v_period.id,'label',v_period.label,'status','running');
end $$;

create or replace function public.grant_archive_edit_permission(p_period_id uuid,p_membership_id uuid,p_expires_at timestamptz default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype; v_perm public.archive_edit_permissions%rowtype;
begin
  perform private.assert_signed_in(); select * into v_period from public.monthly_periods where id=p_period_id and hostel_id=v_hostel and status in ('closed','archived');
  if not found then raise exception using message='শুধু বন্ধ বা আর্কাইভ করা মাসের জন্য অনুমতি দেওয়া যায়।',errcode='22023'; end if;
  perform private.assert_hostel_manager(v_hostel,null,true,false);
  if not exists(select 1 from public.hostel_memberships where id=p_membership_id and hostel_id=v_hostel and status='active') then raise exception using message='সক্রিয় সদস্য নির্বাচন করুন।',errcode='P0002'; end if;
  if p_expires_at is not null and p_expires_at<=now() then raise exception using message='অনুমতির মেয়াদ ভবিষ্যতের হতে হবে।',errcode='22023'; end if;
  update public.archive_edit_permissions set revoked_at=now() where period_id=p_period_id and membership_id=p_membership_id and revoked_at is null;
  insert into public.archive_edit_permissions(hostel_id,period_id,membership_id,granted_by,reason,expires_at) values(v_hostel,p_period_id,p_membership_id,auth.uid(),nullif(btrim(p_reason),''),p_expires_at) returning * into v_perm;
  return jsonb_build_object('id',v_perm.id,'period_id',v_perm.period_id,'membership_id',v_perm.membership_id,'granted_by',v_perm.granted_by,'reason',v_perm.reason,'expires_at',v_perm.expires_at,'revoked_at',v_perm.revoked_at,'created_at',v_perm.created_at);
end $$;

create or replace function public.revoke_archive_edit_permission(p_permission_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_row public.archive_edit_permissions%rowtype;
begin
  perform private.assert_signed_in(); select * into v_row from public.archive_edit_permissions where id=p_permission_id and hostel_id=v_hostel;
  if not found then raise exception using message='আর্কাইভ অনুমতিটি পাওয়া যায়নি।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_hostel,null,true,false);
  update public.archive_edit_permissions set revoked_at=now() where id=v_row.id;
  return jsonb_build_object('id',v_row.id,'revoked_at',now(),'status','revoked');
end $$;

-- ---------------------------------------------------------------------------
-- 10. Notifications, ranking and public platform settings
-- ---------------------------------------------------------------------------
create or replace function public.get_notifications(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_result jsonb;
begin
  perform private.assert_signed_in();
  select coalesce(jsonb_agg(jsonb_build_object('notification_id',n.id,'id',n.id,'title',n.title,'body',n.body,'created_at',n.created_at,'seen_at',n.seen_at,'is_seen',n.seen_at is not null,'created_by',n.created_by) order by n.created_at desc),'[]'::jsonb)
  into v_result from (select * from public.notifications where hostel_id=v_hostel and recipient_user_id=auth.uid() and deleted_at is null order by created_at desc limit greatest(1,least(coalesce(p_limit,50),200))) n;
  return v_result;
end $$;

create or replace function public.mark_notification_seen(p_notification_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_signed_in();
  update public.notifications set seen_at=coalesce(seen_at,now()) where id=p_notification_id and recipient_user_id=auth.uid() and deleted_at is null;
  if not found then raise exception using message='নোটিফিকেশনটি পাওয়া যায়নি বা এটি আপনার জন্য নয়।',errcode='P0002'; end if;
  return jsonb_build_object('status','success','notification_id',p_notification_id);
end $$;

create or replace function public.delete_my_notification(p_notification_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_signed_in(); update public.notifications set deleted_at=now() where id=p_notification_id and recipient_user_id=auth.uid() and deleted_at is null;
  if not found then raise exception using message='নোটিফিকেশনটি পাওয়া যায়নি বা আগেই মুছে ফেলা হয়েছে।',errcode='P0002'; end if;
  return jsonb_build_object('status','success','notification_id',p_notification_id);
end $$;

create or replace function public.manager_send_notification(p_title text,p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_count integer:=0; v_title text:=btrim(coalesce(p_title,'')); v_body text:=btrim(coalesce(p_body,''));
begin
  perform private.assert_signed_in(); perform private.assert_hostel_manager(v_hostel,null,false,false);
  if v_title='' or length(v_title)>160 then raise exception using message='নোটিফিকেশনের শিরোনাম ১ থেকে ১৬০ অক্ষরের হতে হবে।',errcode='22023'; end if;
  if v_body='' or length(v_body)>3000 then raise exception using message='নোটিফিকেশনের বিবরণ ১ থেকে ৩০০০ অক্ষরের হতে হবে।',errcode='22023'; end if;
  insert into public.notifications(hostel_id,recipient_user_id,title,body,created_by)
  select v_hostel,m.user_id,v_title,v_body,auth.uid() from public.hostel_memberships m join public.profiles p on p.id=m.user_id where m.hostel_id=v_hostel and m.status='active' and not p.is_blocked;
  get diagnostics v_count=row_count;
  return jsonb_build_object('status','success','sent_count',v_count);
end $$;

create or replace function public.manager_delete_notification(p_notification_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id();
begin
  perform private.assert_signed_in(); perform private.assert_hostel_manager(v_hostel,null,false,false);
  update public.notifications set deleted_at=now() where id=p_notification_id and hostel_id=v_hostel and deleted_at is null;
  if not found then raise exception using message='নোটিফিকেশনটি পাওয়া যায়নি।',errcode='P0002'; end if;
  return jsonb_build_object('status','success','notification_id',p_notification_id);
end $$;

create or replace function public.get_top_eaters()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period uuid; v_result jsonb;
begin
  perform private.assert_signed_in();
  select id into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1;
  if v_period is null then return '[]'::jsonb; end if;
  perform private.finalize_due_days(v_hostel,v_period);
  with totals as (
    select m.id,
      coalesce(sum(case when d.status='finalized' then
        coalesce(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0)+
        coalesce(r.final_lunch,r.actual_lunch,r.planned_lunch,0)+
        coalesce(r.final_dinner,r.actual_dinner,r.planned_dinner,0)
        else 0 end),0) as meals
    from public.hostel_memberships m
    left join public.daily_meal_records r on r.member_id=m.id and r.period_id=v_period and not r.cancelled
    left join public.daily_meal_days d on d.id=r.daily_meal_day_id
    where m.hostel_id=v_hostel and m.status='active'
    group by m.id
  ), ranked as (
    select t.id,t.meals,row_number() over(order by t.meals desc,p.full_name) as rn,p.full_name
    from totals t join public.hostel_memberships m on m.id=t.id join public.profiles p on p.id=m.user_id
    where t.meals>0 and not p.is_blocked
  )
  select coalesce(jsonb_agg(jsonb_build_object('membership_id',r.id,'member_id',r.id,'member_name',r.full_name,'full_name',r.full_name,
    'meals',r.meals,'total_meals',r.meals,'rank',r.rn) order by r.meals desc,r.full_name),'[]'::jsonb)
    into v_result from ranked r where r.rn<=10;
  return v_result;
end $$;

create or replace function public.get_top_shoppers()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period uuid; v_result jsonb;
begin
  perform private.assert_signed_in(); select id into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1;
  if v_period is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('membership_id',m.id,'member_id',m.id,'member_name',p.full_name,'full_name',p.full_name,'total_market',s.total_market,'amount',s.total_market,'rank',s.rn) order by s.total_market desc,p.full_name),'[]'::jsonb)
   into v_result from (select me.buyer_membership_id id,sum(me.total_amount) total_market,row_number() over(order by sum(me.total_amount) desc) rn
    from public.market_entries me where me.period_id=v_period and me.status='active' and me.buyer_membership_id is not null group by me.buyer_membership_id) s
    join public.hostel_memberships m on m.id=s.id join public.profiles p on p.id=m.user_id where not p.is_blocked order by s.total_market desc,p.full_name limit 10;
  return v_result;
end $$;

create or replace function public.get_platform_public_settings()
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce((select jsonb_build_object('announcement_enabled',s.announcement_enabled,'announcement_title',s.announcement_title,'announcement_body',s.announcement_body,
   'registration_code_required',s.registration_code_required,'hostel_creation_code_required',s.hostel_creation_code_required,'developer_name',s.developer_name,'developer_title',s.developer_title,
   'developer_photo_url',s.developer_photo_url,'developer_email',s.developer_email,'developer_phone',s.developer_phone,'developer_portfolio_url',s.developer_portfolio_url,'updated_at',s.updated_at)
  from public.platform_settings s where s.singleton=true),'{}'::jsonb)
$$;

-- ---------------------------------------------------------------------------
-- 11. Super Admin platform-control RPCs
-- ---------------------------------------------------------------------------
create or replace function public.platform_admin_get_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.assert_signed_in(); if not private.is_super_admin() then raise exception using message='শুধু Super Admin এই তথ্য দেখতে পারবেন।',errcode='42501'; end if;
  select jsonb_build_object('hostel_count',(select count(*) from public.hostels),'active_hostel_count',(select count(*) from public.hostels where platform_status='active'),
   'suspended_hostel_count',(select count(*) from public.hostels where platform_status='suspended'),'member_count',(select count(*) from public.hostel_memberships where status='active'),
   'inactive_member_count',(select count(*) from public.hostel_memberships where status='inactive'),'blocked_user_count',(select count(*) from public.profiles where is_blocked),
   'super_admin_count',(select count(*) from public.profiles where role='super_admin'),'recent_hostels',(select count(*) from public.hostels where created_at>now()-interval '30 days'),
   'announcement_enabled',(select announcement_enabled from public.platform_settings where singleton=true)) into v;
  return v;
end $$;

create or replace function public.platform_admin_list_hostels_v3()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform private.assert_signed_in(); if not private.is_super_admin() then raise exception using message='শুধু Super Admin মেসের তালিকা দেখতে পারবেন।',errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('hostel_id',h.id,'id',h.id,'name',h.name,'join_code',h.join_code,'platform_status',h.platform_status,'status',h.platform_status,
    'is_favorite',coalesce((h.flags->>'favorite')::boolean,false),'is_trusted',coalesce((h.flags->>'trusted')::boolean,false),'flags',h.flags,
    'created_by',h.created_by,'created_at',h.created_at,'updated_at',h.updated_at,'member_count',(select count(*) from public.hostel_memberships m where m.hostel_id=h.id and m.status='active'),
    'running_period',(select jsonb_build_object('period_id',mp.id,'label',mp.label,'start_date',mp.start_date,'end_date',mp.end_date) from public.monthly_periods mp where mp.hostel_id=h.id and mp.status='running' limit 1)) order by h.created_at desc),'[]'::jsonb)
   into v_result from public.hostels h;
  return v_result;
end $$;

create or replace function public.platform_admin_list_hostel_members_v3(p_hostel_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform private.assert_signed_in(); if not private.is_super_admin() then raise exception using message='শুধু Super Admin সদস্যদের তালিকা দেখতে পারবেন।',errcode='42501'; end if;
  if not exists(select 1 from public.hostels where id=p_hostel_id) then raise exception using message='মেসটি পাওয়া যায়নি।',errcode='P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('membership_id',m.id,'id',m.id,'user_id',m.user_id,'hostel_id',m.hostel_id,'full_name',p.full_name,'member_name',p.full_name,'phone',p.phone,
    'email',(select u.email from auth.users u where u.id=m.user_id),'role',m.role,'status',m.status,'member_status',m.status,'is_blocked',p.is_blocked,
    'is_favorite',coalesce((p.flags->>'favorite')::boolean,false),'is_trusted',coalesce((p.flags->>'trusted')::boolean,false),'flags',p.flags,'joined_at',m.joined_at) order by p.full_name),'[]'::jsonb)
   into v_result from public.hostel_memberships m join public.profiles p on p.id=m.user_id where m.hostel_id=p_hostel_id;
  return v_result;
end $$;

create or replace function public.platform_admin_set_hostel_status(p_hostel_id uuid,p_status text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel public.hostels%rowtype;
begin
  perform private.assert_signed_in(); if not private.is_super_admin() then raise exception using message='শুধু Super Admin মেসের স্ট্যাটাস পরিবর্তন করতে পারবেন।',errcode='42501'; end if;
  if p_status not in ('active','suspended') then raise exception using message='মেসের স্ট্যাটাস সঠিক নয়।',errcode='22023'; end if;
  update public.hostels set platform_status=p_status,platform_status_reason=nullif(btrim(p_reason),''),updated_at=now() where id=p_hostel_id returning * into v_hostel;
  if not found then raise exception using message='মেসটি পাওয়া যায়নি।',errcode='P0002'; end if;
  insert into public.platform_audit_log(actor_user_id,action,target_type,target_id,reason) values(auth.uid(),'hostel_status_changed','hostel',p_hostel_id::text,p_reason);
  return jsonb_build_object('hostel_id',v_hostel.id,'platform_status',v_hostel.platform_status,'status',v_hostel.platform_status);
end $$;

create or replace function public.platform_admin_set_user_blocked(p_user_id uuid,p_blocked boolean,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles%rowtype;
begin
  perform private.assert_signed_in(); if not private.is_super_admin() then raise exception using message='শুধু Super Admin ব্যবহারকারী ব্লক করতে পারবেন।',errcode='42501'; end if;
  if p_user_id=auth.uid() and coalesce(p_blocked,false) then raise exception using message='নিজের Super Admin অ্যাকাউন্ট ব্লক করা যাবে না।',errcode='42501'; end if;
  update public.profiles set is_blocked=coalesce(p_blocked,false) where id=p_user_id returning * into v_profile;
  if not found then raise exception using message='ব্যবহারকারী পাওয়া যায়নি।',errcode='P0002'; end if;
  insert into public.platform_audit_log(actor_user_id,action,target_type,target_id,reason) values(auth.uid(),case when p_blocked then 'user_blocked' else 'user_unblocked' end,'user',p_user_id::text,p_reason);
  return jsonb_build_object('user_id',p_user_id,'is_blocked',v_profile.is_blocked,'status',case when v_profile.is_blocked then 'inactive' else 'active' end);
end $$;

create or replace function public.platform_admin_update_public_settings(p_announcement_enabled boolean,p_announcement_title text,p_announcement_body text,p_developer_name text,p_developer_title text,p_developer_photo_url text,p_developer_email text,p_developer_phone text,p_developer_portfolio_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_settings public.platform_settings%rowtype;
begin
  perform private.assert_signed_in(); if not private.is_super_admin() then raise exception using message='শুধু Super Admin প্ল্যাটফর্ম সেটিংস পরিবর্তন করতে পারবেন।',errcode='42501'; end if;
  if length(coalesce(p_announcement_title,''))>160 or length(coalesce(p_announcement_body,''))>3000 then raise exception using message='নোটিশের শিরোনাম বা বিবরণ অনুমোদিত সীমা ছাড়িয়েছে।',errcode='22023'; end if;
  update public.platform_settings set announcement_enabled=coalesce(p_announcement_enabled,false),announcement_title=left(coalesce(p_announcement_title,''),160),announcement_body=left(coalesce(p_announcement_body,''),3000),
   developer_name=left(coalesce(p_developer_name,''),160),developer_title=left(coalesce(p_developer_title,''),200),developer_photo_url=left(coalesce(p_developer_photo_url,''),1000),developer_email=left(coalesce(p_developer_email,''),240),developer_phone=left(coalesce(p_developer_phone,''),80),developer_portfolio_url=left(coalesce(p_developer_portfolio_url,''),1000),updated_by=auth.uid(),updated_at=now()
   where singleton=true returning * into v_settings;
  insert into public.platform_audit_log(actor_user_id,action,target_type,target_id) values(auth.uid(),'public_settings_updated','platform_settings','singleton');
  return public.get_platform_public_settings();
end $$;

create or replace function public.platform_admin_set_gate(p_purpose text,p_required boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  perform private.assert_signed_in(); if not private.is_super_admin() then raise exception using message='শুধু Super Admin কোড-গেট পরিবর্তন করতে পারবেন।',errcode='42501'; end if;
  if p_purpose='registration' then v_key:='registration_code_required'; elsif p_purpose='hostel_creation' then v_key:='hostel_creation_code_required'; else raise exception using message='কোড-গেটের ধরন সঠিক নয়।',errcode='22023'; end if;
  if p_purpose='registration' then update public.platform_settings set registration_code_required=coalesce(p_required,false),updated_by=auth.uid() where singleton=true;
  else update public.platform_settings set hostel_creation_code_required=coalesce(p_required,false),updated_by=auth.uid() where singleton=true; end if;
  insert into public.platform_audit_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'platform_gate_changed','platform_settings',p_purpose,jsonb_build_object('required',p_required));
  return jsonb_build_object('purpose',p_purpose,'required',coalesce(p_required,false),'setting',v_key);
end $$;

create or replace function public.platform_admin_generate_access_code(p_purpose text,p_ttl_minutes integer default 1440,p_max_uses integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text; v_expires timestamptz; v_id uuid;
begin
  perform private.assert_signed_in(); if not private.is_super_admin() then raise exception using message='শুধু Super Admin অ্যাক্সেস কোড তৈরি করতে পারবেন।',errcode='42501'; end if;
  if p_purpose not in ('registration','hostel_creation') then raise exception using message='কোডের ধরন সঠিক নয়।',errcode='22023'; end if;
  if p_ttl_minutes is null or p_ttl_minutes<5 or p_ttl_minutes>10080 then raise exception using message='কোডের মেয়াদ ৫ থেকে ১০০৮০ মিনিটের মধ্যে হতে হবে।',errcode='22023'; end if;
  if p_max_uses is null or p_max_uses<1 or p_max_uses>1000 then raise exception using message='ব্যবহারের সীমা ১ থেকে ১০০০-এর মধ্যে হতে হবে।',errcode='22023'; end if;
  update public.platform_access_codes set revoked_at=now() where purpose=p_purpose and revoked_at is null;
  v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)); v_expires:=now()+make_interval(mins=>p_ttl_minutes);
  insert into public.platform_access_codes(purpose,code_hash,max_uses,expires_at,created_by) values(p_purpose,encode(extensions.digest(v_code,'sha256'),'hex'),p_max_uses,v_expires,auth.uid()) returning id into v_id;
  insert into public.platform_audit_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'access_code_generated','access_code',v_id::text,jsonb_build_object('purpose',p_purpose,'max_uses',p_max_uses,'expires_at',v_expires));
  return jsonb_build_object('id',v_id,'purpose',p_purpose,'code',v_code,'expires_at',v_expires,'max_uses',p_max_uses);
end $$;

create or replace function public.platform_admin_set_hostel_flag(p_hostel_id uuid,p_flag text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel public.hostels%rowtype;
begin
  perform private.assert_signed_in(); if not private.is_super_admin() then raise exception using message='শুধু Super Admin মেসের লেবেল পরিবর্তন করতে পারবেন।',errcode='42501'; end if;
  if p_flag not in ('favorite','trusted') then raise exception using message='অনুমোদিত flag নির্বাচন করুন।',errcode='22023'; end if;
  update public.hostels set flags=jsonb_set(coalesce(flags,'{}'::jsonb),array[p_flag],to_jsonb(coalesce(p_enabled,false)),true) where id=p_hostel_id returning * into v_hostel;
  if not found then raise exception using message='মেসটি পাওয়া যায়নি।',errcode='P0002'; end if;
  return jsonb_build_object('hostel_id',v_hostel.id,'flag',p_flag,'enabled',p_enabled,'flags',v_hostel.flags);
end $$;

create or replace function public.platform_admin_set_user_flag(p_user_id uuid,p_flag text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles%rowtype;
begin
  perform private.assert_signed_in(); if not private.is_super_admin() then raise exception using message='শুধু Super Admin ব্যবহারকারীর লেবেল পরিবর্তন করতে পারবেন।',errcode='42501'; end if;
  if p_flag not in ('favorite','trusted') then raise exception using message='অনুমোদিত flag নির্বাচন করুন।',errcode='22023'; end if;
  update public.profiles set flags=jsonb_set(coalesce(flags,'{}'::jsonb),array[p_flag],to_jsonb(coalesce(p_enabled,false)),true) where id=p_user_id returning * into v_profile;
  if not found then raise exception using message='ব্যবহারকারী পাওয়া যায়নি।',errcode='P0002'; end if;
  return jsonb_build_object('user_id',v_profile.id,'flag',p_flag,'enabled',p_enabled,'flags',v_profile.flags);
end $$;

create or replace function public.platform_admin_permanently_delete_hostel(p_hostel_id uuid,p_delete_member_accounts boolean,p_confirmation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_count integer:=0; v_name text;
begin
  perform private.assert_signed_in(); if not private.is_super_admin() then raise exception using message='শুধু Super Admin মেস স্থায়ীভাবে মুছতে পারবেন।',errcode='42501'; end if;
  if p_confirmation is distinct from ('DELETE HOSTEL '||p_hostel_id::text) then raise exception using message='স্থায়ীভাবে মুছে ফেলার নিশ্চিতকরণ মেলেনি। কোনো পরিবর্তন করা হয়নি।',errcode='22023'; end if;
  select name into v_name from public.hostels where id=p_hostel_id;
  if not found then raise exception using message='মেসটি পাওয়া যায়নি।',errcode='P0002'; end if;
  select coalesce(array_agg(distinct user_id),'{}'::uuid[]) into v_ids from public.hostel_memberships where hostel_id=p_hostel_id;
  -- Delete dependent hostel data atomically. Keep auth accounts unless explicitly requested.
  delete from public.hostels where id=p_hostel_id;
  if coalesce(p_delete_member_accounts,false) then
    delete from auth.users u where u.id=any(v_ids) and u.id<>auth.uid(); get diagnostics v_count=row_count;
  end if;
  insert into public.platform_audit_log(actor_user_id,action,target_type,target_id,reason,details) values(auth.uid(),'hostel_permanently_deleted','hostel',p_hostel_id::text,'Super Delete',jsonb_build_object('name',v_name,'member_accounts_deleted',v_count));
  return jsonb_build_object('status','deleted','hostel_id',p_hostel_id,'hostel_name',v_name,'member_accounts_deleted',v_count);
end $$;

create or replace function public.platform_admin_permanently_delete_member(p_hostel_id uuid,p_membership_id uuid,p_delete_auth_account boolean,p_confirmation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.hostel_memberships%rowtype; v_user uuid; v_name text;
begin
  perform private.assert_signed_in(); if not private.is_super_admin() then raise exception using message='শুধু Super Admin সদস্য স্থায়ীভাবে মুছতে পারবেন।',errcode='42501'; end if;
  select * into v_member from public.hostel_memberships where id=p_membership_id and hostel_id=p_hostel_id;
  if not found then raise exception using message='সদস্যটি এই মেসে পাওয়া যায়নি।',errcode='P0002'; end if;
  v_user:=v_member.user_id; select full_name into v_name from public.profiles where id=v_user;
  if p_confirmation is distinct from ('DELETE MEMBER '||v_user::text) then raise exception using message='স্থায়ীভাবে মুছে ফেলার নিশ্চিতকরণ মেলেনি। কোনো পরিবর্তন করা হয়নি।',errcode='22023'; end if;
  if v_user=auth.uid() then raise exception using message='নিজের Super Admin অ্যাকাউন্ট এভাবে মুছতে পারবেন না।',errcode='42501'; end if;
  -- Explicitly remove member-related activity; retain unrelated members and the hostel.
  delete from public.daily_meal_records where member_id=v_member.id;
  delete from public.meal_requests where membership_id=v_member.id;
  delete from public.ledger_transactions where member_id=v_member.id;
  delete from public.khala_money_entries where member_id=v_member.id;
  delete from public.market_entries where buyer_membership_id=v_member.id;
  delete from public.period_assistant_managers where membership_id=v_member.id;
  delete from public.archive_edit_permissions where membership_id=v_member.id;
  delete from public.hostel_memberships where id=v_member.id;
  if coalesce(p_delete_auth_account,false) then delete from auth.users where id=v_user; end if;
  insert into public.platform_audit_log(actor_user_id,action,target_type,target_id,reason,details) values(auth.uid(),'member_permanently_deleted','member',v_member.id::text,'Super Delete',jsonb_build_object('user_id',v_user,'hostel_id',p_hostel_id,'name',v_name,'auth_account_deleted',coalesce(p_delete_auth_account,false)));
  return jsonb_build_object('status','deleted','membership_id',v_member.id,'user_id',v_user,'auth_account_deleted',coalesce(p_delete_auth_account,false));
end $$;

-- ---------------------------------------------------------------------------
-- 12. Realtime compatibility beacons used by the existing frontend
-- ---------------------------------------------------------------------------
-- The frontend subscribes to these legacy-compatible table names to trigger
-- cache refreshes. They carry no business/financial data; they only signal a
-- change. The canonical records remain in daily_meal_days, daily_meal_records
-- and meal_requests.
create table if not exists public.daily_meal_snapshots (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  period_id uuid not null references public.monthly_periods(id) on delete cascade,
  touched_at timestamptz not null default now(),
  unique(hostel_id,period_id)
);
create table if not exists public.meal_late_overrides (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  period_id uuid not null references public.monthly_periods(id) on delete cascade,
  touched_at timestamptz not null default now(),
  unique(hostel_id,period_id)
);

create or replace function private.bump_realtime_beacon()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid; v_period uuid; v_target text;
begin
  if tg_op='DELETE' then v_hostel:=old.hostel_id; v_period:=old.period_id;
  else v_hostel:=new.hostel_id; v_period:=new.period_id; end if;
  if v_hostel is null or v_period is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_table_name='meal_requests' then v_target:='public.meal_late_overrides';
  else v_target:='public.daily_meal_snapshots'; end if;
  if v_target='public.meal_late_overrides' then
    insert into public.meal_late_overrides(hostel_id,period_id,touched_at) values(v_hostel,v_period,clock_timestamp())
      on conflict(hostel_id,period_id) do update set touched_at=excluded.touched_at;
  else
    insert into public.daily_meal_snapshots(hostel_id,period_id,touched_at) values(v_hostel,v_period,clock_timestamp())
      on conflict(hostel_id,period_id) do update set touched_at=excluded.touched_at;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

drop trigger if exists daily_meal_days_realtime_beacon on public.daily_meal_days;
create trigger daily_meal_days_realtime_beacon after insert or update or delete on public.daily_meal_days
for each row execute function private.bump_realtime_beacon();
drop trigger if exists daily_meal_records_realtime_beacon on public.daily_meal_records;
create trigger daily_meal_records_realtime_beacon after insert or update or delete on public.daily_meal_records
for each row execute function private.bump_realtime_beacon();
drop trigger if exists meal_requests_realtime_beacon on public.meal_requests;
create trigger meal_requests_realtime_beacon after insert or update or delete on public.meal_requests
for each row execute function private.bump_realtime_beacon();

-- ---------------------------------------------------------------------------
-- 13. Row-Level Security, grants and Storage policies
-- ---------------------------------------------------------------------------
-- All browser-facing tables are read-only from the Data API. Mutations are made
-- through guarded RPCs so validations and audit trails cannot be bypassed.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','hostels','hostel_memberships','monthly_periods','period_assistant_managers',
    'daily_meal_days','daily_meal_records','meal_requests','market_entries','market_entry_items',
    'ledger_transactions','khala_money_entries','archive_edit_permissions','archive_period_audit',
    'notifications','platform_settings','platform_access_codes','platform_audit_log',
    'daily_meal_snapshots','meal_late_overrides'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.profiles, public.hostels, public.hostel_memberships, public.monthly_periods,
  public.period_assistant_managers, public.daily_meal_days, public.daily_meal_records,
  public.meal_requests, public.market_entries, public.market_entry_items,
  public.ledger_transactions, public.khala_money_entries, public.archive_edit_permissions,
  public.notifications, public.daily_meal_snapshots, public.meal_late_overrides
TO authenticated;

-- Policies are recreated on each run to keep this installer idempotent.
DROP POLICY IF EXISTS profiles_select_self_or_super_admin ON public.profiles;
CREATE POLICY profiles_select_self_or_super_admin ON public.profiles FOR SELECT TO authenticated
  USING (id=auth.uid() OR private.is_super_admin());

DROP POLICY IF EXISTS hostels_select_member_or_super_admin ON public.hostels;
CREATE POLICY hostels_select_member_or_super_admin ON public.hostels FOR SELECT TO authenticated
  USING (private.can_access_hostel(id));

DROP POLICY IF EXISTS memberships_select_own_or_same_hostel ON public.hostel_memberships;
CREATE POLICY memberships_select_own_or_same_hostel ON public.hostel_memberships FOR SELECT TO authenticated
  USING (user_id=auth.uid() OR private.can_access_hostel(hostel_id));

DROP POLICY IF EXISTS monthly_periods_select_same_hostel ON public.monthly_periods;
CREATE POLICY monthly_periods_select_same_hostel ON public.monthly_periods FOR SELECT TO authenticated
  USING (private.can_access_hostel(hostel_id));

DROP POLICY IF EXISTS assistants_select_same_hostel ON public.period_assistant_managers;
CREATE POLICY assistants_select_same_hostel ON public.period_assistant_managers FOR SELECT TO authenticated
  USING (private.can_access_hostel(hostel_id));

DROP POLICY IF EXISTS meal_days_select_same_hostel ON public.daily_meal_days;
CREATE POLICY meal_days_select_same_hostel ON public.daily_meal_days FOR SELECT TO authenticated
  USING (private.can_access_hostel(hostel_id));

DROP POLICY IF EXISTS meal_records_select_same_hostel ON public.daily_meal_records;
CREATE POLICY meal_records_select_same_hostel ON public.daily_meal_records FOR SELECT TO authenticated
  USING (private.can_access_hostel(hostel_id));

DROP POLICY IF EXISTS meal_requests_select_owner_or_manager ON public.meal_requests;
CREATE POLICY meal_requests_select_owner_or_manager ON public.meal_requests FOR SELECT TO authenticated
  USING (
    (membership_id=private.my_membership_id() AND private.can_access_hostel(hostel_id))
    OR private.can_manage_hostel(hostel_id,period_id,false,true)
  );

DROP POLICY IF EXISTS market_entries_select_same_hostel ON public.market_entries;
CREATE POLICY market_entries_select_same_hostel ON public.market_entries FOR SELECT TO authenticated
  USING (private.can_access_hostel(hostel_id));

DROP POLICY IF EXISTS market_items_select_same_hostel ON public.market_entry_items;
CREATE POLICY market_items_select_same_hostel ON public.market_entry_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.market_entries me WHERE me.id=market_entry_id AND private.can_access_hostel(me.hostel_id)));

DROP POLICY IF EXISTS ledger_select_same_hostel ON public.ledger_transactions;
CREATE POLICY ledger_select_same_hostel ON public.ledger_transactions FOR SELECT TO authenticated
  USING (private.can_access_hostel(hostel_id));

DROP POLICY IF EXISTS khala_entries_select_same_hostel ON public.khala_money_entries;
CREATE POLICY khala_entries_select_same_hostel ON public.khala_money_entries FOR SELECT TO authenticated
  USING (private.can_access_hostel(hostel_id));

DROP POLICY IF EXISTS archive_permissions_select_own_or_manager ON public.archive_edit_permissions;
CREATE POLICY archive_permissions_select_own_or_manager ON public.archive_edit_permissions FOR SELECT TO authenticated
  USING (membership_id=private.my_membership_id() OR private.can_manage_hostel(hostel_id,null,false,false));

DROP POLICY IF EXISTS notifications_select_recipient ON public.notifications;
CREATE POLICY notifications_select_recipient ON public.notifications FOR SELECT TO authenticated
  USING (recipient_user_id=auth.uid() AND deleted_at IS NULL);

DROP POLICY IF EXISTS meal_snapshots_select_same_hostel ON public.daily_meal_snapshots;
CREATE POLICY meal_snapshots_select_same_hostel ON public.daily_meal_snapshots FOR SELECT TO authenticated
  USING (private.can_access_hostel(hostel_id));

DROP POLICY IF EXISTS meal_overrides_select_same_hostel ON public.meal_late_overrides;
CREATE POLICY meal_overrides_select_same_hostel ON public.meal_late_overrides FOR SELECT TO authenticated
  USING (private.can_access_hostel(hostel_id));

-- Only the helper functions required inside RLS/Storage policies are callable
-- from the browser role. Other private implementation functions remain private.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.my_membership_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_hostel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_manage_hostel(uuid,uuid,boolean,boolean) TO authenticated;

-- The only public/anonymous RPC is the deliberately redacted public-settings API.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_public_settings() TO anon, authenticated;

-- Storage buckets used by the supplied frontend. Profile avatars are public
-- because the UI uses getPublicUrl(); upload/update/delete remain RLS-protected.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('profile-avatars','profile-avatars',true,10485760,ARRAY['image/jpeg','image/png','image/webp']),
       ('developer-assets','developer-assets',true,5242880,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public=EXCLUDED.public,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS hostel_life_avatar_select_own_or_superadmin ON storage.objects;
CREATE POLICY hostel_life_avatar_select_own_or_superadmin ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='profile-avatars' AND ((storage.foldername(name))[1]=auth.uid()::text OR private.is_super_admin()));
DROP POLICY IF EXISTS hostel_life_avatar_insert_own ON storage.objects;
CREATE POLICY hostel_life_avatar_insert_own ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='profile-avatars' AND (storage.foldername(name))[1]=auth.uid()::text);
DROP POLICY IF EXISTS hostel_life_avatar_update_own ON storage.objects;
CREATE POLICY hostel_life_avatar_update_own ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='profile-avatars' AND (storage.foldername(name))[1]=auth.uid()::text)
WITH CHECK (bucket_id='profile-avatars' AND (storage.foldername(name))[1]=auth.uid()::text);
DROP POLICY IF EXISTS hostel_life_avatar_delete_own ON storage.objects;
CREATE POLICY hostel_life_avatar_delete_own ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='profile-avatars' AND (storage.foldername(name))[1]=auth.uid()::text);

DROP POLICY IF EXISTS hostel_life_developer_assets_select_superadmin ON storage.objects;
CREATE POLICY hostel_life_developer_assets_select_superadmin ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='developer-assets' AND private.is_super_admin());
DROP POLICY IF EXISTS hostel_life_developer_assets_insert_superadmin ON storage.objects;
CREATE POLICY hostel_life_developer_assets_insert_superadmin ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='developer-assets' AND private.is_super_admin() AND name='developer-info/developer-photo.jpg');
DROP POLICY IF EXISTS hostel_life_developer_assets_update_superadmin ON storage.objects;
CREATE POLICY hostel_life_developer_assets_update_superadmin ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='developer-assets' AND private.is_super_admin() AND name='developer-info/developer-photo.jpg')
WITH CHECK (bucket_id='developer-assets' AND private.is_super_admin() AND name='developer-info/developer-photo.jpg');
DROP POLICY IF EXISTS hostel_life_developer_assets_delete_superadmin ON storage.objects;
CREATE POLICY hostel_life_developer_assets_delete_superadmin ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='developer-assets' AND private.is_super_admin());

-- Add all frontend-relevant hostel-scoped tables to Supabase Realtime where the
-- standard supabase_realtime publication is available in the project.
DO $$ DECLARE t text; BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['monthly_periods','hostel_memberships','notifications','meal_requests','meal_late_overrides',
      'daily_meal_snapshots','market_entries','khala_money_entries','ledger_transactions'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
      END IF;
    END LOOP;
  ELSE
    RAISE NOTICE 'supabase_realtime publication was not found; enable Realtime for frontend refresh tables in Supabase Dashboard.';
  END IF;
END $$;

-- A few final safety checks; fail closed instead of silently installing a broken core.
DO $$ BEGIN
  IF (SELECT count(*) FROM public.platform_settings WHERE singleton=true) <> 1 THEN
    RAISE EXCEPTION 'Hostel Life install failed: platform_settings singleton row missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='on_auth_user_created_hostel_life' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Hostel Life install failed: Auth profile trigger missing.';
  END IF;
END $$;

COMMIT;

-- END OF MASTER INSTALL.
-- After running this script, follow INSTALL_GUIDE_BN.md to bootstrap one
-- trusted Super Admin account, configure Supabase Auth URLs, and connect Vite.
