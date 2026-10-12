-- HOSTEL LIFE FINAL ADDITIVE BACKEND MIGRATION V2
-- Prerequisite: existing Core and base Super Admin migrations are already installed.
-- Apply this file once in Supabase SQL Editor as project owner after taking a backup.
-- It deliberately DOES NOT re-run or replace the full Core migration.
-- Contains two separate transactions: Super Admin feature enhancements, then market edit authorization repair.
-- Permanent deletions require exact confirmation and are blocked if cross-host references/accounts make deletion unsafe.

-- Hostel Life: Super Admin enhancements (additive migration)
-- Apply only after the existing Core + Super Admin migration is installed.
-- This script does not rerun the core migration and does not DROP/CASCADE core functions.
-- Permanent delete functions are intentionally strict: exact phrase + server-side super-admin check.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('private.assert_super_admin()') IS NULL
     OR to_regprocedure('private.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: existing Super Admin security helpers were not found. Apply the existing Core/Super Admin migration first.';
  END IF;
  IF to_regclass('public.hostels') IS NULL
     OR to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('public.monthly_periods') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: required Hostel Life tables are missing.';
  END IF;
END;
$preflight$;

-- 1) Private flags for favorites/trusted labels. No financial or meal information is stored here.
CREATE TABLE IF NOT EXISTS private.platform_hostel_flags (
  hostel_id uuid PRIMARY KEY REFERENCES public.hostels(id) ON DELETE CASCADE,
  is_favorite boolean NOT NULL DEFAULT false,
  is_trusted boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS private.platform_user_flags (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_favorite boolean NOT NULL DEFAULT false,
  is_trusted boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.platform_hostel_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.platform_user_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.platform_hostel_flags FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.platform_user_flags FROM PUBLIC, anon, authenticated;

-- New v3 function names avoid changing the return type of an existing v2 RPC.
CREATE OR REPLACE FUNCTION public.platform_admin_list_hostels_v3()
RETURNS TABLE(
  hostel_id uuid,
  name text,
  created_at timestamptz,
  platform_status text,
  member_count bigint,
  is_favorite boolean,
  is_trusted boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $function$
BEGIN
  PERFORM private.assert_super_admin();
  RETURN QUERY
  SELECT h.id, h.name::text, h.created_at,
         COALESCE(c.status, 'active')::text,
         (SELECT count(*) FROM public.hostel_memberships hm
          WHERE hm.hostel_id = h.id AND hm.status = 'active'::public.membership_status),
         COALESCE(f.is_favorite, false), COALESCE(f.is_trusted, false)
  FROM public.hostels h
  LEFT JOIN private.platform_hostel_controls c ON c.hostel_id = h.id
  LEFT JOIN private.platform_hostel_flags f ON f.hostel_id = h.id
  ORDER BY COALESCE(f.is_trusted, false) DESC, COALESCE(f.is_favorite, false) DESC, h.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_list_hostel_members_v3(p_hostel_id uuid)
RETURNS TABLE(
  membership_id uuid,
  user_id uuid,
  full_name text,
  phone text,
  joined_at timestamptz,
  status text,
  role text,
  is_blocked boolean,
  is_favorite boolean,
  is_trusted boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $function$
BEGIN
  PERFORM private.assert_super_admin();
  IF NOT EXISTS (SELECT 1 FROM public.hostels h WHERE h.id = p_hostel_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'মেসটি পাওয়া যায়নি।';
  END IF;
  RETURN QUERY
  SELECT hm.id, hm.user_id, COALESCE(p.full_name, 'সদস্য')::text, p.phone,
         hm.joined_at, hm.status::text, hm.role::text,
         EXISTS (SELECT 1 FROM private.platform_user_blocks b WHERE b.user_id = hm.user_id),
         COALESCE(f.is_favorite, false), COALESCE(f.is_trusted, false)
  FROM public.hostel_memberships hm
  LEFT JOIN public.profiles p ON p.id = hm.user_id
  LEFT JOIN private.platform_user_flags f ON f.user_id = hm.user_id
  WHERE hm.hostel_id = p_hostel_id
  ORDER BY COALESCE(f.is_trusted, false) DESC, COALESCE(f.is_favorite, false) DESC, hm.joined_at ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_set_hostel_flag(
  p_hostel_id uuid, p_flag text, p_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $function$
BEGIN
  PERFORM private.assert_super_admin();
  IF p_flag NOT IN ('favorite', 'trusted') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Flag name invalid.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hostels h WHERE h.id = p_hostel_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'মেসটি পাওয়া যায়নি।';
  END IF;
  INSERT INTO private.platform_hostel_flags(hostel_id, is_favorite, is_trusted, updated_by, updated_at)
  VALUES (p_hostel_id, (p_flag = 'favorite' AND p_enabled), (p_flag = 'trusted' AND p_enabled), auth.uid(), now())
  ON CONFLICT (hostel_id) DO UPDATE SET
    is_favorite = CASE WHEN p_flag = 'favorite' THEN p_enabled ELSE private.platform_hostel_flags.is_favorite END,
    is_trusted = CASE WHEN p_flag = 'trusted' THEN p_enabled ELSE private.platform_hostel_flags.is_trusted END,
    updated_by = auth.uid(), updated_at = now();
  INSERT INTO private.platform_admin_audit_log(actor_user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'hostel_flag_changed', 'hostel', p_hostel_id::text,
          jsonb_build_object('flag', p_flag, 'enabled', p_enabled));
  RETURN jsonb_build_object('hostel_id', p_hostel_id, 'flag', p_flag, 'enabled', p_enabled);
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_set_user_flag(
  p_user_id uuid, p_flag text, p_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $function$
BEGIN
  PERFORM private.assert_super_admin();
  IF p_flag NOT IN ('favorite', 'trusted') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Flag name invalid.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ব্যবহারকারী পাওয়া যায়নি।';
  END IF;
  INSERT INTO private.platform_user_flags(user_id, is_favorite, is_trusted, updated_by, updated_at)
  VALUES (p_user_id, (p_flag = 'favorite' AND p_enabled), (p_flag = 'trusted' AND p_enabled), auth.uid(), now())
  ON CONFLICT (user_id) DO UPDATE SET
    is_favorite = CASE WHEN p_flag = 'favorite' THEN p_enabled ELSE private.platform_user_flags.is_favorite END,
    is_trusted = CASE WHEN p_flag = 'trusted' THEN p_enabled ELSE private.platform_user_flags.is_trusted END,
    updated_by = auth.uid(), updated_at = now();
  INSERT INTO private.platform_admin_audit_log(actor_user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'user_flag_changed', 'user', p_user_id::text,
          jsonb_build_object('flag', p_flag, 'enabled', p_enabled));
  RETURN jsonb_build_object('user_id', p_user_id, 'flag', p_flag, 'enabled', p_enabled);
END;
$function$;

-- 2) Permanent hostel deletion. This is separate from suspend/soft-delete.
-- All child data is deleted in a single transaction. A cross-scope FK or protected account aborts the entire RPC.
CREATE OR REPLACE FUNCTION public.platform_admin_permanently_delete_hostel(
  p_hostel_id uuid,
  p_delete_member_accounts boolean DEFAULT false,
  p_confirmation text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, private, auth, pg_catalog
AS $function$
DECLARE
  v_name text;
  v_user_ids uuid[] := ARRAY[]::uuid[];
  v_member_count integer := 0;
  v_account_count integer := 0;
  v_rows integer := 0;
BEGIN
  PERFORM private.assert_super_admin();
  IF p_confirmation IS DISTINCT FROM ('DELETE HOSTEL ' || p_hostel_id::text) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Permanent delete confirmation did not match.';
  END IF;
  SELECT h.name INTO v_name FROM public.hostels h WHERE h.id = p_hostel_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'মেসটি পাওয়া যায়নি।'; END IF;
  SELECT COALESCE(array_agg(hm.user_id), ARRAY[]::uuid[]), count(*)::integer
    INTO v_user_ids, v_member_count
  FROM public.hostel_memberships hm WHERE hm.hostel_id = p_hostel_id;

  IF p_delete_member_accounts THEN
    IF auth.uid() = ANY(v_user_ids) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'নিজের Super Admin অ্যাকাউন্ট এই অপারেশনে মুছতে পারবেন না।';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = ANY(v_user_ids) AND p.role = 'super_admin') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'মেসে Super Admin account আছে; member accounts সহ delete করা যাবে না।';
    END IF;
    IF EXISTS (SELECT 1 FROM public.hostels other_h WHERE other_h.id <> p_hostel_id AND other_h.created_by = ANY(v_user_ids)) THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'এই মেসের অন্তত একজন সদস্য অন্য মেসের creator। আগে সেই মালিকানা সরান অথবা member Auth accounts অক্ষত রেখে delete করুন।';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.hostel_memberships other_membership
      WHERE other_membership.hostel_id <> p_hostel_id
        AND other_membership.user_id = ANY(v_user_ids)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'এই মেসের অন্তত একজন সদস্য অন্য মেসেও যুক্ত। অন্য মেসের তথ্য অক্ষত রাখতে Auth account মুছে ফেলা বন্ধ করা হয়েছে; Auth accounts অক্ষত রেখে পুনরায় চেষ্টা করুন।';
    END IF;
  END IF;

  INSERT INTO private.platform_admin_audit_log(actor_user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'hostel_permanent_delete_started', 'hostel', p_hostel_id::text,
          jsonb_build_object('name', v_name, 'member_count', v_member_count, 'delete_member_accounts', p_delete_member_accounts));

  -- Delete dependent operational rows before periods/memberships.
  DELETE FROM public.notification_states ns USING public.notifications n
   WHERE ns.notification_id = n.id AND n.hostel_id = p_hostel_id;
  DELETE FROM public.notifications WHERE hostel_id = p_hostel_id;
  DELETE FROM public.archive_edit_permissions WHERE hostel_id = p_hostel_id;
  DELETE FROM public.period_assistant_managers WHERE hostel_id = p_hostel_id;
  IF to_regclass('public.meal_request_edit_audit') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.meal_request_edit_audit WHERE hostel_id = $1' USING p_hostel_id;
  END IF;
  DELETE FROM public.meal_late_overrides WHERE hostel_id = p_hostel_id;
  DELETE FROM public.daily_meal_records WHERE hostel_id = p_hostel_id;
  DELETE FROM public.daily_meal_days WHERE hostel_id = p_hostel_id;
  DELETE FROM public.daily_meal_snapshots WHERE hostel_id = p_hostel_id;
  DELETE FROM public.khala_money_entries WHERE hostel_id = p_hostel_id;
  DELETE FROM public.monthly_summaries WHERE hostel_id = p_hostel_id;

  -- Ledger transactions have a RESTRICT self-FK. Delete leaves first; cross-scope descendants abort/rollback.
  LOOP
    DELETE FROM public.ledger_transactions parent_tx
    WHERE parent_tx.hostel_id = p_hostel_id
      AND NOT EXISTS (SELECT 1 FROM public.ledger_transactions child_tx WHERE child_tx.parent_transaction_id = parent_tx.id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXIT WHEN v_rows = 0;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.ledger_transactions WHERE hostel_id = p_hostel_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Ledger tree has cross-host references. No data was deleted; resolve linked transaction references first.';
  END IF;

  -- Requests have a RESTRICT self-FK. Delete leaf versions first.
  DELETE FROM public.meal_request_days d USING public.meal_requests r
   WHERE d.request_id = r.id AND r.hostel_id = p_hostel_id;
  LOOP
    DELETE FROM public.meal_requests parent_req
    WHERE parent_req.hostel_id = p_hostel_id
      AND NOT EXISTS (SELECT 1 FROM public.meal_requests child_req WHERE child_req.parent_request_id = parent_req.id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXIT WHEN v_rows = 0;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.meal_requests WHERE hostel_id = p_hostel_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Meal request tree has cross-host references. No data was deleted; inspect parent_request_id first.';
  END IF;

  DELETE FROM public.market_entries WHERE hostel_id = p_hostel_id;
  DELETE FROM public.monthly_periods WHERE hostel_id = p_hostel_id;
  -- Clear platform block snapshots before deleting memberships (the FK also cascades,
  -- but explicit ordering avoids depending on that cascade for this private control table).
  DELETE FROM private.platform_user_block_memberships WHERE membership_id IN (
    SELECT hm.id FROM public.hostel_memberships hm WHERE hm.hostel_id = p_hostel_id
  );
  DELETE FROM public.hostel_memberships WHERE hostel_id = p_hostel_id;
  DELETE FROM private.platform_hostel_controls WHERE hostel_id = p_hostel_id;
  DELETE FROM private.platform_hostel_flags WHERE hostel_id = p_hostel_id;
  DELETE FROM public.hostels WHERE id = p_hostel_id;

  IF p_delete_member_accounts AND cardinality(v_user_ids) > 0 THEN
    -- Prevent dangling audit actor references in any remaining membership rows.
    UPDATE public.hostel_memberships SET deactivated_by = NULL WHERE deactivated_by = ANY(v_user_ids);
    UPDATE public.hostel_memberships SET reactivated_by = NULL WHERE reactivated_by = ANY(v_user_ids);
    DELETE FROM auth.users WHERE id = ANY(v_user_ids);
    GET DIAGNOSTICS v_account_count = ROW_COUNT;
  END IF;

  INSERT INTO private.platform_admin_audit_log(actor_user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'hostel_permanently_deleted', 'hostel', p_hostel_id::text,
          jsonb_build_object('name', v_name, 'members_removed', v_member_count, 'auth_accounts_deleted', v_account_count));
  RETURN jsonb_build_object('hostel_id', p_hostel_id, 'members_removed', v_member_count,
                            'member_accounts_deleted', v_account_count, 'auth_accounts_kept', NOT p_delete_member_accounts);
END;
$function$;

-- 3) Permanent member deletion, scoped to one hostel. It rejects deleting the current actor or a super-admin.
CREATE OR REPLACE FUNCTION public.platform_admin_permanently_delete_member(
  p_hostel_id uuid,
  p_membership_id uuid,
  p_delete_auth_account boolean DEFAULT false,
  p_confirmation text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, private, auth, pg_catalog
AS $function$
DECLARE
  v_user_id uuid;
  v_name text;
  v_market_ids uuid[] := ARRAY[]::uuid[];
  v_request_ids uuid[] := ARRAY[]::uuid[];
  v_tx_ids uuid[] := ARRAY[]::uuid[];
  v_rows integer := 0;
  v_auth_deleted integer := 0;
BEGIN
  PERFORM private.assert_super_admin();
  SELECT hm.user_id, COALESCE(p.full_name, 'সদস্য')::text
    INTO v_user_id, v_name
  FROM public.hostel_memberships hm
  LEFT JOIN public.profiles p ON p.id = hm.user_id
  WHERE hm.id = p_membership_id AND hm.hostel_id = p_hostel_id
  FOR UPDATE OF hm;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'এই মেসে সদস্যটি পাওয়া যায়নি।'; END IF;
  IF p_confirmation IS DISTINCT FROM ('DELETE MEMBER ' || v_user_id::text) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Permanent delete confirmation did not match.';
  END IF;
  IF v_user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user_id AND p.role = 'super_admin') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Super Admin account this way cannot be deleted.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.monthly_periods mp WHERE mp.hostel_id = p_hostel_id AND mp.status = 'running'::public.month_status AND mp.primary_manager_membership_id = p_membership_id) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'চলমান মাসের প্রধান ম্যানেজারকে স্থায়ীভাবে মুছতে পারবেন না। আগে অন্য ম্যানেজার নির্ধারণ করুন।';
  END IF;
  IF p_delete_auth_account AND EXISTS (SELECT 1 FROM public.hostels h WHERE h.created_by = v_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'এই অ্যাকাউন্ট একটি মেস তৈরি করেছে। আগে সেই মেসের মালিকানা পরিবর্তন করুন, অথবা Auth account রেখে শুধু সদস্য-ডেটা মুছুন।';
  END IF;
  IF p_delete_auth_account AND EXISTS (
    SELECT 1 FROM public.hostel_memberships other_membership
    WHERE other_membership.user_id = v_user_id
      AND other_membership.id <> p_membership_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'এই ব্যবহারকারী অন্য মেসেও সদস্য। অন্য মেসের ডেটা অক্ষত রাখতে Auth account মুছে ফেলা বন্ধ করা হয়েছে; শুধু এই মেসের সদস্য-রেকর্ড মুছতে Auth account deletion বন্ধ রাখুন।';
  END IF;

  SELECT COALESCE(array_agg(me.id), ARRAY[]::uuid[]) INTO v_market_ids
  FROM public.market_entries me
  WHERE me.hostel_id = p_hostel_id AND (me.buyer_membership_id = p_membership_id OR me.created_by = p_membership_id);

  WITH RECURSIVE request_tree(id) AS (
    SELECT mr.id FROM public.meal_requests mr WHERE mr.hostel_id = p_hostel_id AND mr.member_id = p_membership_id
    UNION
    SELECT child.id FROM public.meal_requests child JOIN request_tree parent ON child.parent_request_id = parent.id WHERE child.hostel_id = p_hostel_id
  ) SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_request_ids FROM request_tree;

  WITH RECURSIVE transaction_tree(id) AS (
    SELECT lt.id FROM public.ledger_transactions lt
    WHERE lt.hostel_id = p_hostel_id AND (
      lt.member_id = p_membership_id OR lt.created_by = p_membership_id
      OR lt.reference_id = ANY(ARRAY(SELECT unnest(v_market_ids)::text))
    )
    UNION
    SELECT child.id FROM public.ledger_transactions child
    JOIN transaction_tree parent ON child.parent_transaction_id = parent.id
    WHERE child.hostel_id = p_hostel_id
  ) SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_tx_ids FROM transaction_tree;

  INSERT INTO private.platform_admin_audit_log(actor_user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'member_permanent_delete_started', 'membership', p_membership_id::text,
          jsonb_build_object('user_id', v_user_id, 'hostel_id', p_hostel_id, 'name', v_name, 'delete_auth_account', p_delete_auth_account));

  -- Remove audit/override rows that restrict request/day deletion.
  IF to_regclass('public.meal_request_edit_audit') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.meal_request_edit_audit WHERE hostel_id = $1 AND (member_id = $2 OR request_id = ANY($3))'
      USING p_hostel_id, p_membership_id, v_request_ids;
    EXECUTE 'UPDATE public.meal_request_edit_audit SET edited_by_membership_id = NULL WHERE hostel_id = $1 AND edited_by_membership_id = $2'
      USING p_hostel_id, p_membership_id;
  END IF;
  DELETE FROM public.meal_late_overrides
   WHERE hostel_id = p_hostel_id AND (member_id = p_membership_id OR source_request_id = ANY(v_request_ids));
  UPDATE public.meal_late_overrides SET approved_by = NULL WHERE hostel_id = p_hostel_id AND approved_by = p_membership_id;

  -- Delete selected ledger tree leaf-first so adjustment children do not block their parent.
  LOOP
    DELETE FROM public.ledger_transactions parent_tx
    WHERE parent_tx.id = ANY(v_tx_ids)
      AND NOT EXISTS (SELECT 1 FROM public.ledger_transactions child_tx WHERE child_tx.parent_transaction_id = parent_tx.id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXIT WHEN v_rows = 0;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.ledger_transactions WHERE id = ANY(v_tx_ids)) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'সদস্যের লেনদেনে অন্য scope-এর child reference আছে। নিরাপত্তার জন্য কোনো deletion commit হয়নি।';
  END IF;

  DELETE FROM public.market_entries WHERE id = ANY(v_market_ids);
  UPDATE public.market_entries SET voided_by = NULL WHERE hostel_id = p_hostel_id AND voided_by = p_membership_id;
  DELETE FROM public.khala_money_entries WHERE hostel_id = p_hostel_id AND (member_id = p_membership_id OR created_by = p_membership_id);
  UPDATE public.khala_money_entries SET updated_by = NULL WHERE hostel_id = p_hostel_id AND updated_by = p_membership_id;
  UPDATE public.khala_money_entries SET voided_by = NULL WHERE hostel_id = p_hostel_id AND voided_by = p_membership_id;

  DELETE FROM public.daily_meal_records WHERE hostel_id = p_hostel_id AND member_id = p_membership_id;
  UPDATE public.daily_meal_records SET entered_by = NULL WHERE hostel_id = p_hostel_id AND entered_by = p_membership_id;
  UPDATE public.daily_meal_records SET finalized_by = NULL WHERE hostel_id = p_hostel_id AND finalized_by = p_membership_id;

  DELETE FROM public.meal_request_days WHERE request_id = ANY(v_request_ids);
  LOOP
    DELETE FROM public.meal_requests parent_req
    WHERE parent_req.id = ANY(v_request_ids)
      AND NOT EXISTS (SELECT 1 FROM public.meal_requests child_req WHERE child_req.parent_request_id = parent_req.id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXIT WHEN v_rows = 0;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.meal_requests WHERE id = ANY(v_request_ids)) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'সদস্যের request tree সম্পূর্ণভাবে মুছতে অন্য reference বাধা দিচ্ছে। কোনো deletion commit হয়নি।';
  END IF;

  DELETE FROM public.archive_edit_permissions WHERE hostel_id = p_hostel_id AND (membership_id = p_membership_id OR granted_by = p_membership_id);
  UPDATE public.archive_edit_permissions SET revoked_by = NULL WHERE hostel_id = p_hostel_id AND revoked_by = p_membership_id;
  DELETE FROM public.period_assistant_managers WHERE hostel_id = p_hostel_id AND (membership_id = p_membership_id OR assigned_by = p_membership_id);
  DELETE FROM public.notifications WHERE hostel_id = p_hostel_id AND target_membership_id = p_membership_id;
  UPDATE public.notifications SET created_by = NULL WHERE hostel_id = p_hostel_id AND created_by = p_membership_id;
  UPDATE public.notifications SET globally_deleted_by = NULL WHERE hostel_id = p_hostel_id AND globally_deleted_by = p_membership_id;
  UPDATE public.meal_requests SET reviewed_by = NULL WHERE hostel_id = p_hostel_id AND reviewed_by = p_membership_id;
  UPDATE public.monthly_periods SET manager_at_start_membership_id = NULL WHERE hostel_id = p_hostel_id AND manager_at_start_membership_id = p_membership_id;
  UPDATE public.monthly_periods SET manager_at_close_membership_id = NULL WHERE hostel_id = p_hostel_id AND manager_at_close_membership_id = p_membership_id;
  UPDATE public.monthly_periods SET primary_manager_membership_id = NULL WHERE hostel_id = p_hostel_id AND primary_manager_membership_id = p_membership_id;
  DELETE FROM private.platform_user_block_memberships WHERE membership_id = p_membership_id;
  DELETE FROM public.hostel_memberships WHERE id = p_membership_id AND hostel_id = p_hostel_id;

  IF p_delete_auth_account THEN
    UPDATE public.hostel_memberships SET deactivated_by = NULL WHERE deactivated_by = v_user_id;
    UPDATE public.hostel_memberships SET reactivated_by = NULL WHERE reactivated_by = v_user_id;
    DELETE FROM auth.users WHERE id = v_user_id;
    GET DIAGNOSTICS v_auth_deleted = ROW_COUNT;
  END IF;

  INSERT INTO private.platform_admin_audit_log(actor_user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'member_permanently_deleted', 'membership', p_membership_id::text,
          jsonb_build_object('user_id', v_user_id, 'hostel_id', p_hostel_id, 'auth_account_deleted', v_auth_deleted = 1,
                             'purged_market_entries', cardinality(v_market_ids), 'purged_meal_requests', cardinality(v_request_ids)));
  RETURN jsonb_build_object('hostel_id', p_hostel_id, 'membership_id', p_membership_id,
                            'user_id', v_user_id, 'auth_account_deleted', v_auth_deleted = 1,
                            'market_entries_deleted', cardinality(v_market_ids), 'meal_requests_deleted', cardinality(v_request_ids));
END;
$function$;

-- 4) Developer image bucket: public read of a single public-assets bucket, uploads/updates/deletes only by super-admin.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('developer-assets', 'developer-assets', true, 5242880, ARRAY['image/jpeg','image/png','image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS hostel_life_developer_assets_public_read ON storage.objects;
CREATE POLICY hostel_life_developer_assets_public_read ON storage.objects
FOR SELECT TO public USING (bucket_id = 'developer-assets');
DROP POLICY IF EXISTS hostel_life_developer_assets_admin_insert ON storage.objects;
CREATE POLICY hostel_life_developer_assets_admin_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'developer-assets'
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin')
);
DROP POLICY IF EXISTS hostel_life_developer_assets_admin_update ON storage.objects;
CREATE POLICY hostel_life_developer_assets_admin_update ON storage.objects
FOR UPDATE TO authenticated USING (
  bucket_id = 'developer-assets'
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin')
) WITH CHECK (
  bucket_id = 'developer-assets'
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin')
);
DROP POLICY IF EXISTS hostel_life_developer_assets_admin_delete ON storage.objects;
CREATE POLICY hostel_life_developer_assets_admin_delete ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'developer-assets'
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin')
);

-- 5) Require phone metadata for app-created email accounts. This trigger only applies when
-- the app supplied full_name metadata; it does not block Supabase dashboard/other provider users.
CREATE OR REPLACE FUNCTION private.enforce_hostel_life_signup_phone()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = auth, public, private, pg_catalog
AS $function$
DECLARE
  v_phone text;
  v_digits text;
BEGIN
  IF COALESCE(NEW.raw_user_meta_data, '{}'::jsonb) ? 'full_name' THEN
    v_phone := NULLIF(btrim(NEW.raw_user_meta_data ->> 'phone'), '');
    v_digits := regexp_replace(COALESCE(v_phone, ''), '[^0-9]', '', 'g');
    IF v_phone IS NULL OR length(v_digits) < 8 OR length(v_digits) > 15 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'রেজিস্ট্রেশনের জন্য বৈধ মোবাইল নম্বর বাধ্যতামূলক (৮–১৫টি সংখ্যা)।';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.enforce_hostel_life_signup_phone() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS hostel_life_enforce_signup_phone ON auth.users;
CREATE TRIGGER hostel_life_enforce_signup_phone
BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.enforce_hostel_life_signup_phone();

-- Restrict the new RPCs. Existing Super Admin RPCs remain unchanged.
REVOKE ALL ON FUNCTION public.platform_admin_list_hostels_v3() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_hostel_members_v3(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_set_hostel_flag(uuid,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_set_user_flag(uuid,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_permanently_delete_hostel(uuid,boolean,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_admin_permanently_delete_member(uuid,uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_hostels_v3() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_hostel_members_v3(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_set_hostel_flag(uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_set_user_flag(uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_permanently_delete_hostel(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_permanently_delete_member(uuid,uuid,boolean,text) TO authenticated;

COMMIT;

-- Post-migration verification. All results should be FOUND/true.
SELECT 'platform_admin_list_hostels_v3' AS component, to_regprocedure('public.platform_admin_list_hostels_v3()') IS NOT NULL AS found
UNION ALL SELECT 'platform_admin_list_hostel_members_v3', to_regprocedure('public.platform_admin_list_hostel_members_v3(uuid)') IS NOT NULL
UNION ALL SELECT 'platform_admin_set_hostel_flag', to_regprocedure('public.platform_admin_set_hostel_flag(uuid,text,boolean)') IS NOT NULL
UNION ALL SELECT 'platform_admin_set_user_flag', to_regprocedure('public.platform_admin_set_user_flag(uuid,text,boolean)') IS NOT NULL
UNION ALL SELECT 'platform_admin_permanently_delete_hostel', to_regprocedure('public.platform_admin_permanently_delete_hostel(uuid,boolean,text)') IS NOT NULL
UNION ALL SELECT 'platform_admin_permanently_delete_member', to_regprocedure('public.platform_admin_permanently_delete_member(uuid,uuid,boolean,text)') IS NOT NULL
UNION ALL SELECT 'developer-assets bucket', EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'developer-assets')
UNION ALL SELECT 'required phone trigger', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hostel_life_enforce_signup_phone' AND NOT tgisinternal);


-- ============================================================================
-- Stage 2: Market History manager authorization repair
-- ============================================================================
-- Hostel Life: focused market-history edit/void authorization repair
-- Purpose: fix the manager identity mismatch: this app treats monthly_periods.primary_manager_membership_id
-- as authoritative for the running period, even if the membership row role remains member.
-- This keeps the existing JSONB return types and does NOT DROP either function.
-- It also scopes market row and credit-reversal access to the current hostel.
-- Run as project owner in Supabase SQL Editor after backing up.
-- No business rows are directly edited by this migration; it replaces function code.

DO $preflight$
BEGIN
  IF to_regclass('public.market_entries') IS NULL
     OR to_regclass('public.market_items') IS NULL
     OR to_regclass('public.ledger_transactions') IS NULL
     OR to_regclass('public.monthly_periods') IS NULL
     OR to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('public.period_assistant_managers') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: one or more Hostel Life market tables are missing.';
  END IF;
  IF to_regprocedure('private.assert_authenticated()') IS NULL
     OR to_regprocedure('private.current_membership_id(boolean)') IS NULL
     OR to_regprocedure('private.current_hostel_id(boolean)') IS NULL
     OR to_regprocedure('private.can_manage_period(uuid)') IS NULL
     OR to_regprocedure('private.period_for_hostel_date(uuid,date)') IS NULL
     OR to_regprocedure('private.assert_membership(uuid,uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: required permission helper missing. No change was applied.';
  END IF;
  IF to_regprocedure('public.manager_update_market_entry(uuid,date,uuid,jsonb,boolean,text)') IS NULL
     OR to_regprocedure('public.manager_void_market_entry(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: market manager RPC overload is missing. No change was applied.';
  END IF;
END;
$preflight$;

BEGIN;

-- Market-specific period permission helper.
-- IMPORTANT: this app defines the primary manager through
-- monthly_periods.primary_manager_membership_id (the membership role may still
-- be 'member'). Accept either the designated primary manager or a role-manager.
-- Period assistants remain supported. Archived rules stay delegated to the
-- established private.can_manage_period() helper.
CREATE OR REPLACE FUNCTION private.can_manage_market_period(p_period_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $market_period_permission$
DECLARE
  v_actor uuid;
  v_hostel uuid;
  v_status public.month_status;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  v_actor := private.current_membership_id(true);
  v_hostel := private.current_hostel_id(true);
  IF v_actor IS NULL OR v_hostel IS NULL OR p_period_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT mp.status
    INTO v_status
  FROM public.monthly_periods mp
  WHERE mp.id = p_period_id
    AND mp.hostel_id = v_hostel;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_status = 'running'::public.month_status THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.monthly_periods mp
      JOIN public.hostel_memberships hm
        ON hm.id = v_actor
       AND hm.hostel_id = mp.hostel_id
       AND hm.user_id = auth.uid()
       AND hm.status = 'active'::public.membership_status
      WHERE mp.id = p_period_id
        AND mp.hostel_id = v_hostel
        AND mp.status = 'running'::public.month_status
        AND (
          hm.id = mp.primary_manager_membership_id
          OR hm.role = 'manager'::public.membership_role
        )
    ) OR EXISTS (
      SELECT 1
      FROM public.monthly_periods mp
      JOIN public.period_assistant_managers pam
        ON pam.period_id = mp.id
       AND pam.membership_id = v_actor
      JOIN public.hostel_memberships hm
        ON hm.id = pam.membership_id
       AND hm.hostel_id = mp.hostel_id
       AND hm.user_id = auth.uid()
       AND hm.status = 'active'::public.membership_status
      WHERE mp.id = p_period_id
        AND mp.hostel_id = v_hostel
        AND mp.status = 'running'::public.month_status
    );
  END IF;

  IF v_status = 'archived'::public.month_status THEN
    RETURN COALESCE(private.can_manage_period(p_period_id), false);
  END IF;

  RETURN false;
END;
$market_period_permission$;

REVOKE ALL ON FUNCTION private.can_manage_market_period(uuid) FROM PUBLIC, anon, authenticated;

-- The same-hostel checks below protect the entry and its associated ledger rows.
-- The helper explicitly accepts the running period's primary_manager_membership_id.
-- Archived edit rules remain unchanged.
create or replace function public.manager_update_market_entry(
  p_market_entry_id uuid,
  p_entry_date date,
  p_buyer_membership_id uuid,
  p_items jsonb,
  p_credit_to_buyer boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
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

  if v_actor is null then
    raise exception using message='লগইন সদস্যের পরিচয় পাওয়া যায়নি।';
  end if;

  select * into v_old
  from public.market_entries
  where id=p_market_entry_id
    and hostel_id=v_hostel
  for update;

  if v_old.id is null then
    raise exception using message='বাজার এন্ট্রি পাওয়া যায়নি।';
  end if;

  if not private.can_manage_market_period(v_old.period_id) then
    raise exception using message='পুরোনো মাসের বাজার এন্ট্রি সম্পাদনের অনুমতি নেই।';
  end if;

  v_new_period := private.period_for_hostel_date(v_hostel,p_entry_date);
  if v_new_period is null or not private.can_manage_market_period(v_new_period) then
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
    where lt.hostel_id=v_hostel
      and lt.reference_type='market_entry'
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
        reference_type,reference_id,parent_transaction_id,description,created_by
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
   where id=p_market_entry_id
     and hostel_id=v_hostel;

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
      reference_type,reference_id,description,created_by
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
$$;

create or replace function public.manager_void_market_entry(
  p_market_entry_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_actor uuid;
  v_hostel uuid;
  v_old public.market_entries;
  v_credit record;
begin
  perform private.assert_authenticated();
  v_actor := private.current_membership_id(true);
  v_hostel := private.current_hostel_id(true);

  if v_actor is null then
    raise exception using message='লগইন সদস্যের পরিচয় পাওয়া যায়নি।';
  end if;

  select * into v_old
  from public.market_entries
  where id=p_market_entry_id
    and hostel_id=v_hostel
  for update;

  if v_old.id is null then
    raise exception using message='বাজার এন্ট্রি পাওয়া যায়নি।';
  end if;

  if not private.can_manage_market_period(v_old.period_id) then
    raise exception using message='এই বাজার বাতিল করার অনুমতি নেই।';
  end if;

  if v_old.status='void' then
    raise exception using message='বাজার এন্ট্রিটি ইতিমধ্যে বাতিল।';
  end if;

  if p_reason is null or length(trim(p_reason))<1 then
    raise exception using message='বাতিল করার কারণ লিখতে হবে।';
  end if;

  for v_credit in
    select lt.id, lt.amount, lt.hostel_id, lt.period_id, lt.member_id
    from public.ledger_transactions lt
    where lt.hostel_id=v_hostel
      and lt.reference_type='market_entry'
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
        reference_type,reference_id,parent_transaction_id,description,created_by
      ) values(
        v_credit.hostel_id,
        v_credit.period_id,
        v_credit.member_id,
        'adjustment',
        case when -v_credit.amount > 0 then 'deposit' else 'expense' end,
        -v_credit.amount,
        'market_void_reversal',
        v_old.id,
        v_credit.id,
        trim(p_reason),
        v_actor
      );
    end if;
  end loop;

  update public.market_entries
     set status='void',
         voided_by=v_actor,
         voided_at=now(),
         void_reason=trim(p_reason),
         updated_at=now()
   where id=p_market_entry_id
     and hostel_id=v_hostel;

  return jsonb_build_object(
    'market_entry_id',p_market_entry_id,
    'status','void'
  );
end;
$$;

REVOKE ALL ON FUNCTION public.manager_update_market_entry(uuid,date,uuid,jsonb,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_update_market_entry(uuid,date,uuid,jsonb,boolean,text) TO authenticated;
REVOKE ALL ON FUNCTION public.manager_void_market_entry(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_void_market_entry(uuid,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Read-only verification (run after successful completion)
SELECT 'private.can_manage_market_period' AS check_name,
       CASE WHEN to_regprocedure('private.can_manage_market_period(uuid)') IS NOT NULL
            THEN 'OK' ELSE 'MISSING' END AS result
UNION ALL
SELECT 'manager_update_market_entry',
       CASE WHEN to_regprocedure('public.manager_update_market_entry(uuid,date,uuid,jsonb,boolean,text)') IS NOT NULL
              AND has_function_privilege('authenticated','public.manager_update_market_entry(uuid,date,uuid,jsonb,boolean,text)','EXECUTE')
            THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'manager_void_market_entry',
       CASE WHEN to_regprocedure('public.manager_void_market_entry(uuid,text)') IS NOT NULL
              AND has_function_privilege('authenticated','public.manager_void_market_entry(uuid,text)','EXECUTE')
            THEN 'OK' ELSE 'MISSING' END;
