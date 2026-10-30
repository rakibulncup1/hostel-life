-- HOSTEL LIFE / PRO MASTER REVIEW CANDIDATE 2026-10-16
-- Not executed on PostgreSQL; not certified for direct production deployment.
-- This supersedes ALL prior unexecuted assistant-generated migration candidates.
-- BEGIN/COMMIT wrap schema changes; migration itself does NOT call the irreversible archive purge RPC.
-- DO NOT rerun the original MASTER SQL; do not execute earlier candidate SQL in addition.
-- Security warning: 'SECURITY DEFINER' function bodies require PostgreSQL privilege tests.
-- REQUEST COVERAGE / SQL SCOPE (✅ included, ⚠️ partial or risky, ❌ outside SQL)
-- 01/08: পৃষ্ঠা হেডিং / ব্যাক বাটন — ❌ Frontend
-- 02/04: অপ্রয়োজনীয় UI টেক্সট / গাইড — ❌ Frontend
-- 03: Archive permission grants — ✅ SQL included; staging verification required
-- 05: মাস বন্ধ / পরদিন মাস শুরু — ✅ SQL included; staging verification required
-- 06: Other expense history RPC — ✅ SQL included; frontend integration check needed
-- 07: A4 PDF + copyright footer — ❌ Frontend PDF
-- 09: Super Admin statistics/UI/blocked manager — ⚠️ SQL blocked-manager change; stats/UI separate
-- 10: Closed period khala permission — ✅ SQL included; staging verification required
-- 11: Profile image/email — ❌ Frontend/storage
-- 12-15: Dashboard, auth UI, flash, cards — ❌ Frontend
-- 16: Notifications new market/month/manager/member/requests — ✅ SQL included; must test recipients
-- 17-20: Market UI/themes/assistant name — ❌ Frontend
-- 21: Retention queue/final summary/manual deletion — ⚠️ SQL included, deletion risk: backup + staging + manual verification
-- 22-24: Activity log minimization/offline cache — ⚠️ No time tracking introduced; app behavior separate
-- 25: Late request scrolling — ❌ Frontend
-- PASSWORD: Admin temporary password reset — ❌ Cannot securely implement solely in SQL; Edge Function deployment + UI required
-- IMPORTANT: “included” never means verified in live PostgreSQL.

-- HOSTEL LIFE / MODULE 02 / RECONCILED STAGING MIGRATION
-- Sources: original 6 SQL files and live read-only snapshot Run SQL (1).csv
-- MUST TEST ON RESTORED STAGING DB BEFORE LIVE DATABASE. No database backup included.
-- DO NOT RUN MASTER No1 AGAIN. No historical rows will be deleted by this script.
-- Manual archive deletion requires verified final summary, exact confirmation and staging tests. Password reset requires Edge Function.
-- HOSTEL LIFE / Module 02 / unified migration, staging validation mandatory
-- Backend-only changes; several user-visible tasks still require frontend and Edge Function deployment.
-- Run on a restored staging database first; manual archive deletion permanently destroys details.
-- Replaces selected existing RPC function definitions; live bodies may differ from saved SQL.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- REVIEW V2: only existing DB schema validated; never executes a purge during migration.
-- Note: Archive RPC confirmation remains DELETE <period UUID>, not the old UI's DELETE ARCHIVE.
-- EARLY FAIL: preflight schema drift before applying any DDL.
DO $hl_preflight$
DECLARE missing text;
BEGIN
 SELECT string_agg(req.t || '.' || req.c, ', ' ORDER BY req.t,req.c)
 INTO missing
 FROM (VALUES
 ('monthly_periods','id'),
 ('monthly_periods','hostel_id'),
 ('monthly_periods','label'),
 ('monthly_periods','start_date'),
 ('monthly_periods','end_date'),
 ('monthly_periods','status'),
 ('monthly_periods','primary_manager_membership_id'),
 ('monthly_periods','created_by'),
 ('hostel_memberships','id'),
 ('hostel_memberships','hostel_id'),
 ('hostel_memberships','user_id'),
 ('hostel_memberships','status'),
 ('hostel_memberships','role'),
 ('profiles','id'),
 ('profiles','is_blocked'),
 ('notifications','hostel_id'),
 ('notifications','recipient_user_id'),
 ('notifications','title'),
 ('notifications','body'),
 ('notifications','created_by'),
 ('market_entries','id'),
 ('market_entries','hostel_id'),
 ('market_entries','period_id'),
 ('market_entries','created_by'),
 ('market_entries','entry_date'),
 ('market_entries','status'),
 ('meal_requests','id'),
 ('meal_requests','hostel_id'),
 ('meal_requests','period_id'),
 ('meal_requests','membership_id'),
 ('meal_requests','days'),
 ('meal_requests','status'),
 ('meal_requests','reviewed_by'),
 ('ledger_transactions','hostel_id'),
 ('ledger_transactions','period_id'),
 ('ledger_transactions','member_id'),
 ('ledger_transactions','amount'),
 ('ledger_transactions','ledger_type'),
 ('ledger_transactions','status'),
 ('ledger_transactions','created_by'),
 ('khala_money_entries','hostel_id'),
 ('khala_money_entries','period_id'),
 ('khala_money_entries','payment_date'),
 ('khala_money_entries','status'),
 ('archive_edit_permissions','period_id'),
 ('archive_edit_permissions','membership_id'),
 ('archive_edit_permissions','revoked_at'),
 ('platform_audit_log','actor_user_id'),
 ('platform_audit_log','action'),
 ('platform_audit_log','target_type'),
 ('platform_audit_log','target_id'),
 ('platform_audit_log','details')
 ) AS req(t,c)
 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns z
                   WHERE z.table_schema='public' AND z.table_name=req.t AND z.column_name=req.c);
 IF missing IS NOT NULL THEN
   RAISE EXCEPTION 'Hostel Life schema mismatch (missing columns): %',missing;
 END IF;
END $hl_preflight$;

DO $$ BEGIN
 IF to_regclass('public.monthly_periods') IS NULL OR to_regclass('public.platform_settings') IS NULL
    OR to_regclass('public.notifications') IS NULL OR to_regprocedure('private.is_super_admin()') IS NULL THEN
   RAISE EXCEPTION 'Expected Hostel Life schema missing; migration aborted';
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.platform_retention_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 detail_months integer NOT NULL DEFAULT 2 CHECK (detail_months BETWEEN 1 AND 36),
 summary_months integer NOT NULL DEFAULT 6 CHECK (summary_months BETWEEN 0 AND 120),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.platform_retention_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_retention_policy FROM PUBLIC, anon, authenticated;
INSERT INTO public.platform_retention_policy (singleton,detail_months,summary_months) VALUES (true,2,6) ON CONFLICT (singleton) DO NOTHING;
CREATE OR REPLACE FUNCTION public.platform_admin_get_retention() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
 IF NOT private.is_super_admin() THEN RAISE EXCEPTION 'Only Super Admin is allowed' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('detail_months',detail_months,'summary_months',summary_months) INTO v FROM public.platform_retention_policy WHERE singleton=true;
 RETURN COALESCE(v,'{"detail_months":2,"summary_months":6}'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.platform_admin_update_retention(p_detail_months integer,p_summary_months integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb; v_h record;
BEGIN
 IF NOT private.is_super_admin() THEN RAISE EXCEPTION 'Only Super Admin is allowed' USING ERRCODE='42501'; END IF;
 IF p_detail_months IS NULL OR p_summary_months IS NULL OR p_detail_months NOT BETWEEN 1 AND 36 OR p_summary_months NOT BETWEEN 0 AND 120 THEN
   RAISE EXCEPTION 'Invalid retention months' USING ERRCODE='22023'; END IF;
 UPDATE public.platform_retention_policy SET detail_months=p_detail_months,summary_months=p_summary_months,updated_at=now(),updated_by=auth.uid() WHERE singleton=true;
 INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,details) VALUES
 (auth.uid(),'retention_policy_updated','platform_retention_policy','singleton',jsonb_build_object('detail_months',p_detail_months,'summary_months',p_summary_months));
 -- A single notification per active user; setting changes should be infrequent.
 INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by)
 SELECT DISTINCT ON (m.hostel_id,m.user_id) m.hostel_id,m.user_id,'ডেটা সংরক্ষণ নীতি পরিবর্তিত',
 'বিস্তারিত তথ্য '||p_detail_months||' মাস এবং অতিরিক্ত সামারি '||p_summary_months||' মাস সংরক্ষণের নীতি নির্ধারিত হয়েছে।',auth.uid()
 FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
 WHERE m.status='active' AND NOT p.is_blocked;
 SELECT jsonb_build_object('detail_months',detail_months,'summary_months',summary_months) INTO v FROM public.platform_retention_policy WHERE singleton=true;
 RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.platform_admin_list_expired_archives() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
 IF NOT private.is_super_admin() THEN RAISE EXCEPTION 'Only Super Admin is allowed' USING ERRCODE='42501'; END IF;
 -- READ-ONLY eligibility list; source archives are NOT compacted or deleted by this patch.
 SELECT COALESCE(jsonb_agg(jsonb_build_object('hostel_id',t.hostel_id,'period_id',t.period_id,
   'hostel_name',t.hostel_name,'period_label',t.period_label,'expired_at',t.expired_at) ORDER BY t.expired_at), '[]'::jsonb) INTO v
 FROM (SELECT mp.hostel_id,mp.id AS period_id,h.name AS hostel_name,mp.label AS period_label,
 (mp.end_date + make_interval(months => rp.detail_months+rp.summary_months))::date AS expired_at
 FROM public.monthly_periods mp JOIN public.hostels h ON h.id=mp.hostel_id
 CROSS JOIN public.platform_retention_policy rp
 WHERE rp.singleton=true AND mp.status IN ('closed','archived') AND
 (mp.end_date + make_interval(months => rp.detail_months+rp.summary_months))::date < (now() AT TIME ZONE 'Asia/Dhaka')::date
 ORDER BY mp.end_date LIMIT 500) t;
 RETURN v;
END $$;
-- Deletion endpoint is defined at end of file, after all required tables exist.
-- Manual deletion still requires backup and restoration test.
-- Deliberately implemented below, after standalone final-summary table exists.
REVOKE ALL ON FUNCTION public.platform_admin_get_retention() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_update_retention(integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_expired_archives() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_retention() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_update_retention(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_expired_archives() TO authenticated;



-- Existing function replacement based on supplied No1 master; compare in staging first.
create or replace function public.grant_archive_edit_permission(p_period_id uuid,p_membership_id uuid,p_expires_at timestamptz default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype; v_perm public.archive_edit_permissions%rowtype;
begin
  perform private.assert_signed_in(); select * into v_period from public.monthly_periods where id=p_period_id and hostel_id=v_hostel and status in ('closed','archived');
  if not found then raise exception using message='শুধু বন্ধ বা আর্কাইভ করা মাসের জন্য অনুমতি দেওয়া যায়।',errcode='22023'; end if;
  perform private.assert_hostel_manager(v_hostel,null,true,false);
  if not exists(select 1 from public.hostel_memberships where id=p_membership_id and hostel_id=v_hostel and status='active') then raise exception using message='সক্রিয় সদস্য নির্বাচন করুন।',errcode='P0002'; end if;
  if p_membership_id is distinct from v_period.primary_manager_membership_id then
    raise exception using message='এই মাসের পূর্ববর্তী প্রধান ম্যানেজারকেই আর্কাইভ অনুমতি দেওয়া যাবে।',errcode='42501';
  end if;
  if p_expires_at is null or p_expires_at > now() + interval '30 days' then
    raise exception using message='১ থেকে ৩০ দিনের মধ্যে অনুমতির মেয়াদ নির্ধারণ করুন।',errcode='22023';
  end if;
  if p_expires_at is not null and p_expires_at<=now() then raise exception using message='অনুমতির মেয়াদ ভবিষ্যতের হতে হবে।',errcode='22023'; end if;
  update public.archive_edit_permissions set revoked_at=now() where period_id=p_period_id and membership_id=p_membership_id and revoked_at is null;
  insert into public.archive_edit_permissions(hostel_id,period_id,membership_id,granted_by,reason,expires_at) values(v_hostel,p_period_id,p_membership_id,auth.uid(),nullif(btrim(p_reason),''),p_expires_at) returning * into v_perm;
  return jsonb_build_object('id',v_perm.id,'period_id',v_perm.period_id,'membership_id',v_perm.membership_id,'granted_by',v_perm.granted_by,'reason',v_perm.reason,'expires_at',v_perm.expires_at,'revoked_at',v_perm.revoked_at,'created_at',v_perm.created_at);
end $$;

create or replace function public.reactivate_member(p_membership_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_m public.hostel_memberships%rowtype;
begin
  perform private.assert_signed_in(); perform private.assert_hostel_manager(v_hostel,null,false,false);
  select * into v_m from public.hostel_memberships where id=p_membership_id and hostel_id=v_hostel;
  if not found then raise exception using message='সদস্যের তথ্য পাওয়া যায়নি।',errcode='P0002'; end if;
  if exists (select 1 from public.profiles p where p.id=v_m.user_id and p.is_blocked=true) then
    raise exception using message='প্ল্যাটফর্ম থেকে ব্লক করা অ্যাকাউন্ট ম্যানেজার চালু করতে পারবেন না।',errcode='42501';
  end if;
  update public.hostel_memberships set status='active',deactivated_at=null where id=v_m.id;
  return jsonb_build_object('membership_id',v_m.id,'status','active');
end $$;

-- Market notifications ON by request; ledger/khala notifications remain OFF.
CREATE TABLE IF NOT EXISTS public.platform_notification_preferences (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 market_activity_enabled boolean NOT NULL DEFAULT true,
 ledger_activity_enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.platform_notification_preferences(singleton,market_activity_enabled) VALUES(true,true) ON CONFLICT (singleton) DO UPDATE SET market_activity_enabled=true;
ALTER TABLE public.platform_notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_notification_preferences FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION private.hl_notify_market_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT COALESCE((SELECT market_activity_enabled FROM public.platform_notification_preferences WHERE singleton),false) THEN RETURN NEW; END IF;
 INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by)
 SELECT DISTINCT ON (m.user_id) NEW.hostel_id,m.user_id,'নতুন বাজার এন্ট্রি','মেসে নতুন বাজারের হিসাব যোগ হয়েছে।',NEW.created_by
 FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
 WHERE m.hostel_id=NEW.hostel_id AND m.status='active' AND NOT p.is_blocked
 AND m.user_id IS DISTINCT FROM NEW.created_by;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hl_market_notification_ins ON public.market_entries;
CREATE TRIGGER hl_market_notification_ins AFTER INSERT ON public.market_entries FOR EACH ROW EXECUTE FUNCTION private.hl_notify_market_insert();
REVOKE ALL ON FUNCTION private.hl_notify_market_insert() FROM PUBLIC,anon,authenticated;



-- MONTH END CUTOFF 
create or replace function public.close_current_month(p_confirm_future_cancel boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hostel uuid:=private.my_hostel_id(); v_period public.monthly_periods%rowtype; v_future_count integer:=0; v_cancelled integer:=0;
begin
  perform private.assert_signed_in();
  select * into v_period from public.monthly_periods where hostel_id=v_hostel and status='running' limit 1;
  if not found then raise exception using message='বন্ধ করার মতো কোনো চলমান মাস নেই।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_hostel,v_period.id,true,false);
  IF (now() AT TIME ZONE 'Asia/Dhaka')::date < v_period.start_date THEN
    RAISE EXCEPTION 'Cannot close a period before its start date' USING ERRCODE='22023';
  END IF;
  select count(*) into v_future_count from public.meal_requests r where r.period_id=v_period.id and r.status in ('submitted','approved') and exists(select 1 from jsonb_array_elements(r.days) d where (d->>'meal_date')::date>(now() at time zone 'Asia/Dhaka')::date);
  -- Do not silently shift or delete existing financial transactions past the cutoff.
  if exists (select 1 from public.ledger_transactions l where l.period_id=v_period.id
       and l.entry_date > (now() at time zone 'Asia/Dhaka')::date and l.status <> 'void')
     or exists (select 1 from public.market_entries e where e.period_id=v_period.id
       and e.entry_date > (now() at time zone 'Asia/Dhaka')::date and e.status <> 'void')
     or exists (select 1 from public.khala_money_entries k where k.period_id=v_period.id
       and k.payment_date > (now() at time zone 'Asia/Dhaka')::date and k.status <> 'void') then
    raise exception using message='বর্তমান তারিখের পর আর্থিক এন্ট্রি আছে; আগে সেগুলো যাচাই করুন।',errcode='23514';
  end if;
    if v_future_count>0 and not coalesce(p_confirm_future_cancel,false) then raise exception using message=format('মাস বন্ধ করলে %sটি ভবিষ্যতের মিল অনুরোধ প্রভাবিত হবে। নিশ্চিত করতে আবার চেষ্টা করুন।',v_future_count),errcode='55000'; end if;
  if coalesce(p_confirm_future_cancel,false) then
    update public.meal_requests r set status='cancelled',review_reason='মাস বন্ধের সময় ভবিষ্যতের অনুরোধ বাতিল',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
      where r.period_id=v_period.id and r.status in ('submitted','approved') and exists(select 1 from jsonb_array_elements(r.days) d where (d->>'meal_date')::date>(now() at time zone 'Asia/Dhaka')::date);
    get diagnostics v_cancelled = row_count;
    update public.daily_meal_records r set cancelled=true,updated_by=auth.uid(),updated_at=now() from public.daily_meal_days d
      where r.daily_meal_day_id=d.id and d.period_id=v_period.id and d.meal_date>(now() at time zone 'Asia/Dhaka')::date;
    update public.daily_meal_days set status='cancelled' where period_id=v_period.id and meal_date>(now() at time zone 'Asia/Dhaka')::date;
  end if;
  -- End month today, not at the original calendar-month boundary.
  -- Cancel future day rows only after acknowledgement, never finalize them into this month.
  if exists(select 1 from public.daily_meal_days d where d.period_id=v_period.id
           and d.meal_date>(now() at time zone 'Asia/Dhaka')::date
           and d.status<>'cancelled') and not coalesce(p_confirm_future_cancel,false) then
     raise exception using message='ভবিষ্যতের মিল দিনের তথ্য রয়েছে। নিশ্চিত করে আবার চেষ্টা করুন।',errcode='55000';
  end if;
  update public.daily_meal_records r set cancelled=true,updated_by=auth.uid(),updated_at=now()
    from public.daily_meal_days d where r.daily_meal_day_id=d.id and d.period_id=v_period.id
      and d.meal_date>(now() at time zone 'Asia/Dhaka')::date;
  update public.daily_meal_days set status='cancelled' where period_id=v_period.id
    and meal_date>(now() at time zone 'Asia/Dhaka')::date;
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
  update public.monthly_periods set end_date=least(end_date,(now() at time zone 'Asia/Dhaka')::date),status='closed',closed_by=auth.uid(),closed_at=now(),updated_at=now() where id=v_period.id returning * into v_period;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_hostel,v_period.id,auth.uid(),'update:period_closed','মাস বন্ধ করা হয়েছে',jsonb_build_object('cancelled_requests',v_cancelled,'period_id',v_period.id));
  return jsonb_build_object('status','closed','period_id',v_period.id,'label',v_period.label,'cancelled_requests',v_cancelled);
end $$;
-- CLOSED-MONTH KHALA GUARDS 
create or replace function public.manager_void_khala_money(p_entry_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.khala_money_entries%rowtype;
begin
  perform private.assert_signed_in(); select * into v_row from public.khala_money_entries where id=p_entry_id;
  if not found then raise exception using message='খালার টাকার এন্ট্রি পাওয়া যায়নি।',errcode='P0002'; end if;
  perform private.assert_hostel_manager(v_row.hostel_id,v_row.period_id,false,true);
  if exists (select 1 from public.monthly_periods per where per.id=v_row.period_id and per.status<>'running')
     and not exists (
      select 1 from public.monthly_periods per join public.hostel_memberships m
        on m.id=per.primary_manager_membership_id
       where per.id=v_row.period_id and m.user_id=auth.uid() and m.status='active'
     ) and not exists (
      select 1 from public.archive_edit_permissions a join public.hostel_memberships m on m.id=a.membership_id
       where a.period_id=v_row.period_id and m.user_id=auth.uid() and m.status='active'
         and a.revoked_at is null and a.expires_at>now()
     ) then raise exception 'বন্ধ মাসের খালার টাকা সম্পাদনার অনুমতি নেই' using errcode='42501'; end if;

  if nullif(btrim(p_reason),'') is null then raise exception using message='বাতিলের কারণ লিখুন।',errcode='22023'; end if;
  update public.khala_money_entries set status='void',void_reason=btrim(p_reason),voided_by=auth.uid(),voided_at=now() where id=v_row.id;
  insert into public.archive_period_audit(hostel_id,period_id,actor_user_id,action,summary,details) values(v_row.hostel_id,v_row.period_id,auth.uid(),'update:khala_void','খালার টাকার এন্ট্রি বাতিল হয়েছে',jsonb_build_object('entry_id',v_row.id,'reason',p_reason));
  return jsonb_build_object('entry_id',v_row.id,'status','void');
end $$;
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
  if v_period.status<>'running' and not exists (
     select 1 from public.hostel_memberships m where m.id=v_period.primary_manager_membership_id
       and m.user_id=auth.uid() and m.status='active'
   ) and not exists (
     select 1 from public.archive_edit_permissions a join public.hostel_memberships m on m.id=a.membership_id
      where a.period_id=v_period.id and m.user_id=auth.uid() and m.status='active'
       and a.revoked_at is null and a.expires_at>now()
   ) then raise exception 'বন্ধ মাসের খালার টাকা সম্পাদনার অনুমতি নেই' using errcode='42501'; end if;

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
-- SHARED EXPENSE HISTORY 
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
      and (v_effective_member is null or member_id=v_effective_member or (ledger_type='other_expense' and member_id is null))
    order by entry_date desc,created_at desc
    limit greatest(1,least(coalesce(p_limit,200),3000))
  ) l
  left join public.hostel_memberships m on m.id=l.member_id
  left join public.profiles p on p.id=m.user_id;
  return v_result;
end $$;

CREATE OR REPLACE FUNCTION public.get_other_expense_history(p_period_id uuid DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_hostel uuid := private.my_hostel_id(); v_rows jsonb;
BEGIN
 PERFORM private.assert_signed_in();
 IF v_hostel IS NULL THEN RETURN '[]'::jsonb; END IF;
 IF p_period_id IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM public.monthly_periods WHERE id=p_period_id AND hostel_id=v_hostel) THEN
    RAISE EXCEPTION 'এই মাসের তথ্য দেখার অনুমতি নেই' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,'period_id',q.period_id,
    'amount',q.amount,'entry_date',q.entry_date,'description',q.description,
    'status',q.status,'ledger_type',q.ledger_type,'ledger_group',q.ledger_group)
    ORDER BY q.entry_date DESC,q.created_at DESC),'[]'::jsonb)
 INTO v_rows FROM (
   SELECT l.id,l.period_id,l.amount,l.entry_date,l.description,l.status,l.ledger_type,l.ledger_group,l.created_at
   FROM public.ledger_transactions l WHERE l.hostel_id=v_hostel AND l.ledger_type='other_expense'
    AND (p_period_id IS NULL OR l.period_id=p_period_id)
   ORDER BY l.entry_date DESC,l.created_at DESC
   LIMIT least(greatest(coalesce(p_limit,200),1),500)
 ) q;
 RETURN v_rows;
END $$;
REVOKE ALL ON FUNCTION public.get_other_expense_history(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_other_expense_history(uuid,integer) TO authenticated;

-- FINANCIAL SUMMARY STAGING (NO DELETION) 

CREATE TABLE IF NOT EXISTS public.hl_period_summary_snapshots (
  period_id uuid PRIMARY KEY REFERENCES public.monthly_periods(id) ON DELETE RESTRICT,
  hostel_id uuid NOT NULL REFERENCES public.hostels(id),
  snapshot jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  captured_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.hl_period_summary_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hl_period_summary_snapshots FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.platform_admin_capture_archive_summary(p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_period public.monthly_periods%rowtype; v_doc jsonb;
BEGIN
  IF NOT private.is_super_admin() THEN RAISE EXCEPTION 'Only Super Admin' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_period FROM public.monthly_periods WHERE id=p_period_id FOR UPDATE;
  IF NOT FOUND OR v_period.status NOT IN ('closed','archived') THEN
    RAISE EXCEPTION 'Only closed/archived periods can be captured' USING ERRCODE='22023'; END IF;
  SELECT jsonb_build_object(
    'schema_version',1,'period_id',v_period.id,'hostel_id',v_period.hostel_id,
    'period_label',v_period.label,'start_date',v_period.start_date,'end_date',v_period.end_date,
    'ledger_summary',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',t.ledger_type,'status',t.status,
       'entries',t.entries,'total',t.total)), '[]'::jsonb) FROM
       (SELECT ledger_type,status,count(*) entries,sum(amount) total FROM public.ledger_transactions
        WHERE period_id=v_period.id GROUP BY ledger_type,status) t),
    'market_summary',(SELECT jsonb_build_object('entries',count(*),'total',coalesce(sum(total_amount),0))
       FROM public.market_entries WHERE period_id=v_period.id AND status <> 'void'),
    'khala_summary',(SELECT jsonb_build_object('entries',count(*),'total',coalesce(sum(amount),0))
       FROM public.khala_money_entries WHERE period_id=v_period.id AND status <> 'void')
    ) INTO v_doc;
  INSERT INTO public.hl_period_summary_snapshots(period_id,hostel_id,snapshot,captured_by)
   VALUES(v_period.id,v_period.hostel_id,v_doc,auth.uid())
   ON CONFLICT(period_id) DO NOTHING;
  RETURN jsonb_build_object('period_id',p_period_id,'snapshot_created',found,
    'deletion_enabled',false);
END $$;
REVOKE ALL ON FUNCTION public.platform_admin_capture_archive_summary(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_capture_archive_summary(uuid) TO authenticated;



-- ============================================================================
-- MODULE 02 EXTENSIONS / CONSOLIDATED FEATURES (NON-DESTRUCTIVE)
-- ============================================================================

-- Member-visible global retention policy (Super Admin edit remains separately gated)
CREATE OR REPLACE FUNCTION public.get_retention_notice()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_detail int; v_summary int;
BEGIN
 PERFORM private.assert_signed_in();
 SELECT detail_months,summary_months INTO v_detail,v_summary
 FROM public.platform_retention_policy WHERE singleton=true;
 RETURN jsonb_build_object('detail_months',coalesce(v_detail,2),
   'summary_months',coalesce(v_summary,6),'automatic_deletion',false);
END $$;
REVOKE ALL ON FUNCTION public.get_retention_notice() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_retention_notice() TO authenticated;

-- Summaries are immutable copies detached from monthly_periods to survive deletion.
-- The summary is deliberately financial aggregates rather than complete personal activity logs.
CREATE TABLE IF NOT EXISTS public.hl_archived_final_summaries (
 period_id uuid PRIMARY KEY,
 hostel_id uuid NOT NULL,
 hostel_name text NOT NULL,
 period_label text NOT NULL,
 start_date date NOT NULL,
 end_date date NOT NULL,
 summary jsonb NOT NULL,
 archived_at timestamptz NOT NULL DEFAULT now(),
 archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 purged_at timestamptz,
 verified_at timestamptz,
 verified_by uuid
);
CREATE INDEX IF NOT EXISTS hl_archived_final_summaries_hostel_date
 ON public.hl_archived_final_summaries(hostel_id,end_date DESC);
ALTER TABLE public.hl_archived_final_summaries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hl_archived_final_summaries FROM PUBLIC,anon,authenticated;

-- Archive export retains total meal quantities + members' final ledger totals.
-- It does not automatically delete ANY source rows.
CREATE OR REPLACE FUNCTION public.platform_admin_finalize_archive_summary(p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_period public.monthly_periods%rowtype; v_hostel_name text; v_doc jsonb;
BEGIN
 IF NOT private.is_super_admin() THEN RAISE EXCEPTION 'Super Admin only' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_period FROM public.monthly_periods WHERE id=p_period_id FOR UPDATE;
 IF NOT FOUND OR v_period.status NOT IN ('closed','archived') THEN
   RAISE EXCEPTION 'Closed/archived period required' USING ERRCODE='22023'; END IF;
 SELECT h.name INTO v_hostel_name FROM public.hostels h WHERE h.id=v_period.hostel_id;
 SELECT jsonb_build_object(
  'schema_version',2,'period_id',v_period.id,'hostel_id',v_period.hostel_id,
  'label',v_period.label,'start_date',v_period.start_date,'end_date',v_period.end_date,
  'ledger_totals',(
    SELECT coalesce(jsonb_agg(jsonb_build_object('type',q.ledger_type,'status',q.status,
       'count',q.n,'amount',q.total)),'[]'::jsonb)
    FROM (SELECT ledger_type,status,count(*) n,sum(amount) total FROM public.ledger_transactions
       WHERE period_id=v_period.id GROUP BY ledger_type,status ORDER BY ledger_type,status) q),
  'member_totals',(
    SELECT coalesce(jsonb_agg(jsonb_build_object('member_id',q.member_id,'name',q.name,
      'deposits',q.deposits,'market_deposits',q.market_deposits,'adjustments',q.adjustments,
      'other_expenses',q.other_expenses)),'[]'::jsonb)
    FROM (SELECT l.member_id,coalesce(max(l.member_name_snapshot),'সদস্য') name,
       coalesce(sum(l.amount) FILTER (WHERE ledger_type='deposit'),0) deposits,
       coalesce(sum(l.amount) FILTER (WHERE ledger_type='market_deposit'),0) market_deposits,
       coalesce(sum(l.amount) FILTER (WHERE ledger_type='adjustment'),0) adjustments,
       coalesce(sum(l.amount) FILTER (WHERE ledger_type='other_expense'),0) other_expenses
      FROM public.ledger_transactions l WHERE period_id=v_period.id AND status='active'
      GROUP BY l.member_id) q),
  'market_total',(SELECT coalesce(sum(total_amount),0) FROM public.market_entries
                  WHERE period_id=v_period.id AND status='active'),
  'khala_total',(SELECT coalesce(sum(amount),0) FROM public.khala_money_entries
                  WHERE period_id=v_period.id AND status='active'),
  'meal_total',(
    SELECT jsonb_build_object('breakfast',coalesce(sum(final_breakfast),0),
       'lunch',coalesce(sum(final_lunch),0),'dinner',coalesce(sum(final_dinner),0))
    FROM public.daily_meal_records WHERE period_id=v_period.id AND NOT cancelled)
 ) INTO v_doc;
 INSERT INTO public.hl_archived_final_summaries
  (period_id,hostel_id,hostel_name,period_label,start_date,end_date,summary,archived_by)
 VALUES(v_period.id,v_period.hostel_id,v_hostel_name,v_period.label,
        v_period.start_date,v_period.end_date,v_doc,auth.uid())
 ON CONFLICT(period_id) DO NOTHING;
 RETURN jsonb_build_object('period_id',v_period.id,'summary_saved',true,
  'already_existed',(SELECT archived_at < now()-interval '1 second'
                     FROM public.hl_archived_final_summaries WHERE period_id=v_period.id));
END $$;
REVOKE ALL ON FUNCTION public.platform_admin_finalize_archive_summary(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_finalize_archive_summary(uuid) TO authenticated;

-- Explicit manual review before irreversible deletion. The Super Admin must compare
-- this summary against the exported period report, not merely click an auto-approve.
CREATE OR REPLACE FUNCTION public.platform_admin_verify_archive_summary(
 p_period_id uuid, p_confirmation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT private.is_super_admin() THEN RAISE EXCEPTION 'Super Admin only' USING ERRCODE='42501'; END IF;
 IF p_confirmation IS DISTINCT FROM 'VERIFY '||p_period_id::text THEN
  RAISE EXCEPTION 'Explicit VERIFY confirmation is required' USING ERRCODE='22023'; END IF;
 UPDATE public.hl_archived_final_summaries
 SET verified_at=now(),verified_by=auth.uid()
 WHERE period_id=p_period_id AND purged_at IS NULL RETURNING period_id INTO v_id;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Unpurged summary not found' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('verified',true,'period_id',v_id);
END $$;
REVOKE ALL ON FUNCTION public.platform_admin_verify_archive_summary(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_verify_archive_summary(uuid,text) TO authenticated;

-- Historical summaries remain available to active members of the SAME hostel.
CREATE OR REPLACE FUNCTION public.get_archived_final_summaries(p_hostel_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_hostel uuid:=private.my_hostel_id(); v_docs jsonb;
BEGIN
 PERFORM private.assert_signed_in();
 IF NOT private.is_super_admin() AND (v_hostel IS NULL OR
      (p_hostel_id IS NOT NULL AND p_hostel_id<>v_hostel)) THEN
   RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('period_id',s.period_id,
  'hostel_id',s.hostel_id,'period_label',s.period_label,'start_date',s.start_date,
  'end_date',s.end_date,'summary',s.summary) ORDER BY s.end_date DESC),'[]'::jsonb)
 INTO v_docs FROM public.hl_archived_final_summaries s
 WHERE s.hostel_id=coalesce(p_hostel_id,v_hostel);
 RETURN v_docs;
END $$;
REVOKE ALL ON FUNCTION public.get_archived_final_summaries(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_archived_final_summaries(uuid) TO authenticated;

-- IMPORTANT: irreversible archive deletion requires tested off-site backup and
-- known-complete accounting summaries. This function is fail-closed by design.
-- UI receives an explicit error instead of a falsely successful deletion.
-- Never auto-compact or auto-purge on the free plan.

-- Low-volume event notifications: only approved requests & meaningful changes.
CREATE OR REPLACE FUNCTION private.hl_notify_important_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_h uuid; v_title text; v_body text; v_actor uuid;
BEGIN
 IF TG_TABLE_NAME='meal_requests' THEN
    IF TG_OP<>'UPDATE' OR NEW.status IS NOT DISTINCT FROM OLD.status
       OR NEW.status NOT IN ('approved','rejected') THEN RETURN NEW; END IF;
    v_h:=NEW.hostel_id; v_actor:=NEW.reviewed_by;
    v_title:=CASE WHEN NEW.status='approved' THEN 'মিল অনুরোধ অনুমোদিত' ELSE 'মিল অনুরোধ বাতিল' END;
    v_body:='আপনার মিল অনুরোধের অবস্থা পরিবর্তিত হয়েছে।';
    INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by)
    SELECT v_h,m.user_id,v_title,v_body,v_actor
      FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
      WHERE m.id=NEW.membership_id AND NOT p.is_blocked;
    RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='hostel_memberships' THEN
    IF TG_OP<>'INSERT' AND (NEW.status IS NOT DISTINCT FROM OLD.status AND
       NEW.role IS NOT DISTINCT FROM OLD.role) THEN RETURN NEW; END IF;
    v_h:=NEW.hostel_id;v_actor:=auth.uid();
    v_title:=CASE WHEN TG_OP='INSERT' THEN 'নতুন সদস্য যুক্ত হয়েছে'
          WHEN NEW.status='active' THEN 'সদস্য সক্রিয় হয়েছে'
          ELSE 'সদস্যের অবস্থা পরিবর্তিত হয়েছে' END;
    v_body:='মেসের সদস্য তালিকায় গুরুত্বপূর্ণ পরিবর্তন হয়েছে।';
    INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by)
    SELECT DISTINCT m.hostel_id,m.user_id,v_title,v_body,v_actor
       FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
       WHERE m.hostel_id=v_h AND m.status='active' AND NOT p.is_blocked
       AND m.user_id IS DISTINCT FROM v_actor;
    RETURN NEW;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hl_approved_meal_request_notify ON public.meal_requests;
CREATE TRIGGER hl_approved_meal_request_notify AFTER UPDATE OF status ON public.meal_requests
 FOR EACH ROW EXECUTE FUNCTION private.hl_notify_important_event();
DROP TRIGGER IF EXISTS hl_membership_change_notify ON public.hostel_memberships;
CREATE TRIGGER hl_membership_change_notify AFTER INSERT OR UPDATE OF status,role ON public.hostel_memberships
 FOR EACH ROW EXECUTE FUNCTION private.hl_notify_important_event();
REVOKE ALL ON FUNCTION private.hl_notify_important_event() FROM PUBLIC,anon,authenticated;

-- Notification indexes avoid full scans; no polling, no session/activity logging.
CREATE INDEX IF NOT EXISTS hl_notifications_hostel_time_idx
 ON public.notifications(hostel_id,created_at DESC);

-- Explicit security for every newly exposed RPC.
REVOKE ALL ON FUNCTION public.platform_admin_get_retention() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_update_retention(integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_expired_archives() FROM PUBLIC,anon;


-- OPTIONAL ledger notification: single message to hostel members per newly-posted other expense.
-- Disabled by default; opt in only after assessing expected Supabase free-plan volume.
CREATE OR REPLACE FUNCTION private.hl_notify_ledger_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT COALESCE((SELECT ledger_activity_enabled FROM public.platform_notification_preferences WHERE singleton),false)
   OR NEW.ledger_type IS DISTINCT FROM 'other_expense' OR NEW.status IS DISTINCT FROM 'active' THEN
   RETURN NEW;
 END IF;
 INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by)
 SELECT m.hostel_id,m.user_id,'নতুন অন্যান্য খরচ','মেসের অন্যান্য খরচের হিসাবে নতুন এন্ট্রি হয়েছে।',NEW.created_by
 FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
 WHERE m.hostel_id=NEW.hostel_id AND m.status='active' AND NOT p.is_blocked
   AND m.user_id IS DISTINCT FROM NEW.created_by;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hl_ledger_notification_ins ON public.ledger_transactions;
CREATE TRIGGER hl_ledger_notification_ins AFTER INSERT ON public.ledger_transactions
FOR EACH ROW EXECUTE FUNCTION private.hl_notify_ledger_insert();
REVOKE ALL ON FUNCTION private.hl_notify_ledger_insert() FROM PUBLIC,anon,authenticated;

-- No automatic purge: this endpoint is a manual, irreversible operation.
-- Summary is preserved outside the period FK tree; deleted detail is NOT reconstructible from summary.
CREATE OR REPLACE FUNCTION public.platform_admin_delete_expired_archive(
 p_hostel_id uuid,p_period_id uuid,p_confirmation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_period public.monthly_periods%rowtype;
 v_detail int; v_summary int; v_expiry date; v_saved jsonb; v_name text; v_verified timestamptz;
 v_fk_count int;
BEGIN
 IF NOT private.is_super_admin() THEN RAISE EXCEPTION 'Super Admin only' USING ERRCODE='42501'; END IF;
 IF p_hostel_id IS NULL OR p_period_id IS NULL OR p_confirmation IS DISTINCT FROM 'DELETE '||p_period_id::text THEN
   RAISE EXCEPTION 'Type DELETE followed by exact period UUID to confirm' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_period FROM public.monthly_periods
  WHERE id=p_period_id AND hostel_id=p_hostel_id FOR UPDATE;
 IF NOT FOUND OR v_period.status NOT IN ('closed','archived') THEN
   RAISE EXCEPTION 'Closed/archived period not found' USING ERRCODE='22023'; END IF;
 SELECT detail_months,summary_months INTO v_detail,v_summary
 FROM public.platform_retention_policy WHERE singleton=true;
 IF v_detail IS NULL THEN RAISE EXCEPTION 'Retention policy unavailable' USING ERRCODE='55000'; END IF;
 v_expiry:=(v_period.end_date+make_interval(months=>v_detail+v_summary))::date;
 IF v_expiry >= (now() AT TIME ZONE 'Asia/Dhaka')::date THEN
   RAISE EXCEPTION 'Retention threshold not reached' USING ERRCODE='42501'; END IF;
 SELECT summary,verified_at INTO v_saved,v_verified FROM public.hl_archived_final_summaries
 WHERE period_id=p_period_id AND hostel_id=p_hostel_id AND purged_at IS NULL FOR UPDATE;
 IF v_verified IS NULL THEN RAISE EXCEPTION 'Summary has not been manually verified' USING ERRCODE='55000'; END IF;
 IF v_verified < now() - interval '24 hours' THEN
   RAISE EXCEPTION 'Summary verification is older than 24 hours; verify again' USING ERRCODE='55000';
 END IF;
 IF v_saved IS NULL OR v_saved->>'schema_version' IS DISTINCT FROM '2' OR
     NOT(v_saved ? 'member_totals' AND v_saved ? 'ledger_totals' AND v_saved ? 'meal_total') THEN
   RAISE EXCEPTION 'Final summary missing: capture and verify it before deletion' USING ERRCODE='55000'; END IF;
 -- Abort if any new/unknown FK points to monthly_periods: later schema changes require a review.
 SELECT count(*) INTO v_fk_count
 FROM pg_catalog.pg_constraint c
 WHERE c.contype='f' AND c.confrelid='public.monthly_periods'::regclass
   AND c.conrelid NOT IN (
      'public.archive_edit_permissions'::regclass,'public.archive_period_audit'::regclass,
      'public.daily_meal_days'::regclass,'public.daily_meal_records'::regclass,
      'public.daily_meal_snapshots'::regclass,'public.khala_money_entries'::regclass,
      'public.ledger_transactions'::regclass,'public.market_entries'::regclass,
      'public.meal_late_overrides'::regclass,'public.meal_requests'::regclass,
      'public.period_assistant_managers'::regclass,'public.hl_period_summary_snapshots'::regclass);
 IF v_fk_count<>0 THEN RAISE EXCEPTION 'Unknown dependent tables: deletion blocked' USING ERRCODE='55000'; END IF;

 -- If any dependent foreign key is RESTRICT/NO ACTION/SET NULL, refuse deletion rather than
 -- silently relying on CASCADE. This does not prove backups or summary correctness.
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
     WHERE c.contype='f' AND c.confrelid='public.monthly_periods'::regclass
       AND c.confdeltype <> 'c'
       AND c.conrelid <> 'public.hl_period_summary_snapshots'::regclass)
 THEN RAISE EXCEPTION 'A period foreign key is not CASCADE; deletion blocked for schema review' USING ERRCODE='55000'; END IF;

 -- Prevent restricted FK snapshot from blocking period deletion; durable final summary is separate.
 DELETE FROM public.hl_period_summary_snapshots WHERE period_id=p_period_id;
 SELECT name INTO v_name FROM public.hostels WHERE id=p_hostel_id;
 INSERT INTO public.platform_audit_log(actor_user_id,action,target_type,target_id,details)
 VALUES(auth.uid(),'archive_period_purged','monthly_periods',p_period_id::text,
 jsonb_build_object('hostel_id',p_hostel_id,'period_label',v_period.label,
 'end_date',v_period.end_date,'retention_expiry',v_expiry,'final_summary_preserved',true));
 UPDATE public.hl_archived_final_summaries SET purged_at=now() WHERE period_id=p_period_id;
 -- Notifications survive the removal because they reference hostel, not the period.
 INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by)
 SELECT m.hostel_id,m.user_id,'পুরোনো আর্কাইভ অপসারণ',
 'মেস '||coalesce(v_name,'')||' এর '||v_period.label||' মাসের বিস্তারিত তথ্য মুছে ফেলা হয়েছে; চূড়ান্ত সামারি সংরক্ষিত আছে।',auth.uid()
 FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
 WHERE m.hostel_id=p_hostel_id AND m.status='active' AND NOT p.is_blocked;
 -- All known period children ON DELETE CASCADE; protects against unrecognized foreign keys above.
 DELETE FROM public.monthly_periods WHERE id=p_period_id AND hostel_id=p_hostel_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Period was not deleted' USING ERRCODE='55000'; END IF;
 RETURN jsonb_build_object('deleted',true,'period_id',p_period_id,'summary_retained',true);
END $$;

-- Staging-friendly list of summaries preserved after source period deletion.
CREATE OR REPLACE FUNCTION public.platform_admin_list_saved_summaries()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb;
BEGIN
 IF NOT private.is_super_admin() THEN RAISE EXCEPTION 'Super Admin only' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('period_id',period_id,'hostel_id',hostel_id,
 'period_label',period_label,'end_date',end_date,'purged_at',purged_at)
 ORDER BY end_date DESC),'[]'::jsonb) INTO v
 FROM public.hl_archived_final_summaries;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.platform_admin_list_saved_summaries() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_saved_summaries() TO authenticated;


-- ============================================================================
-- Important hostel events: NEW MONTH and PRIMARY MANAGER CHANGE
-- AFTER trigger ensures no extra API roundtrip / no frontend notification spoofing.
-- Manager changes only notify once when actual primary_manager_membership_id changes.
-- ============================================================================
CREATE OR REPLACE FUNCTION private.hl_notify_period_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_title text; v_body text; v_actor uuid;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'running' THEN RETURN NEW; END IF;
    v_title := 'নতুন মাস শুরু হয়েছে';
    v_body := NEW.label || ' মাসের হিসাব শুরু হয়েছে।';
    v_actor := NEW.created_by;
  ELSE
    IF NEW.primary_manager_membership_id IS NOT DISTINCT FROM OLD.primary_manager_membership_id
       THEN RETURN NEW; END IF;
    v_title := 'মেসের ম্যানেজার পরিবর্তিত হয়েছে';
    v_body := NEW.label || ' মাসের প্রধান ম্যানেজার পরিবর্তন করা হয়েছে।';
    v_actor := auth.uid();
  END IF;
  INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by)
  SELECT m.hostel_id,m.user_id,v_title,v_body,v_actor
    FROM public.hostel_memberships m
    JOIN public.profiles p ON p.id=m.user_id
   WHERE m.hostel_id=NEW.hostel_id AND m.status='active' AND NOT p.is_blocked;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hl_period_lifecycle_notify ON public.monthly_periods;
CREATE TRIGGER hl_period_lifecycle_notify AFTER INSERT OR UPDATE OF primary_manager_membership_id
  ON public.monthly_periods FOR EACH ROW EXECUTE FUNCTION private.hl_notify_period_lifecycle();
REVOKE ALL ON FUNCTION private.hl_notify_period_lifecycle() FROM PUBLIC,anon,authenticated;

-- Validate/enable market notification without extra client activity logs.
UPDATE public.platform_notification_preferences SET market_activity_enabled=true WHERE singleton=true;


REVOKE ALL ON FUNCTION public.platform_admin_delete_expired_archive(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_delete_expired_archive(uuid,uuid,text) TO authenticated;
COMMIT;
