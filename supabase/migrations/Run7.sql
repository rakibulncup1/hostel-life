-- HOSTEL LIFE: POST MODULE-B TARGETED INCREMENTAL MIGRATION
-- Only for a database where PRO MASTER AUDITED and MODULE B CONSOLIDATED ran successfully.
-- Do NOT rerun old master scripts. Backup before applying. Do not run if prerequisites differ.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $check$
BEGIN
 IF to_regprocedure('public.get_top_shoppers()') IS NULL
    OR to_regprocedure('public.get_khala_money_history_v2(uuid,integer)') IS NULL
    OR to_regprocedure('public.hl_b_list_closed_months()') IS NULL
    OR to_regprocedure('private.hl_notify_important_event()') IS NULL
    OR to_regprocedure('private.hl_notify_period_lifecycle()') IS NULL
    OR to_regclass('public.khala_money_entries') IS NULL
    OR to_regclass('public.notifications') IS NULL
    OR to_regclass('public.market_entries') IS NULL THEN
    RAISE EXCEPTION 'Expected existing Pro Master + Module B objects missing. No changes applied.';
 END IF;
END $check$;

-- 1. Shoppers ranking: remove illegal outer ORDER BY in aggregate SELECT.
-- Return contract intentionally identical to existing rankingService.js.
CREATE OR REPLACE FUNCTION public.get_top_shoppers()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_hostel uuid:=private.my_hostel_id(); v_period uuid; v_result jsonb;
BEGIN
 PERFORM private.assert_signed_in();
 SELECT id INTO v_period FROM public.monthly_periods WHERE hostel_id=v_hostel AND status='running' LIMIT 1;
 IF v_period IS NULL THEN RETURN '[]'::jsonb; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'membership_id',s.id,'member_id',s.id,'member_name',s.full_name,
  'full_name',s.full_name,'total_market',s.total_market,'amount',s.total_market,
  'rank',s.rn) ORDER BY s.total_market DESC,s.full_name),'[]'::jsonb)
 INTO v_result FROM (
  SELECT m.id,p.full_name, SUM(me.total_amount) total_market,
   ROW_NUMBER() OVER (ORDER BY SUM(me.total_amount) DESC,p.full_name) rn
  FROM public.market_entries me
  JOIN public.hostel_memberships m ON m.id=me.buyer_membership_id
  JOIN public.profiles p ON p.id=m.user_id
  WHERE me.period_id=v_period AND me.hostel_id=v_hostel AND me.status='active'
   AND me.buyer_membership_id IS NOT NULL AND NOT p.is_blocked
  GROUP BY m.id,p.full_name
  ORDER BY total_market DESC,p.full_name LIMIT 10
 ) s;
 RETURN v_result;
END $fn$;
REVOKE ALL ON FUNCTION public.get_top_shoppers() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_top_shoppers() TO authenticated;

-- 2. Khala author attribution: existing created_by column, no extra writes.
-- Keep the original response fields; add created_by_name for UI integration.
CREATE OR REPLACE FUNCTION public.get_khala_money_history_v2(p_period_id uuid DEFAULT NULL,p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_hostel uuid:=private.my_hostel_id(); v_period uuid:=p_period_id; v_result jsonb;
BEGIN
 PERFORM private.assert_signed_in();
 IF v_hostel IS NULL OR NOT private.can_access_hostel(v_hostel) THEN
  RAISE EXCEPTION USING message='এই হিসাব দেখার অনুমতি নেই।',errcode='42501'; END IF;
 IF v_period IS NULL THEN
  SELECT id INTO v_period FROM public.monthly_periods WHERE hostel_id=v_hostel AND status='running' LIMIT 1;
 END IF;
 IF v_period IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.monthly_periods WHERE id=v_period AND hostel_id=v_hostel
 ) THEN RAISE EXCEPTION USING message='এই মাসের খালার টাকার তথ্য দেখার অনুমতি নেই।',errcode='42501'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'entry_id',k.id,'id',k.id,'hostel_id',k.hostel_id,'period_id',k.period_id,
  'member_id',NULL,'member_name','খালার পারিশ্রমিক',
  'amount',k.amount,'entry_date',k.payment_date,'payment_date',k.payment_date,
  'description',k.description,'status',k.status,'void_reason',k.void_reason,
  'created_at',k.created_at,'updated_at',k.updated_at,
  'created_by',k.created_by,'created_by_name',COALESCE(NULLIF(btrim(p.full_name),''),'নাম পাওয়া যায়নি')
 ) ORDER BY k.payment_date DESC,k.created_at DESC),'[]'::jsonb)
 INTO v_result
 FROM (SELECT * FROM public.khala_money_entries
       WHERE hostel_id=v_hostel AND (v_period IS NULL OR period_id=v_period)
       ORDER BY payment_date DESC,created_at DESC
       LIMIT greatest(1,least(coalesce(p_limit,200),3000))) k
 LEFT JOIN public.profiles p ON p.id=k.created_by;
 RETURN v_result;
END $fn$;
REVOKE ALL ON FUNCTION public.get_khala_money_history_v2(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_khala_money_history_v2(uuid,integer) TO authenticated;
-- get_khala_money_history(uuid,integer) already delegates to v2: leave untouched.

-- 3. Single-call bulk delete for only the requesting user's own notifications.
-- This is soft deletion consistent with existing get_notifications, and avoids
-- accidentally touching other members' notification rows.
CREATE OR REPLACE FUNCTION public.delete_all_my_notifications()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_count bigint;
BEGIN
 PERFORM private.assert_signed_in();
 UPDATE public.notifications SET deleted_at=now()
 WHERE recipient_user_id=auth.uid() AND deleted_at IS NULL;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN jsonb_build_object('status','success','deleted_count',v_count);
END $fn$;
REVOKE ALL ON FUNCTION public.delete_all_my_notifications() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_all_my_notifications() TO authenticated;

-- 4. Privacy: ordinary members should not receive other members' avatar URLs
-- from the Module B convenience RPC. Keep IDs/names for existing clients.
-- Super Admin may still use hl_b_platform_member_directory().
CREATE OR REPLACE FUNCTION public.hl_b_member_public_profiles()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_hostel uuid; v_items jsonb;
BEGIN
 PERFORM private.assert_signed_in();
 v_hostel:=private.my_hostel_id();
 IF v_hostel IS NULL OR NOT private.can_access_hostel(v_hostel) THEN
  RAISE EXCEPTION USING message='এই সদস্য তালিকা দেখার অনুমতি নেই।',errcode='42501';
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'membership_id',m.id,'user_id',m.user_id,'full_name',p.full_name,
  'avatar_url',CASE WHEN m.user_id=auth.uid() OR private.is_super_admin()
                    THEN p.avatar_url ELSE NULL END,'role',m.role)
  ORDER BY p.full_name),'[]'::jsonb) INTO v_items
 FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
 WHERE m.hostel_id=v_hostel AND m.status='active' AND NOT p.is_blocked;
 RETURN v_items;
END $fn$;
REVOKE ALL ON FUNCTION public.hl_b_member_public_profiles() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hl_b_member_public_profiles() TO authenticated;

-- 5. CLOSED/ARCHIVED months: avoid duplicate tables, no changes to past periods.
-- The Module B hl_b_list_closed_months() already correctly lists closed months.
-- This new diagnostic allows frontend troubleshooting when Manager Archive is blank.
CREATE OR REPLACE FUNCTION public.hl_archive_visibility_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_h uuid:=private.my_hostel_id();
BEGIN
 PERFORM private.assert_signed_in();
 IF v_h IS NULL OR NOT private.can_access_hostel(v_h) THEN
  RAISE EXCEPTION USING message='মেসে প্রবেশের অনুমতি নেই।',errcode='42501'; END IF;
 RETURN jsonb_build_object('closed_or_archived',
    (SELECT count(*) FROM public.monthly_periods WHERE hostel_id=v_h AND status IN ('closed','archived')),
    'running',(SELECT count(*) FROM public.monthly_periods WHERE hostel_id=v_h AND status='running'));
END $fn$;
REVOKE ALL ON FUNCTION public.hl_archive_visibility_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hl_archive_visibility_status() TO authenticated;


-- 6. Add the affected person's name to existing event notifications.
-- Replace only the two pre-existing trigger functions; keep trigger objects,
-- recipient filters, and existing events unchanged to avoid duplicate alerts.
CREATE OR REPLACE FUNCTION private.hl_notify_important_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_h uuid; v_title text; v_body text; v_actor uuid; v_person text;
BEGIN
 IF TG_TABLE_NAME='meal_requests' THEN
  IF TG_OP<>'UPDATE' OR NEW.status IS NOT DISTINCT FROM OLD.status
      OR NEW.status NOT IN ('approved','rejected') THEN RETURN NEW; END IF;
  v_h:=NEW.hostel_id; v_actor:=NEW.reviewed_by;
  v_title:=CASE WHEN NEW.status='approved' THEN 'মিল অনুরোধ অনুমোদিত' ELSE 'মিল অনুরোধ বাতিল' END;
  SELECT COALESCE(NULLIF(btrim(p.full_name),''),'একজন সদস্য') INTO v_person
    FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
   WHERE m.id=NEW.membership_id AND m.hostel_id=v_h;
  v_body:=COALESCE(v_person,'একজন সদস্য') || ' এর মিল অনুরোধের অবস্থা পরিবর্তিত হয়েছে।';
  INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by)
  SELECT v_h,m.user_id,v_title,v_body,v_actor
  FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
  WHERE m.id=NEW.membership_id AND NOT p.is_blocked;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='hostel_memberships' THEN
  IF TG_OP<>'INSERT' AND NEW.status IS NOT DISTINCT FROM OLD.status
      AND NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
  v_h:=NEW.hostel_id;v_actor:=auth.uid();
  SELECT COALESCE(NULLIF(btrim(full_name),''),'একজন সদস্য') INTO v_person
     FROM public.profiles WHERE id=NEW.user_id;
  v_title:=CASE WHEN TG_OP='INSERT' THEN 'নতুন সদস্য যুক্ত হয়েছে'
    WHEN NEW.status='active' THEN 'সদস্য সক্রিয় হয়েছে'
    WHEN TG_OP='UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN 'সদস্যের ভূমিকা পরিবর্তিত হয়েছে'
    ELSE 'সদস্যের অবস্থা পরিবর্তিত হয়েছে' END;
  v_body:=COALESCE(v_person,'একজন সদস্য') || ' — সদস্য তালিকায় পরিবর্তন হয়েছে।';
  INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by)
  SELECT DISTINCT m.hostel_id,m.user_id,v_title,v_body,v_actor
  FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
  WHERE m.hostel_id=v_h AND m.status='active' AND NOT p.is_blocked
    AND m.user_id IS DISTINCT FROM v_actor;
  RETURN NEW;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.hl_notify_important_event() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.hl_notify_period_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_title text; v_body text; v_actor uuid; v_manager_name text;
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.status IS DISTINCT FROM 'running' THEN RETURN NEW; END IF;
   v_title:='নতুন মাস শুরু হয়েছে';
   v_body:=NEW.label || ' মাসের হিসাব শুরু হয়েছে।';
   v_actor:=NEW.created_by;
 ELSE
   IF NEW.primary_manager_membership_id IS NOT DISTINCT FROM OLD.primary_manager_membership_id
     THEN RETURN NEW; END IF;
   v_title:='মেসের ম্যানেজার পরিবর্তিত হয়েছে';
   SELECT p.full_name INTO v_manager_name FROM public.hostel_memberships m
     JOIN public.profiles p ON p.id=m.user_id
     WHERE m.id=NEW.primary_manager_membership_id AND m.hostel_id=NEW.hostel_id;
   v_body:=NEW.label || ' মাসের নতুন প্রধান ম্যানেজার: ' ||
      COALESCE(NULLIF(btrim(v_manager_name),''),'নাম পাওয়া যায়নি');
   v_actor:=auth.uid();
 END IF;
 INSERT INTO public.notifications(hostel_id,recipient_user_id,title,body,created_by)
 SELECT m.hostel_id,m.user_id,v_title,v_body,v_actor
 FROM public.hostel_memberships m JOIN public.profiles p ON p.id=m.user_id
 WHERE m.hostel_id=NEW.hostel_id AND m.status='active' AND NOT p.is_blocked;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.hl_notify_period_lifecycle() FROM PUBLIC,anon,authenticated;


-- 7. Archive-management response contract compatible with ManagerPages.jsx.
-- Only read closed/archived periods. No automatic reopen or permission changes.
-- Closing manager is derived from closed_by; do not guess a person if absent.
CREATE OR REPLACE FUNCTION public.get_archive_management_items()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_h uuid:=private.my_hostel_id(); v_result jsonb;
BEGIN
 PERFORM private.assert_signed_in();
 PERFORM private.assert_hostel_manager(v_h,NULL,true,false);
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'period_id',q.id,'id',q.id,'label',q.label,'start_date',q.start_date,
  'end_date',q.end_date,'status',q.status,
  'primary_manager_membership_id',q.primary_manager_membership_id,
  'manager_at_close_membership_id',q.closer_id,
  'manager_at_close_name',q.closer_name,
  'closer_is_active',q.closer_active,
  'current_manager_is_closer',q.closed_by=auth.uid(),
  'can_grant_closer_edit',q.closer_id IS NOT NULL AND q.closer_active
         AND q.closed_by IS DISTINCT FROM auth.uid(),
  'can_reopen',q.is_latest AND q.end_date >= (now() AT TIME ZONE 'Asia/Dhaka')::date
         AND date_trunc('month',q.start_date::timestamp)=
             date_trunc('month',(now() AT TIME ZONE 'Asia/Dhaka')::timestamp),
  'archive_read_only',false,
  'permission_count',q.permission_count
 ) ORDER BY q.start_date DESC),'[]'::jsonb) INTO v_result
 FROM (
  SELECT mp.*,
   closer.id AS closer_id,profile.full_name AS closer_name,
   COALESCE(closer.status='active',false) AS closer_active,
   (NOT EXISTS(SELECT 1 FROM public.monthly_periods later
    WHERE later.hostel_id=mp.hostel_id AND later.id<>mp.id
      AND later.start_date>mp.start_date)) AS is_latest,
   (SELECT count(*) FROM public.archive_edit_permissions a
      WHERE a.period_id=mp.id AND a.revoked_at IS NULL
        AND (a.expires_at IS NULL OR a.expires_at>now())) AS permission_count
  FROM public.monthly_periods mp
  LEFT JOIN public.hostel_memberships closer ON closer.hostel_id=mp.hostel_id
    AND closer.user_id=mp.closed_by
  LEFT JOIN public.profiles profile ON profile.id=closer.user_id
  WHERE mp.hostel_id=v_h AND mp.status IN ('closed','archived')
 ) q;
 RETURN v_result;
END $fn$;
REVOKE ALL ON FUNCTION public.get_archive_management_items() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_archive_management_items() TO authenticated;

COMMIT;
