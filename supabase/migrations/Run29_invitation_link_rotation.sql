-- Run29: Fix Invitation RPC release compatibility and keep one live invite per hostel.
-- Additive/transactional: does not modify membership, meal, market or ledger rows.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

DO $run29_preflight$
BEGIN
  IF to_regclass('public.hostel_access_links') IS NULL
     OR to_regprocedure('private.my_hostel_id()') IS NULL
     OR to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.assert_hostel_manager(uuid,uuid,boolean,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Run29 stopped: Run28 invitation objects or manager permission helpers are missing.';
  END IF;
END;
$run29_preflight$;

CREATE OR REPLACE FUNCTION public.manager_create_hostel_invite_link(
  p_expires_at timestamptz DEFAULT (now() + interval '7 days'),
  p_label text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hostel uuid;
  v_token text;
  v_id uuid;
  v_exp timestamptz := coalesce(p_expires_at, now() + interval '7 days');
  v_revoked_count integer := 0;
BEGIN
  PERFORM private.assert_signed_in();
  v_hostel := private.my_hostel_id();
  IF v_hostel IS NULL THEN
    RAISE EXCEPTION USING message='আপনার সক্রিয় মেস পাওয়া যায়নি।', errcode='42501';
  END IF;

  -- false/false deliberately preserves the existing permission helper semantics:
  -- current primary manager OR assigned operational assistant manager.
  PERFORM private.assert_hostel_manager(v_hostel, NULL, false, false);

  IF v_exp <= now() OR v_exp > now() + interval '30 days' THEN
    RAISE EXCEPTION USING
      message='Invitation Link-এর মেয়াদ বর্তমান সময় থেকে সর্বোচ্চ ৩০ দিনের মধ্যে হতে হবে.',
      errcode='22023';
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  -- A new invite immediately invalidates every previous non-revoked invite.
  -- The RPC runs in one database transaction: if inserting the new invite fails,
  -- this UPDATE rolls back and the previous active invite remains valid.
  UPDATE public.hostel_access_links
  SET revoked_at = coalesce(revoked_at, now())
  WHERE hostel_id = v_hostel
    AND link_type = 'member_invite'
    AND revoked_at IS NULL;
  GET DIAGNOSTICS v_revoked_count = ROW_COUNT;

  INSERT INTO public.hostel_access_links(
    hostel_id, link_type, token_hash, label, starts_at, expires_at, created_by
  ) VALUES (
    v_hostel,
    'member_invite',
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    left(coalesce(btrim(p_label), ''), 120),
    now(),
    v_exp,
    auth.uid()
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'token', v_token,
    'link_type', 'member_invite',
    'expires_at', v_exp,
    'previous_links_revoked', v_revoked_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manager_create_hostel_invite_link(timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_create_hostel_invite_link(timestamptz, text) TO authenticated;
COMMENT ON FUNCTION public.manager_create_hostel_invite_link(timestamptz, text)
IS 'Create one authenticated hostel invitation; only the current manager or assigned assistant may create it. Creating a new link atomically revokes every previous link for that hostel.';

-- Stable, minimal RPC used by the frontend. Expiry is decided by the database
-- clock (seven days), so an inaccurate device clock cannot break link creation.
CREATE OR REPLACE FUNCTION public.manager_create_or_rotate_hostel_invite_link(
  p_label text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.assert_signed_in();
  RETURN public.manager_create_hostel_invite_link(now() + interval '7 days', p_label);
END;
$$;

REVOKE ALL ON FUNCTION public.manager_create_or_rotate_hostel_invite_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_create_or_rotate_hostel_invite_link(text) TO authenticated;
COMMENT ON FUNCTION public.manager_create_or_rotate_hostel_invite_link(text)
IS 'Create a seven-day invitation with server time and atomically revoke prior active invitations for the hostel. Supports the current primary and assigned assistant manager.';

-- Ask PostgREST to refresh the RPC schema cache after replacement.
NOTIFY pgrst, 'reload schema';
COMMIT;
