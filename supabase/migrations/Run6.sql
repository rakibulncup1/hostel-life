-- HOSTEL LIFE — MODULE B / Incremental production migration candidate
-- Base: previously applied Hostel_Life_Pro_Master_SQL_Audited.
-- Never rerun the former master file. No existing data are updated/deleted by this patch.
-- Safety: one transaction; fail closed on unexpected tables/columns.
BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '90s';

DO $preflight$
BEGIN
  IF to_regclass('public.monthly_periods') IS NULL
     OR to_regclass('public.meal_requests') IS NULL
     OR to_regclass('public.archive_edit_permissions') IS NULL THEN
    RAISE EXCEPTION 'Hostel Life required tables missing; migration not applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'private') THEN
    RAISE EXCEPTION 'private schema missing; migration not applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
        WHERE n.nspname='public' AND p.proname='start_new_month') THEN
    RAISE EXCEPTION 'Prior Hostel Life functions missing; migration not applied.';
  END IF;
END $preflight$;

-- Guard 1: a 'running' month must not be opened before its actual start.
-- Also defend against overlapping month date ranges for the SAME hostel.
-- Do not rewrite start_new_month(), which carries manager authorization and day setup.
CREATE OR REPLACE FUNCTION private.hl_b_guard_period_dates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
BEGIN
  IF NEW.status = 'running' AND NEW.start_date > v_today THEN
    RAISE EXCEPTION USING message='নতুন মাস তার শুরুর দিন আসার আগে চালু করা যাবে না।', errcode='22023';
  END IF;
  IF NEW.end_date < NEW.start_date THEN
    RAISE EXCEPTION USING message='মাসের শেষ তারিখ শুরুর আগে হতে পারে না।', errcode='22023';
  END IF;
  -- Reopen is allowed only for the latest period of this hostel; prevent
  -- reopening an older month after newer periods were already created.
  IF NEW.status = 'running' AND TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'running'
     AND EXISTS (SELECT 1 FROM public.monthly_periods p
                 WHERE p.hostel_id = NEW.hostel_id AND p.id <> NEW.id
                   AND p.start_date > NEW.start_date) THEN
    RAISE EXCEPTION USING message='পরবর্তী মাস তৈরি হয়েছে; পুরোনো মাস পুনরায় চালু করা যাবে না।', errcode='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.monthly_periods p
     WHERE p.hostel_id=NEW.hostel_id AND p.id IS DISTINCT FROM NEW.id
       AND p.start_date<=NEW.end_date AND p.end_date>=NEW.start_date
  ) THEN
    RAISE EXCEPTION USING message='অন্য মাসের তারিখের সঙ্গে এই মাসের তারিখ মিলে যাচ্ছে। আগে ম্যানেজারকে মাসের সীমা যাচাই করতে হবে।',errcode='23514';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS hl_b_guard_period_dates ON public.monthly_periods;
CREATE TRIGGER hl_b_guard_period_dates
  BEFORE INSERT OR UPDATE OF start_date,end_date,status ON public.monthly_periods
  FOR EACH ROW EXECUTE FUNCTION private.hl_b_guard_period_dates();
REVOKE ALL ON FUNCTION private.hl_b_guard_period_dates() FROM PUBLIC,anon,authenticated;

-- Guard 2: reject meal-request writes to a month that has not started, and
-- disallow a request from crossing its period's boundaries. This applies to
-- ordinary AND late requests, including direct calls bypassing the UI.
-- Existing historical requests are untouched; cancelled requests remain intact.
CREATE OR REPLACE FUNCTION private.hl_b_guard_meal_request_dates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_period public.monthly_periods%ROWTYPE;
        v_today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
BEGIN
  IF TG_OP='UPDATE' AND NEW.period_id IS NOT DISTINCT FROM OLD.period_id
       AND NEW.start_date IS NOT DISTINCT FROM OLD.start_date
       AND NEW.end_date IS NOT DISTINCT FROM OLD.end_date
       AND NEW.days IS NOT DISTINCT FROM OLD.days THEN
    RETURN NEW; -- review / cancellation does not get blocked by this guard
  END IF;
  SELECT * INTO v_period FROM public.monthly_periods WHERE id=NEW.period_id;
  IF NOT FOUND OR v_period.hostel_id IS DISTINCT FROM NEW.hostel_id THEN
    RAISE EXCEPTION USING message='মিলের মাস বা মেসের পরিচয় সঠিক নয়।',errcode='23514';
  END IF;
  IF v_period.status <> 'running' OR v_period.start_date > v_today THEN
    RAISE EXCEPTION USING message='এই মাসের মিল অনুরোধ এখনো চালু হয়নি।',errcode='55000';
  END IF;
  IF NEW.start_date < v_period.start_date OR NEW.end_date > v_period.end_date THEN
    RAISE EXCEPTION USING message='মিল অনুরোধের তারিখ এই মাসের সীমার বাইরে।',errcode='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.days) d
     WHERE (d->>'meal_date')::date < v_period.start_date
        OR (d->>'meal_date')::date > v_period.end_date
  ) THEN
    RAISE EXCEPTION USING message='মিলের দিনের তালিকায় এই মাসের বাইরের তারিখ আছে।',errcode='22023';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS hl_b_guard_meal_request_dates ON public.meal_requests;
CREATE TRIGGER hl_b_guard_meal_request_dates
  BEFORE INSERT OR UPDATE OF period_id,start_date,end_date,days ON public.meal_requests
  FOR EACH ROW EXECUTE FUNCTION private.hl_b_guard_meal_request_dates();
REVOKE ALL ON FUNCTION private.hl_b_guard_meal_request_dates() FROM PUBLIC,anon,authenticated;

-- Non-destructive, consistent archive listing for current hostel members.
-- This read-only RPC does not override legacy archive-management functions.
CREATE OR REPLACE FUNCTION public.hl_b_list_closed_months()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_hostel uuid; v_data jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  v_hostel := private.my_hostel_id();
  IF v_hostel IS NULL THEN
    RAISE EXCEPTION USING message='সক্রিয় মেস সদস্যপদ পাওয়া যায়নি।',errcode='42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',p.id,'period_id',p.id,'label',p.label,'start_date',p.start_date,
    'end_date',p.end_date,'status',p.status,
    'primary_manager_membership_id',p.primary_manager_membership_id,
    'closed_at',p.closed_at) ORDER BY p.start_date DESC),'[]'::jsonb)
  INTO v_data FROM public.monthly_periods p
  WHERE p.hostel_id=v_hostel AND p.status IN ('closed','archived');
  RETURN v_data;
END $fn$;
REVOKE ALL ON FUNCTION public.hl_b_list_closed_months() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hl_b_list_closed_months() TO authenticated;

-- A read-only second-layer diagnostic to help distinguish a real missing
-- archive from a frontend filtering issue; returns counts, no private records.
CREATE OR REPLACE FUNCTION public.hl_b_month_health()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_hostel uuid; v_today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
BEGIN
  PERFORM private.assert_signed_in();
  v_hostel := private.my_hostel_id();
  IF v_hostel IS NULL THEN RAISE EXCEPTION USING message='সক্রিয় সদস্যপদ নেই।',errcode='42501'; END IF;
  RETURN jsonb_build_object('today_dhaka',v_today,
    'running',(SELECT count(*) FROM public.monthly_periods WHERE hostel_id=v_hostel AND status='running'),
    'archived',(SELECT count(*) FROM public.monthly_periods WHERE hostel_id=v_hostel AND status IN ('closed','archived')),
    'future_running',(SELECT count(*) FROM public.monthly_periods WHERE hostel_id=v_hostel AND status='running' AND start_date>v_today));
END $fn$;
REVOKE ALL ON FUNCTION public.hl_b_month_health() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hl_b_month_health() TO authenticated;


-- EXTRA SAFE ADDITIONS / 2026-10-16
-- Each function below is additive. No mass updates, no account deletions.

-- Auto-disambiguate month labels created more than once in the same calendar
-- month. Preserve the existing label for the first period, unless it is null.
-- Change only on INSERT, never rewrite existing historical labels.
CREATE OR REPLACE FUNCTION private.hl_b_label_duplicate_month()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_number integer;
BEGIN
  SELECT count(*) + 1 INTO v_number
    FROM public.monthly_periods p
   WHERE p.hostel_id = NEW.hostel_id
     AND date_trunc('month', p.start_date::timestamp) = date_trunc('month', NEW.start_date::timestamp);
  IF v_number > 1 THEN
    NEW.label := to_char(NEW.start_date, 'Mon YYYY') || ' (Part ' || v_number::text || ')';
  ELSIF NEW.label IS NULL OR btrim(NEW.label) = '' THEN
    NEW.label := to_char(NEW.start_date, 'Mon YYYY');
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS hl_b_label_duplicate_month ON public.monthly_periods;
CREATE TRIGGER hl_b_label_duplicate_month
  BEFORE INSERT ON public.monthly_periods
  FOR EACH ROW EXECUTE FUNCTION private.hl_b_label_duplicate_month();
REVOKE ALL ON FUNCTION private.hl_b_label_duplicate_month() FROM PUBLIC,anon,authenticated;

-- Read-only members + profile images for the current hostel. Only names and
-- image URLs (plus member IDs) are shared; no emails, phone, or auth metadata.
-- Existing RLS may still control actual Storage access to the image URL.
CREATE OR REPLACE FUNCTION public.hl_b_member_public_profiles()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_hostel uuid; v_items jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  v_hostel := private.my_hostel_id();
  IF v_hostel IS NULL THEN
    RAISE EXCEPTION USING message='সক্রিয় মেস সদস্যপদ নেই।',errcode='42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
     'membership_id',m.id,'user_id',m.user_id,'full_name',p.full_name,
     'avatar_url',p.avatar_url,'role',m.role) ORDER BY p.full_name),'[]'::jsonb)
    INTO v_items
    FROM public.hostel_memberships m
    JOIN public.profiles p ON p.id=m.user_id
   WHERE m.hostel_id=v_hostel AND m.status='active' AND p.is_blocked=false;
  RETURN v_items;
END $fn$;
REVOKE ALL ON FUNCTION public.hl_b_member_public_profiles() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hl_b_member_public_profiles() TO authenticated;

-- Super Admin limited member directory: name, phone, email, picture and
-- minimal IDs for operations. Never exposes password, tokens, metadata.
-- Auth email is not exposed to normal members or hostel managers.
CREATE OR REPLACE FUNCTION public.hl_b_platform_member_directory(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_items jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING message='শুধু সুপার অ্যাডমিন এই তথ্য দেখতে পারবেন।',errcode='42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION USING message='পেজের সীমা সঠিক নয়।',errcode='22023';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id',q.id,'full_name',q.full_name,'phone',q.phone,
    'email',q.email,'avatar_url',q.avatar_url,'is_blocked',q.is_blocked,
    'created_at',q.created_at) ORDER BY q.created_at DESC),'[]'::jsonb)
  INTO v_items
  FROM (SELECT p.id,p.full_name,p.phone,a.email,p.avatar_url,p.is_blocked,p.created_at
       FROM public.profiles p LEFT JOIN auth.users a ON a.id=p.id
       ORDER BY p.created_at DESC,p.id LIMIT p_limit OFFSET p_offset) q;
  RETURN jsonb_build_object('items',v_items,'limit',p_limit,'offset',p_offset,
      'total',(SELECT count(*) FROM public.profiles));
END $fn$;
REVOKE ALL ON FUNCTION public.hl_b_platform_member_directory(integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hl_b_platform_member_directory(integer,integer) TO authenticated;

COMMIT;
