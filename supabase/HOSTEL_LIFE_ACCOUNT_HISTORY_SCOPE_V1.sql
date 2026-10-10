-- HOSTEL LIFE — ACCOUNT HISTORY SCOPE V1
-- Purpose: support the account-history UI selector for ordinary/assistant accounts:
--          "সবার হিসাব" (p_member_id = NULL) or "শুধু আমার" (p_member_id = own membership).
-- Scope: authenticated user's CURRENT HOSTEL and selected/current period only.
-- Keeps the existing function signature and return type. Does not insert/update/delete
-- business rows. It replaces one SECURITY DEFINER RPC and preserves authenticated execute.
-- The user explicitly confirmed that same-hostel members may view other members' account
-- history in this application. Do not run if that product rule has changed.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_account_history_v2(
  p_period_id uuid DEFAULT NULL::uuid,
  p_member_id uuid DEFAULT NULL::uuid,
  p_limit integer DEFAULT 200
)
RETURNS TABLE(
  transaction_id uuid,
  member_id uuid,
  member_name text,
  entry_date date,
  amount numeric,
  transaction_type public.ledger_type,
  description text,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_hostel uuid;
  v_period uuid;
  v_current_member uuid;
  v_target_member uuid;
  v_manager boolean;
BEGIN
  PERFORM private.assert_authenticated();
  v_hostel := private.current_hostel_id(true);
  IF v_hostel IS NULL THEN
    RAISE EXCEPTION USING message = 'আপনি কোনো মেসের সদস্য নন।';
  END IF;

  v_current_member := private.current_membership_id(true);
  v_manager := private.is_manager(v_hostel);

  v_period := COALESCE(
    p_period_id,
    (SELECT mp.id FROM public.monthly_periods mp
      WHERE mp.hostel_id = v_hostel AND mp.status = 'running'
      ORDER BY mp.start_date DESC, mp.created_at DESC LIMIT 1),
    (SELECT mp.id FROM public.monthly_periods mp
      WHERE mp.hostel_id = v_hostel
      ORDER BY mp.end_date DESC, mp.created_at DESC LIMIT 1)
  );

  IF v_period IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.monthly_periods mp
    WHERE mp.id = v_period AND mp.hostel_id = v_hostel
  ) THEN
    RAISE EXCEPTION USING message = 'নির্বাচিত মাস এই মেসের নয়।';
  END IF;

  IF p_member_id IS NOT NULL THEN
    PERFORM private.assert_membership(p_member_id, v_hostel, false);
    IF NOT v_manager AND p_member_id IS DISTINCT FROM v_current_member THEN
      RAISE EXCEPTION USING message = 'অন্য সদস্যকে আলাদাভাবে নির্বাচন করার অনুমতি নেই।';
    END IF;
    v_target_member := p_member_id;
  ELSE
    -- Intentionally return all rows for this hostel and selected period.
    -- The current hostel and period checks above prevent cross-hostel reads.
    v_target_member := NULL;
  END IF;

  RETURN QUERY
  SELECT
    lt.id,
    lt.member_id,
    pr.full_name,
    lt.entry_date,
    lt.amount,
    lt.ledger_type,
    lt.description,
    lt.created_at
  FROM public.ledger_transactions lt
  JOIN public.hostel_memberships hm ON hm.id = lt.member_id AND hm.hostel_id = v_hostel
  JOIN public.profiles pr ON pr.id = hm.user_id
  WHERE lt.hostel_id = v_hostel
    AND lt.period_id = v_period
    AND (v_target_member IS NULL OR lt.member_id = v_target_member)
  ORDER BY lt.entry_date DESC, lt.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_account_history_v2(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_history_v2(uuid, uuid, integer) TO authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;
