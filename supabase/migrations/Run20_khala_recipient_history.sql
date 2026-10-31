-- Hostel Life — Run20: show and preserve the selected Khala recipient name.
-- Prerequisite: Run16 (selected member_id preservation) and Run10 (Khala history RPC).
-- Safety: does not update/delete existing business rows and does not replace the
-- manager_add_khala_money_for_period accounting/validation RPC.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF to_regclass('public.khala_money_entries') IS NULL
     OR to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.monthly_periods') IS NULL THEN
    RAISE EXCEPTION 'Khala recipient history-এর প্রয়োজনীয় টেবিল পাওয়া যায়নি; কোনো পরিবর্তন করা হয়নি।';
  END IF;

  IF EXISTS (
    SELECT required.table_name, required.column_name
    FROM (VALUES
      ('khala_money_entries','id'),
      ('khala_money_entries','hostel_id'),
      ('khala_money_entries','period_id'),
      ('khala_money_entries','member_id'),
      ('khala_money_entries','member_name_snapshot'),
      ('khala_money_entries','payment_date'),
      ('khala_money_entries','amount'),
      ('khala_money_entries','description'),
      ('khala_money_entries','status'),
      ('khala_money_entries','void_reason'),
      ('khala_money_entries','created_by'),
      ('khala_money_entries','created_at'),
      ('khala_money_entries','updated_at'),
      ('hostel_memberships','id'),
      ('hostel_memberships','hostel_id'),
      ('hostel_memberships','user_id'),
      ('profiles','id'),
      ('profiles','full_name'),
      ('monthly_periods','id'),
      ('monthly_periods','hostel_id'),
      ('monthly_periods','status'),
      ('monthly_periods','start_date')
    ) AS required(table_name,column_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns actual
      WHERE actual.table_schema='public'
        AND actual.table_name=required.table_name
        AND actual.column_name=required.column_name
    )
  ) THEN
    RAISE EXCEPTION 'Khala recipient/name snapshot schema প্রত্যাশিত অবস্থায় নেই; কোনো পরিবর্তন করা হয়নি।';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='khala_money_entries'
      AND column_name='member_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='khala_money_entries'
      AND column_name='member_name_snapshot' AND data_type='text'
  ) THEN
    RAISE EXCEPTION 'Khala member_id/member_name_snapshot-এর data type অপ্রত্যাশিত; কোনো পরিবর্তন করা হয়নি।';
  END IF;

  IF to_regprocedure('private.my_hostel_id()') IS NULL
     OR to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.can_access_hostel(uuid)') IS NULL
     OR to_regprocedure('private.hl_preserve_khala_recipient()') IS NULL
     OR to_regprocedure('public.get_khala_money_history_v2(uuid,integer)') IS NULL
     OR to_regprocedure('public.get_khala_money_history(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'Run10/Run16-এর প্রয়োজনীয় RPC বা helper পাওয়া যায়নি; কোনো পরিবর্তন করা হয়নি।';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.khala_money_entries'::regclass
      AND t.tgname = 'hl_preserve_khala_recipient_on_insert'
      AND t.tgfoid = 'private.hl_preserve_khala_recipient()'::regprocedure
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'Run16-এর active recipient-preservation trigger সঠিকভাবে পাওয়া যায়নি; কোনো পরিবর্তন করা হয়নি।';
  END IF;
END
$preflight$;

-- 1) Keep the chosen recipient's name as an immutable snapshot for new entries.
--    Run16 already supplies member_id through a transaction-local setting; this
--    extends that same trigger to snapshot the selected member's current name.
CREATE OR REPLACE FUNCTION private.hl_preserve_khala_recipient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $trigger$
DECLARE
  v_member_id uuid;
  v_context text;
  v_member_name text;
BEGIN
  v_context := NULLIF(current_setting('hl.khala_recipient_member_id', true), '');
  IF v_context IS NULL THEN
    RETURN NEW;
  END IF;

  v_member_id := v_context::uuid;

  IF NEW.member_id IS NOT NULL AND NEW.member_id IS DISTINCT FROM v_member_id THEN
    RAISE EXCEPTION USING
      message = 'খালার টাকার প্রাপক সদস্যের তথ্য মিলছে না.',
      errcode = '22023';
  END IF;

  SELECT NULLIF(btrim(p.full_name), '')
    INTO v_member_name
  FROM public.hostel_memberships m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.id = v_member_id
    AND m.hostel_id = NEW.hostel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      message = 'নির্বাচিত সদস্য এই মেসের নয়.',
      errcode = '22023';
  END IF;

  NEW.member_id := v_member_id;
  IF v_member_name IS NOT NULL THEN
    NEW.member_name_snapshot := v_member_name;
  END IF;

  RETURN NEW;
END
$trigger$;

-- 2) Return the actual recipient name to both frontend history screens.
--    Prefer the stored snapshot, then the linked profile for older Run16 rows
--    whose snapshot still contains the generic label, then a clear placeholder.
CREATE OR REPLACE FUNCTION public.get_khala_money_history_v2(
  p_period_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_period uuid := p_period_id;
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();

  IF v_hostel IS NULL OR private.can_access_hostel(v_hostel) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      message = 'এই হিসাব দেখার অনুমতি নেই।',
      errcode = '42501';
  END IF;

  IF v_period IS NULL THEN
    SELECT mp.id INTO v_period
    FROM public.monthly_periods mp
    WHERE mp.hostel_id = v_hostel
      AND mp.status = 'running'
    ORDER BY mp.start_date DESC
    LIMIT 1;
  END IF;

  IF v_period IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.monthly_periods mp
    WHERE mp.id = v_period
      AND mp.hostel_id = v_hostel
  ) THEN
    RAISE EXCEPTION USING
      message = 'এই মাসের খালার টাকার তথ্য দেখার অনুমতি নেই।',
      errcode = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'entry_id', k.id,
        'id', k.id,
        'hostel_id', k.hostel_id,
        'period_id', k.period_id,
        'member_id', k.member_id,
        'member_name', COALESCE(
          NULLIF(NULLIF(btrim(k.member_name_snapshot), ''), 'খালার পারিশ্রমিক'),
          NULLIF(btrim(recipient_profile.full_name), ''),
          'সদস্যের নাম পাওয়া যায়নি'
        ),
        'recipient_name', COALESCE(
          NULLIF(NULLIF(btrim(k.member_name_snapshot), ''), 'খালার পারিশ্রমিক'),
          NULLIF(btrim(recipient_profile.full_name), ''),
          'সদস্যের নাম পাওয়া যায়নি'
        ),
        'amount', k.amount,
        'entry_date', k.payment_date,
        'payment_date', k.payment_date,
        'description', k.description,
        'status', k.status,
        'void_reason', k.void_reason,
        'created_at', k.created_at,
        'updated_at', k.updated_at,
        'created_by', k.created_by,
        'created_by_name', COALESCE(NULLIF(btrim(creator_profile.full_name), ''), 'নাম পাওয়া যায়নি')
      )
      ORDER BY k.payment_date DESC, k.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT entry.*
    FROM public.khala_money_entries entry
    WHERE entry.hostel_id = v_hostel
      AND (v_period IS NULL OR entry.period_id = v_period)
    ORDER BY entry.payment_date DESC, entry.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 200), 3000))
  ) k
  LEFT JOIN public.hostel_memberships recipient_membership
    ON recipient_membership.id = k.member_id
   AND recipient_membership.hostel_id = k.hostel_id
  LEFT JOIN public.profiles recipient_profile
    ON recipient_profile.id = recipient_membership.user_id
  LEFT JOIN public.profiles creator_profile
    ON creator_profile.id = k.created_by;

  RETURN v_result;
END
$function$;

-- Keep the existing authenticated-only API surface. The compatibility alias
-- continues to delegate to the v2 function and is intentionally not rewritten.
REVOKE ALL ON FUNCTION public.get_khala_money_history_v2(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_khala_money_history_v2(uuid,integer) TO authenticated;

COMMIT;

-- The migration intentionally does not bulk-update old entries.
-- For older entries with no member_id and no usable name snapshot, the original
-- selected recipient cannot be reconstructed safely from existing data.
