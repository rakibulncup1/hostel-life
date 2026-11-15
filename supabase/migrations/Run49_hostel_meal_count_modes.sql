-- Hostel Life Run49: per-hostel meal serving modes for dashboard display only.
-- Existing meal records, meal totals, rates, balances and reports are untouched.

BEGIN;

ALTER TABLE public.hostels
  ADD COLUMN IF NOT EXISTS meal_count_modes jsonb NOT NULL
  DEFAULT '{"breakfast":"half","lunch":"full","dinner":"full"}'::jsonb;

UPDATE public.hostels
SET meal_count_modes = '{"breakfast":"half","lunch":"full","dinner":"full"}'::jsonb
WHERE meal_count_modes IS NULL
   OR jsonb_typeof(meal_count_modes) <> 'object'
   OR NOT (meal_count_modes ? 'breakfast' AND meal_count_modes ? 'lunch' AND meal_count_modes ? 'dinner')
   OR COALESCE(meal_count_modes ->> 'breakfast', '') NOT IN ('half', 'full')
   OR COALESCE(meal_count_modes ->> 'lunch', '') NOT IN ('half', 'full')
   OR COALESCE(meal_count_modes ->> 'dinner', '') NOT IN ('half', 'full');

-- Keep the active primary/assistant-manager join-code visibility from Run22,
-- and expose the shared setting in the same identity RPC (no extra read RPC).
CREATE OR REPLACE FUNCTION public.get_my_membership()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $run49$
DECLARE
  v jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  SELECT jsonb_build_object(
    'membership_id', m.id,
    'id', m.id,
    'user_id', m.user_id,
    'hostel_id', m.hostel_id,
    'hostel_name', h.name,
    'hostel_status', h.platform_status,
    'join_code', CASE
      WHEN m.role = 'manager' OR EXISTS (
        SELECT 1
        FROM public.monthly_periods mp
        WHERE mp.hostel_id = h.id
          AND mp.status = 'running'
          AND (
            mp.primary_manager_membership_id = m.id
            OR EXISTS (
              SELECT 1
              FROM public.period_assistant_managers a
              WHERE a.period_id = mp.id
                AND a.hostel_id = h.id
                AND a.membership_id = m.id
            )
          )
      ) THEN h.join_code
      ELSE NULL
    END,
    'meal_count_modes', COALESCE(h.meal_count_modes,
      '{"breakfast":"half","lunch":"full","dinner":"full"}'::jsonb),
    'role', m.role,
    'status', m.status,
    'member_status', m.status,
    'member_name', p.full_name,
    'full_name', p.full_name,
    'phone', p.phone,
    'joined_at', m.joined_at
  )
  INTO v
  FROM public.hostel_memberships m
  JOIN public.hostels h ON h.id = m.hostel_id
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.user_id = auth.uid()
    AND m.status = 'active'
    AND NOT p.is_blocked
  ORDER BY m.created_at DESC
  LIMIT 1;
  RETURN v;
END;
$run49$;

CREATE OR REPLACE FUNCTION public.manager_update_meal_count_modes(p_modes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $run49$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_modes jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  PERFORM private.assert_hostel_manager(v_hostel, NULL, false, false);

  IF jsonb_typeof(p_modes) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING message = 'মিল গণনার ধরন সঠিক নয়।', errcode = '22023';
  END IF;

  IF jsonb_typeof(p_modes -> 'breakfast') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_modes -> 'lunch') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_modes -> 'dinner') IS DISTINCT FROM 'string'
    OR p_modes ->> 'breakfast' NOT IN ('half', 'full')
    OR p_modes ->> 'lunch' NOT IN ('half', 'full')
    OR p_modes ->> 'dinner' NOT IN ('half', 'full') THEN
    RAISE EXCEPTION USING message = 'প্রতিটি বেলার জন্য Half অথবা Full নির্বাচন করুন।', errcode = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_modes) AS k(key)
    WHERE k.key NOT IN ('breakfast', 'lunch', 'dinner')
  ) THEN
    RAISE EXCEPTION USING message = 'অতিরিক্ত মিল গণনার সেটিং গ্রহণযোগ্য নয়।', errcode = '22023';
  END IF;

  v_modes := jsonb_build_object(
    'breakfast', p_modes ->> 'breakfast',
    'lunch', p_modes ->> 'lunch',
    'dinner', p_modes ->> 'dinner'
  );

  UPDATE public.hostels
  SET meal_count_modes = v_modes,
      updated_at = now()
  WHERE id = v_hostel;

  RETURN jsonb_build_object('meal_count_modes', v_modes, 'saved', true);
END;
$run49$;

-- Preserve the existing get_my_membership() execute ACL from Run22.
REVOKE ALL ON FUNCTION public.manager_update_meal_count_modes(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_update_meal_count_modes(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
