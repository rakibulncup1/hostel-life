-- Hostel Life: open-ended running periods + reliable meal-day creation
-- Run once in Supabase SQL Editor after taking a database backup.
-- The running row uses 9999-12-31 internally for backward compatibility.
-- UI/service normalization hides that sentinel; closing a period stores Dhaka's actual date.
BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '90s';

DO $preflight$
BEGIN
  IF to_regclass('public.monthly_periods') IS NULL
     OR to_regclass('public.daily_meal_days') IS NULL
     OR to_regclass('public.meal_requests') IS NULL THEN
    RAISE EXCEPTION 'Required Hostel Life tables are missing; no changes applied.';
  END IF;
  IF to_regprocedure('private.my_hostel_id()') IS NULL
     OR to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.ensure_period_days(uuid)') IS NULL
     OR to_regprocedure('private.assert_meal_days(jsonb,uuid,boolean)') IS NULL
     OR to_regprocedure('private.is_valid_meal(numeric)') IS NULL THEN
    RAISE EXCEPTION 'Expected Hostel Life helper functions are missing; no changes applied.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.monthly_periods
    WHERE status = 'running'
    GROUP BY hostel_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'At least one hostel has more than one running period. Resolve that data issue first; no changes applied.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.monthly_periods r
    JOIN public.monthly_periods p ON p.hostel_id = r.hostel_id AND p.id <> r.id
    WHERE r.status = 'running'
      AND p.status IN ('closed','archived')
      AND p.start_date > r.start_date
  ) THEN
    RAISE EXCEPTION 'A closed/archived period starts after a running period. Review the period history before applying this patch; no changes applied.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.monthly_periods
    WHERE status IN ('closed','archived') AND end_date >= DATE '9999-01-01'
  ) THEN
    RAISE EXCEPTION 'A closed/archived period already has a far-future end date. Review that record manually; no changes applied.';
  END IF;
END
$preflight$;

-- Keep the legacy date column non-null, but remove any fixed month-end from running rows.
-- On the transition away from running, record the actual Dhaka date as the final day.
CREATE OR REPLACE FUNCTION private.hl_b_guard_period_dates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
BEGIN
  IF NEW.status = 'running' THEN
    NEW.end_date := DATE '9999-12-31';
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'running' AND NEW.status IN ('closed','archived') THEN
    NEW.end_date := v_today;
  END IF;

  -- A pre-existing future-start running row can occur in older data. Permit
  -- this migration's end_date-only normalization for that unchanged row, but
  -- reject INSERTs and any attempt to newly activate/change the future start.
  -- The comparison deliberately ignores end_date because this function has
  -- already normalized it to the open-ended sentinel above.
  IF NEW.status = 'running' AND NEW.start_date > v_today THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION USING message='নতুন মাস শুরুর তারিখ আসার আগে সেটি চালু করা যাবে না।', errcode='22023';
    ELSIF OLD.status IS DISTINCT FROM 'running'
       OR OLD.start_date IS DISTINCT FROM NEW.start_date
       OR (to_jsonb(OLD) - 'end_date') IS DISTINCT FROM (to_jsonb(NEW) - 'end_date') THEN
      RAISE EXCEPTION USING message='নতুন মাস শুরুর তারিখ আসার আগে সেটি চালু করা যাবে না।', errcode='22023';
    END IF;
  END IF;
  IF NEW.end_date IS NULL OR NEW.end_date < NEW.start_date THEN
    RAISE EXCEPTION USING message='মাসের শেষ তারিখ শুরুর তারিখের আগে হতে পারে না।', errcode='22023';
  END IF;

  IF NEW.status = 'running' AND TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'running'
     AND EXISTS (
       SELECT 1 FROM public.monthly_periods p
       WHERE p.hostel_id = NEW.hostel_id AND p.id <> NEW.id AND p.start_date > NEW.start_date
     ) THEN
    RAISE EXCEPTION USING message='পরবর্তী মাস তৈরি হয়েছে; পুরোনো মাস পুনরায় চালু করা যাবে না।', errcode='23514';
  END IF;

  IF NEW.status = 'running' THEN
    IF EXISTS (
      SELECT 1 FROM public.monthly_periods p
      WHERE p.hostel_id = NEW.hostel_id AND p.id IS DISTINCT FROM NEW.id
        AND (p.status = 'running' OR p.start_date > NEW.start_date OR p.end_date >= NEW.start_date)
    ) THEN
      RAISE EXCEPTION USING message='অন্য মাসের ইতিহাসের সঙ্গে এই মাসের শুরুর তারিখ মিলে যাচ্ছে। আগে ম্যানেজারকে মাসের ইতিহাস যাচাই করতে হবে।', errcode='23514';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.monthly_periods p
      WHERE p.hostel_id = NEW.hostel_id AND p.id IS DISTINCT FROM NEW.id
        AND p.start_date <= NEW.end_date AND p.end_date >= NEW.start_date
    ) THEN
      RAISE EXCEPTION USING message='অন্য মাসের তারিখের সঙ্গে এই মাসের তারিখ মিলে যাচ্ছে। আগে ম্যানেজারকে মাসের ইতিহাস যাচাই করতে হবে।', errcode='23514';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS hl_b_guard_period_dates ON public.monthly_periods;
CREATE TRIGGER hl_b_guard_period_dates
  BEFORE INSERT OR UPDATE ON public.monthly_periods
  FOR EACH ROW EXECUTE FUNCTION private.hl_b_guard_period_dates();
REVOKE ALL ON FUNCTION private.hl_b_guard_period_dates() FROM PUBLIC, anon, authenticated;


-- Preserve the existing Part 2 label behavior when a period starts twice in one calendar month.
-- Only new periods are labeled; historical labels are never rewritten.
CREATE OR REPLACE FUNCTION private.hl_b_label_duplicate_month()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_number integer;
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
END
$fn$;
DROP TRIGGER IF EXISTS hl_b_label_duplicate_month ON public.monthly_periods;
CREATE TRIGGER hl_b_label_duplicate_month
  BEFORE INSERT ON public.monthly_periods
  FOR EACH ROW EXECUTE FUNCTION private.hl_b_label_duplicate_month();
REVOKE ALL ON FUNCTION private.hl_b_label_duplicate_month() FROM PUBLIC, anon, authenticated;

-- Server-side guard: active meal requests can span any dates after the period start,
-- but may never be written to a closed/future period or before its start date.
CREATE OR REPLACE FUNCTION private.hl_b_guard_meal_request_dates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_period public.monthly_periods%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.period_id IS NOT DISTINCT FROM OLD.period_id
     AND NEW.start_date IS NOT DISTINCT FROM OLD.start_date
     AND NEW.end_date IS NOT DISTINCT FROM OLD.end_date
     AND NEW.days IS NOT DISTINCT FROM OLD.days THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_period FROM public.monthly_periods WHERE id = NEW.period_id;
  IF NOT FOUND OR v_period.hostel_id IS DISTINCT FROM NEW.hostel_id THEN
    RAISE EXCEPTION USING message='মিলের মাস বা মেসের পরিচয় সঠিক নয়।', errcode='23514';
  END IF;
  IF v_period.status <> 'running' OR v_period.start_date > v_today THEN
    RAISE EXCEPTION USING message='এই মাসের মিল অনুরোধ এখনো চালু হয়নি।', errcode='55000';
  END IF;
  IF NEW.start_date < v_period.start_date OR NEW.end_date > v_period.end_date THEN
    RAISE EXCEPTION USING message='মিল অনুরোধের তারিখ এই মাসের সীমার বাইরে।', errcode='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.days) d
    WHERE (d->>'meal_date')::date < v_period.start_date
       OR (d->>'meal_date')::date > v_period.end_date
  ) THEN
    RAISE EXCEPTION USING message='মিলের দিনের তালিকায় এই মাসের শুরুর আগের তারিখ আছে।', errcode='22023';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS hl_b_guard_meal_request_dates ON public.meal_requests;
CREATE TRIGGER hl_b_guard_meal_request_dates
  BEFORE INSERT OR UPDATE ON public.meal_requests
  FOR EACH ROW EXECUTE FUNCTION private.hl_b_guard_meal_request_dates();
REVOKE ALL ON FUNCTION private.hl_b_guard_meal_request_dates() FROM PUBLIC, anon, authenticated;

-- Fill only real dates through today for a running period; never loop to the sentinel.
-- Future request dates are created on demand by assert_meal_days below.
CREATE OR REPLACE FUNCTION private.ensure_period_days(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_period public.monthly_periods%ROWTYPE;
  v_day date;
  v_stop date;
  v_today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
BEGIN
  SELECT * INTO v_period FROM public.monthly_periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING message='মাসের তথ্য পাওয়া যায়নি।', errcode='P0002';
  END IF;

  v_day := v_period.start_date;
  v_stop := CASE WHEN v_period.status = 'running' THEN v_today ELSE v_period.end_date END;
  IF v_stop < v_day THEN RETURN; END IF;

  WHILE v_day <= v_stop LOOP
    INSERT INTO public.daily_meal_days(hostel_id, period_id, meal_date, cutoff_at, finalizes_at)
    VALUES (
      v_period.hostel_id,
      v_period.id,
      v_day,
      (v_day::timestamp + TIME '21:00') AT TIME ZONE 'Asia/Dhaka',
      (v_day::timestamp + TIME '21:00') AT TIME ZONE 'Asia/Dhaka'
    )
    ON CONFLICT (period_id, meal_date) DO NOTHING;
    v_day := v_day + 1;
  END LOOP;
END
$fn$;
REVOKE ALL ON FUNCTION private.ensure_period_days(uuid) FROM PUBLIC, anon, authenticated;

-- If an old running period missed daily rows because its fixed end date expired,
-- recreate missing dates. Past normal requests are still rejected by cutoff checks;
-- late/correction request flows keep their existing explicit permission path.
CREATE OR REPLACE FUNCTION private.assert_meal_days(
  p_days jsonb,
  p_period_id uuid,
  p_allow_cutoff boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_item jsonb;
  v_date date;
  v_period public.monthly_periods%ROWTYPE;
  v_day public.daily_meal_days%ROWTYPE;
BEGIN
  IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array' OR jsonb_array_length(p_days) = 0 THEN
    RAISE EXCEPTION USING message='অন্তত একটি দিনের মিলের তথ্য দিন।', errcode='22023';
  END IF;
  IF jsonb_array_length(p_days) > 62 THEN
    RAISE EXCEPTION USING message='একবারে সর্বোচ্চ ৬২ দিনের মিল দেওয়া যাবে।', errcode='22023';
  END IF;

  SELECT * INTO v_period FROM public.monthly_periods WHERE id = p_period_id;
  IF NOT FOUND OR v_period.status <> 'running' THEN
    RAISE EXCEPTION USING message='বর্তমান মাসটি চালু নেই।', errcode='55000';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_days) LOOP
    BEGIN
      v_date := (v_item->>'meal_date')::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION USING message='মিলের তারিখ সঠিক নয়।', errcode='22007';
    END;

    IF v_date < v_period.start_date OR v_date > v_period.end_date THEN
      RAISE EXCEPTION USING message='তারিখটি চলমান মাসের শুরুর আগের সীমার বাইরে।', errcode='22023';
    END IF;
    IF NOT private.is_valid_meal(COALESCE((v_item->>'breakfast')::numeric, 0))
       OR NOT private.is_valid_meal(COALESCE((v_item->>'lunch')::numeric, 0))
       OR NOT private.is_valid_meal(COALESCE((v_item->>'dinner')::numeric, 0)) THEN
      RAISE EXCEPTION USING message='মিলের পরিমাণ ০ থেকে ৫০-এর মধ্যে এবং ০.৫ ধাপে হতে হবে।', errcode='22023';
    END IF;

    SELECT * INTO v_day
    FROM public.daily_meal_days
    WHERE period_id = p_period_id AND meal_date = v_date;
    IF NOT FOUND THEN
      INSERT INTO public.daily_meal_days(hostel_id, period_id, meal_date, cutoff_at, finalizes_at)
      VALUES (
        v_period.hostel_id,
        v_period.id,
        v_date,
        (v_date::timestamp + TIME '21:00') AT TIME ZONE 'Asia/Dhaka',
        (v_date::timestamp + TIME '21:00') AT TIME ZONE 'Asia/Dhaka'
      )
      ON CONFLICT (period_id, meal_date) DO NOTHING;
      SELECT * INTO v_day
      FROM public.daily_meal_days
      WHERE period_id = p_period_id AND meal_date = v_date;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING message='এই তারিখের মিল-দিন প্রস্তুত করা যায়নি। আবার চেষ্টা করুন।', errcode='P0002';
    END IF;

    IF NOT p_allow_cutoff
       AND (v_day.status = 'finalized' OR (v_day.cutoff_at IS NOT NULL AND v_day.cutoff_at <= now())) THEN
      RAISE EXCEPTION USING message='এই তারিখের মিল দেওয়ার সময় শেষ হয়েছে। সংশোধনের অনুরোধ ব্যবহার করুন।', errcode='55000';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT (value->>'meal_date')::date
    FROM jsonb_array_elements(p_days)
    GROUP BY (value->>'meal_date')::date HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING message='একই তারিখ একাধিকবার দেওয়া হয়েছে।', errcode='22023';
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION private.assert_meal_days(jsonb, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- The old date-setting RPC must not cancel requests and then pretend to set a fixed end date.
CREATE OR REPLACE FUNCTION public.manager_set_running_period_end_date(
  p_new_end_date date,
  p_confirm_future_cancel boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM private.assert_signed_in();
  RAISE EXCEPTION USING message='চলমান মাসের নির্দিষ্ট শেষ তারিখ নেই। মাস শেষ হলে “বর্তমান মাস শেষ করুন” ব্যবহার করুন।', errcode='22023';
END
$fn$;
REVOKE ALL ON FUNCTION public.manager_set_running_period_end_date(date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_set_running_period_end_date(date, boolean) TO authenticated;

-- Called by the frontend before dashboard/report refresh, scoped to the current user's hostel.
CREATE OR REPLACE FUNCTION public.hl_ensure_running_period_days()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_hostel uuid;
  v_period public.monthly_periods%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
BEGIN
  PERFORM private.assert_signed_in();
  v_hostel := private.my_hostel_id();
  IF v_hostel IS NULL THEN
    RETURN jsonb_build_object('has_running_period', false, 'today', v_today);
  END IF;
  SELECT * INTO v_period
  FROM public.monthly_periods
  WHERE hostel_id = v_hostel AND status = 'running'
  ORDER BY start_date DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('has_running_period', false, 'today', v_today);
  END IF;
  PERFORM private.ensure_period_days(v_period.id);
  RETURN jsonb_build_object(
    'has_running_period', true,
    'period_id', v_period.id,
    'start_date', v_period.start_date,
    'backfilled_through', v_today
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.hl_ensure_running_period_days() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hl_ensure_running_period_days() TO authenticated;

-- Normalize current active rows. Trigger logic enforces the same value transactionally.
UPDATE public.monthly_periods
SET end_date = DATE '9999-12-31'
WHERE status = 'running' AND end_date IS DISTINCT FROM DATE '9999-12-31';

-- Repair missed day rows now, so requests and today's meal card can work immediately.
DO $backfill$
DECLARE v_period_id uuid;
BEGIN
  FOR v_period_id IN SELECT id FROM public.monthly_periods WHERE status = 'running' LOOP
    PERFORM private.ensure_period_days(v_period_id);
  END LOOP;
END
$backfill$;

COMMIT;
