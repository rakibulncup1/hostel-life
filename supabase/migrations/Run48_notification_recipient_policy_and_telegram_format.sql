-- HOSTEL LIFE RUN48
-- Recipient-safe notification routing and structured Telegram delivery.
-- Apply only after the existing Run31, Run39 and Run40 notification pipeline.
-- Existing notification rows, financial data, Telegram links and outbox rows are not rewritten.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $run48_preflight$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  v_item record;
BEGIN
  IF to_regclass('public.notifications') IS NULL THEN v_missing := array_append(v_missing, 'public.notifications'); END IF;
  IF to_regclass('public.market_entries') IS NULL THEN v_missing := array_append(v_missing, 'public.market_entries'); END IF;
  IF to_regclass('public.market_entry_items') IS NULL THEN v_missing := array_append(v_missing, 'public.market_entry_items'); END IF;
  IF to_regclass('public.ledger_transactions') IS NULL THEN v_missing := array_append(v_missing, 'public.ledger_transactions'); END IF;
  IF to_regclass('public.khala_money_entries') IS NULL THEN v_missing := array_append(v_missing, 'public.khala_money_entries'); END IF;
  IF to_regclass('public.hostel_memberships') IS NULL THEN v_missing := array_append(v_missing, 'public.hostel_memberships'); END IF;
  IF to_regclass('public.profiles') IS NULL THEN v_missing := array_append(v_missing, 'public.profiles'); END IF;
  IF to_regclass('public.monthly_periods') IS NULL THEN v_missing := array_append(v_missing, 'public.monthly_periods'); END IF;
  IF to_regclass('public.platform_notification_preferences') IS NULL THEN v_missing := array_append(v_missing, 'public.platform_notification_preferences'); END IF;
  IF to_regclass('public.notification_delivery_outbox') IS NULL OR to_regclass('public.notification_delivery_batches') IS NULL THEN
    v_missing := array_append(v_missing, 'Run31 Telegram delivery tables');
  END IF;
  IF to_regprocedure('private.hl_notify_market_insert()') IS NULL
     OR to_regprocedure('private.hl_notify_ledger_insert()') IS NULL
     OR to_regprocedure('private.hl_notify_khala_insert()') IS NULL
     OR to_regprocedure('private.hl_enqueue_notification_delivery()') IS NULL THEN
    v_missing := array_append(v_missing, 'Run31/Run39/Run40 notification trigger functions');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'notifications'
      AND c.column_name = 'delivery_metadata' AND c.data_type <> 'jsonb'
  ) THEN
    v_missing := array_append(v_missing, 'public.notifications.delivery_metadata must be jsonb');
  END IF;

  FOR v_item IN
    SELECT * FROM (VALUES
      ('public','notifications','notification_kind'),
      ('public','notifications','recipient_user_id'),
      ('public','notifications','hostel_id'),
      ('public','notifications','title'),
      ('public','notifications','body'),
      ('public','market_entries','id'),
      ('public','market_entries','hostel_id'),
      ('public','market_entries','buyer_membership_id'),
      ('public','market_entries','buyer_name_snapshot'),
      ('public','market_entries','entry_date'),
      ('public','market_entries','total_amount'),
      ('public','market_entries','credit_to_buyer'),
      ('public','market_entries','status'),
      ('public','market_entries','created_by'),
      ('public','market_entry_items','market_entry_id'),
      ('public','market_entry_items','serial_no'),
      ('public','market_entry_items','item_name'),
      ('public','market_entry_items','quantity'),
      ('public','market_entry_items','amount'),
      ('public','ledger_transactions','hostel_id'),
      ('public','ledger_transactions','period_id'),
      ('public','ledger_transactions','member_id'),
      ('public','ledger_transactions','member_name_snapshot'),
      ('public','ledger_transactions','entry_date'),
      ('public','ledger_transactions','ledger_type'),
      ('public','ledger_transactions','amount'),
      ('public','ledger_transactions','description'),
      ('public','ledger_transactions','status'),
      ('public','ledger_transactions','created_by'),
      ('public','khala_money_entries','hostel_id'),
      ('public','khala_money_entries','period_id'),
      ('public','khala_money_entries','member_id'),
      ('public','khala_money_entries','member_name_snapshot'),
      ('public','khala_money_entries','payment_date'),
      ('public','khala_money_entries','amount'),
      ('public','khala_money_entries','description'),
      ('public','khala_money_entries','status'),
      ('public','khala_money_entries','created_by'),
      ('public','hostel_memberships','id'),
      ('public','hostel_memberships','hostel_id'),
      ('public','hostel_memberships','user_id'),
      ('public','profiles','id'),
      ('public','profiles','full_name'),
      ('public','profiles','is_blocked'),
      ('public','monthly_periods','id'),
      ('public','monthly_periods','label'),
      ('public','platform_notification_preferences','singleton'),
      ('public','platform_notification_preferences','market_activity_enabled'),
      ('public','platform_notification_preferences','ledger_activity_enabled')
    ) AS required_columns(table_schema, table_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = v_item.table_schema
        AND c.table_name = v_item.table_name
        AND c.column_name = v_item.column_name
    ) THEN
      v_missing := array_append(v_missing, v_item.table_schema || '.' || v_item.table_name || '.' || v_item.column_name);
    END IF;
  END LOOP;

  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'Run48 preflight failed: %; no changes committed.', array_to_string(v_missing, ', ')
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'notifications'
      AND t.tgname = 'hl_enqueue_notification_delivery_trg' AND NOT t.tgisinternal AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'Run48 preflight failed: Run31 statement-level Telegram delivery outbox trigger is missing or disabled.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'market_entries'
      AND t.tgname = 'hl_market_notification_total_upd' AND NOT t.tgisinternal AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'Run48 preflight failed: Run40 market total notification trigger is missing or disabled; apply/verify Run40 first.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'ledger_transactions'
      AND t.tgname = 'hl_ledger_notification_ins' AND NOT t.tgisinternal AND t.tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'khala_money_entries'
      AND t.tgname = 'hl_khala_notification_ins' AND NOT t.tgisinternal AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'Run48 preflight failed: ledger or khala notification trigger is missing or disabled.'
      USING ERRCODE = 'P0001';
  END IF;
END;
$run48_preflight$;

-- Telegram-only structured metadata. In-app get_notifications() intentionally
-- does not return this column, so market item lists remain out of the phone inbox.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS delivery_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.notifications.delivery_metadata IS
  'Provider-delivery formatting data. Not included in get_notifications(); direct row access remains protected by the existing recipient-only notifications RLS policy.';

-- Market entry: one concise in-app notification to every active member; a richer
-- ordered item list is retained only for the Telegram delivery formatter.
CREATE OR REPLACE FUNCTION private.hl_notify_market_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_buyer text;
  v_actor text;
  v_title text;
  v_body text;
  v_items jsonb := '[]'::jsonb;
  v_delivery_metadata jsonb := '{}'::jsonb;
BEGIN
  IF NOT COALESCE((SELECT market_activity_enabled FROM public.platform_notification_preferences WHERE singleton), false) THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM 'active' OR NEW.total_amount IS NULL OR NEW.total_amount <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(pg_catalog.btrim(p.full_name), ''), NULLIF(NEW.buyer_name_snapshot, ''), 'একজন সদস্য')
    INTO v_buyer
  FROM public.hostel_memberships m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.id = NEW.buyer_membership_id AND m.hostel_id = NEW.hostel_id;
  v_buyer := COALESCE(v_buyer, NULLIF(NEW.buyer_name_snapshot, ''), 'একজন সদস্য');

  SELECT NULLIF(pg_catalog.btrim(p.full_name), '') INTO v_actor
  FROM public.profiles p WHERE p.id = NEW.created_by;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'serial_no', i.serial_no,
        'item_name', i.item_name,
        'quantity', i.quantity,
        'amount', i.amount
      ) ORDER BY i.serial_no
    ), '[]'::jsonb
  ) INTO v_items
  FROM public.market_entry_items i
  WHERE i.market_entry_id = NEW.id;

  v_title := 'নতুন বাজার এন্ট্রি';
  v_body := 'বাজারকারী: ' || v_buyer || '। মোট বাজার: ৳'
    || pg_catalog.to_char(NEW.total_amount, 'FM999,999,999,990.00')
    || '। এন্ট্রি করেছেন: ' || COALESCE(v_actor, 'একজন ম্যানেজার')
    || '।' || CASE WHEN NEW.credit_to_buyer
      THEN ' বাজারের টাকা তাঁর জমায় যুক্ত হয়েছে।'
      ELSE ' বাজারের টাকা তাঁর জমায় যুক্ত হয়নি।'
    END;

  v_delivery_metadata := pg_catalog.jsonb_build_object(
    'format_version', 1,
    'category', 'market_entry',
    'buyer_name', v_buyer,
    'actor_name', COALESCE(v_actor, 'একজন ম্যানেজার'),
    'entry_date', NEW.entry_date,
    'total_amount', NEW.total_amount,
    'credit_to_buyer', COALESCE(NEW.credit_to_buyer, false),
    'items', v_items
  );

  INSERT INTO public.notifications(
    hostel_id, recipient_user_id, title, body, created_by, notification_kind, delivery_metadata
  )
  SELECT NEW.hostel_id, m.user_id, v_title, v_body, NEW.created_by, 'market_entry', v_delivery_metadata
  FROM public.hostel_memberships m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.hostel_id = NEW.hostel_id
    AND m.status = 'active'
    AND NOT COALESCE(p.is_blocked, false);

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.hl_notify_market_insert() FROM PUBLIC, anon, authenticated;

-- Ledger activity: cash deposits are private to the credited member. Other
-- expenses and ledger adjustments retain their existing hostel-wide behavior.
CREATE OR REPLACE FUNCTION private.hl_notify_ledger_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_member text;
  v_member_user_id uuid;
  v_actor text;
  v_title text;
  v_body text;
  v_kind text;
  v_amount text;
  v_period_label text;
  v_total_deposit numeric := 0;
  v_delivery_metadata jsonb := '{}'::jsonb;
BEGIN
  IF NOT COALESCE((SELECT ledger_activity_enabled FROM public.platform_notification_preferences WHERE singleton), false) THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM 'active' OR NEW.ledger_type NOT IN ('deposit', 'other_expense', 'adjustment') THEN
    RETURN NEW;
  END IF;

  SELECT
    m.user_id,
    COALESCE(NULLIF(pg_catalog.btrim(p.full_name), ''), NULLIF(NEW.member_name_snapshot, ''), 'একজন সদস্য')
  INTO v_member_user_id, v_member
  FROM public.hostel_memberships m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.id = NEW.member_id
    AND m.hostel_id = NEW.hostel_id
    AND NOT COALESCE(p.is_blocked, false);
  v_member := COALESCE(v_member, NULLIF(NEW.member_name_snapshot, ''), 'একজন সদস্য');

  SELECT NULLIF(pg_catalog.btrim(p.full_name), '') INTO v_actor
  FROM public.profiles p WHERE p.id = NEW.created_by;
  v_actor := COALESCE(v_actor, 'একজন ম্যানেজার');
  v_amount := pg_catalog.to_char(abs(NEW.amount), 'FM999,999,999,990.00');

  IF NEW.ledger_type = 'deposit' THEN
    -- A deposit must never fall back to a hostel-wide broadcast. If its member
    -- cannot be resolved to an unblocked account, no notification is emitted.
    IF v_member_user_id IS NULL THEN RETURN NEW; END IF;

    SELECT mp.label INTO v_period_label
    FROM public.monthly_periods mp
    WHERE mp.id = NEW.period_id AND mp.hostel_id = NEW.hostel_id;

    SELECT COALESCE(pg_catalog.sum(l.amount) FILTER (WHERE l.amount > 0), 0)
    INTO v_total_deposit
    FROM public.ledger_transactions l
    WHERE l.hostel_id = NEW.hostel_id
      AND l.period_id = NEW.period_id
      AND l.member_id = NEW.member_id
      AND l.status = 'active'
      AND l.ledger_type IN ('deposit', 'market_deposit');

    v_kind := 'deposit';
    v_title := 'নতুন জমা';
    v_body := 'আপনার হিসাবে ৳' || v_amount || ' জমা যুক্ত হয়েছে। এন্ট্রি করেছেন ' || v_actor
      || '। এই মাসে মোট জমা ৳' || pg_catalog.to_char(v_total_deposit, 'FM999,999,999,990.00')
      || '। তারিখ: ' || pg_catalog.to_char(NEW.entry_date, 'DD Mon YYYY');
    v_delivery_metadata := pg_catalog.jsonb_build_object(
      'format_version', 1,
      'category', 'deposit',
      'member_name', v_member,
      'actor_name', v_actor,
      'entry_date', NEW.entry_date,
      'amount', abs(NEW.amount),
      'period_label', COALESCE(v_period_label, 'চলতি মাস'),
      'period_total_deposit', v_total_deposit,
      'description', NULLIF(NEW.description, '')
    );

    INSERT INTO public.notifications(
      hostel_id, recipient_user_id, title, body, created_by, notification_kind, delivery_metadata
    ) VALUES (
      NEW.hostel_id, v_member_user_id, v_title, v_body, NEW.created_by, v_kind, v_delivery_metadata
    );
    RETURN NEW;
  END IF;

  IF NEW.ledger_type = 'other_expense' THEN
    v_kind := 'other_expense';
    v_title := 'নতুন খরচের হিসাব';
    v_body := '৳' || v_amount || ' টাকার অন্যান্য খরচ এন্ট্রি করেছেন ' || v_actor
      || '। তারিখ: ' || pg_catalog.to_char(NEW.entry_date, 'DD Mon YYYY')
      || CASE WHEN NULLIF(NEW.description, '') IS NOT NULL THEN '। বিবরণ: ' || NEW.description ELSE '' END;
  ELSE
    v_kind := 'ledger_adjustment';
    v_title := 'হিসাব সংশোধন · ' || v_member;
    v_body := v_member || ' এর হিসাবে ' || CASE WHEN NEW.amount >= 0 THEN '+' ELSE '−' END
      || '৳' || v_amount || ' সংশোধন করেছেন ' || v_actor
      || '। তারিখ: ' || pg_catalog.to_char(NEW.entry_date, 'DD Mon YYYY')
      || CASE WHEN NULLIF(NEW.description, '') IS NOT NULL THEN '। কারণ: ' || NEW.description ELSE '' END;
  END IF;

  INSERT INTO public.notifications(
    hostel_id, recipient_user_id, title, body, created_by, notification_kind
  )
  SELECT NEW.hostel_id, m.user_id, v_title, v_body, NEW.created_by, v_kind
  FROM public.hostel_memberships m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.hostel_id = NEW.hostel_id
    AND m.status = 'active'
    AND NOT COALESCE(p.is_blocked, false);

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.hl_notify_ledger_insert() FROM PUBLIC, anon, authenticated;

-- Khala payment is a member-specific financial record, so only the named
-- member receives its inbox notification and Telegram delivery.
CREATE OR REPLACE FUNCTION private.hl_notify_khala_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_member text;
  v_member_user_id uuid;
  v_actor text;
  v_title text;
  v_body text;
  v_delivery_metadata jsonb;
BEGIN
  IF NOT COALESCE((SELECT ledger_activity_enabled FROM public.platform_notification_preferences WHERE singleton), false) THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM 'active' OR NEW.member_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    m.user_id,
    COALESCE(NULLIF(pg_catalog.btrim(p.full_name), ''), NULLIF(NEW.member_name_snapshot, ''), 'একজন সদস্য')
  INTO v_member_user_id, v_member
  FROM public.hostel_memberships m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.id = NEW.member_id
    AND m.hostel_id = NEW.hostel_id
    AND NOT COALESCE(p.is_blocked, false);
  IF v_member_user_id IS NULL THEN RETURN NEW; END IF;

  SELECT NULLIF(pg_catalog.btrim(p.full_name), '') INTO v_actor
  FROM public.profiles p WHERE p.id = NEW.created_by;
  v_actor := COALESCE(v_actor, 'একজন ম্যানেজার');

  v_title := 'খালার পারিশ্রমিক এন্ট্রি';
  v_body := 'আপনার হিসাবে ৳' || pg_catalog.to_char(NEW.amount, 'FM999,999,999,990.00')
    || ' খালার পারিশ্রমিক যুক্ত হয়েছে। এন্ট্রি করেছেন ' || v_actor
    || '। তারিখ: ' || pg_catalog.to_char(NEW.payment_date, 'DD Mon YYYY');
  v_delivery_metadata := pg_catalog.jsonb_build_object(
    'format_version', 1,
    'category', 'khala_money',
    'member_name', v_member,
    'actor_name', v_actor,
    'payment_date', NEW.payment_date,
    'amount', NEW.amount,
    'description', NULLIF(NEW.description, '')
  );

  INSERT INTO public.notifications(
    hostel_id, recipient_user_id, title, body, created_by, notification_kind, delivery_metadata
  ) VALUES (
    NEW.hostel_id, v_member_user_id, v_title, v_body, NEW.created_by, 'khala_money', v_delivery_metadata
  );
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.hl_notify_khala_insert() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- No existing rows are changed. New records follow the recipient policy from this migration onward.
-- Read-only verification: supabase/verify/Verify_Run48_notification_recipient_policy.sql
