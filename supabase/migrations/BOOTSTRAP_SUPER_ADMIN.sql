-- Run ONLY after signing up the intended first trusted administrator.
-- Replace REPLACE_WITH_YOUR_LOGIN_EMAIL with the exact email used in Supabase Auth.
-- This query changes only that user's public.profiles.role.
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT u.id INTO v_user_id
  FROM auth.users AS u
  WHERE lower(u.email) = lower('REPLACE_WITH_YOUR_LOGIN_EMAIL')
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth.users record found. Replace the placeholder with the exact registered email.';
  END IF;

  UPDATE public.profiles
  SET role = 'super_admin', updated_at = now()
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile row missing for this auth user. Confirm the master SQL and auth profile trigger ran successfully.';
  END IF;

  RAISE NOTICE 'Super Admin role assigned to user id %.', v_user_id;
END $$;
