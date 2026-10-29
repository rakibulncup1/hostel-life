-- READ ONLY. Run in Supabase SQL Editor to inspect whether a recipient was actually recorded.
-- Do not update member_id from guesses: this is a financial history field.
SELECT
  k.id AS entry_id,
  k.payment_date,
  k.amount,
  k.member_id AS recorded_membership_id,
  hm.user_id AS recipient_user_id,
  p.full_name AS recipient_name,
  k.created_by AS entered_by_user_id,
  creator.full_name AS entered_by_name,
  CASE
    WHEN k.member_id IS NULL THEN 'RECIPIENT_NOT_SAVED'
    WHEN hm.id IS NULL THEN 'MEMBERSHIP_NOT_FOUND'
    WHEN p.id IS NULL THEN 'PROFILE_NOT_FOUND'
    WHEN NULLIF(btrim(p.full_name), '') IS NULL THEN 'RECIPIENT_NAME_EMPTY'
    ELSE 'OK'
  END AS recipient_status
FROM public.khala_money_entries k
LEFT JOIN public.hostel_memberships hm ON hm.id = k.member_id AND hm.hostel_id = k.hostel_id
LEFT JOIN public.profiles p ON p.id = hm.user_id
LEFT JOIN public.profiles creator ON creator.id = k.created_by
ORDER BY k.created_at DESC
LIMIT 100;
