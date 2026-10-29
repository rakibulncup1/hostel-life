-- Khala history display-only repair. Does not modify payments or account balances.
CREATE OR REPLACE FUNCTION public.get_khala_money_history_v2(
  p_period_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_hostel uuid := private.my_hostel_id();
  v_period uuid := p_period_id;
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF v_hostel IS NULL OR NOT private.can_access_hostel(v_hostel) THEN
    RAISE EXCEPTION USING message = 'এই হিসাব দেখার অনুমতি নেই।', errcode = '42501';
  END IF;
  IF v_period IS NULL THEN
    SELECT id INTO v_period FROM public.monthly_periods
    WHERE hostel_id = v_hostel AND status = 'running'
    ORDER BY start_date DESC LIMIT 1;
  END IF;
  IF v_period IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.monthly_periods WHERE id = v_period AND hostel_id = v_hostel
  ) THEN
    RAISE EXCEPTION USING message = 'এই মাসের খালার টাকার তথ্য দেখার অনুমতি নেই।', errcode = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'entry_id', k.id, 'id', k.id, 'hostel_id', k.hostel_id, 'period_id', k.period_id,
    'member_id', k.member_id, 'member_name', COALESCE(NULLIF(btrim(recipient.full_name), ''), 'নাম পাওয়া যায়নি'),
    'amount', k.amount, 'entry_date', k.payment_date, 'payment_date', k.payment_date,
    'description', k.description, 'status', k.status, 'void_reason', k.void_reason,
    'created_at', k.created_at, 'updated_at', k.updated_at,
    'created_by', k.created_by,
    'created_by_name', COALESCE(NULLIF(btrim(p.full_name), ''), 'নাম পাওয়া যায়নি')
  ) ORDER BY k.payment_date DESC, k.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT * FROM public.khala_money_entries
    WHERE hostel_id = v_hostel AND (v_period IS NULL OR period_id = v_period)
    ORDER BY payment_date DESC, created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 200), 3000))
  ) k
  LEFT JOIN public.profiles p ON p.id = k.created_by
  LEFT JOIN public.hostel_memberships hm ON hm.id = k.member_id AND hm.hostel_id = k.hostel_id
  LEFT JOIN public.profiles recipient ON recipient.id = hm.user_id;
  RETURN v_result;
END
$fn$;
REVOKE ALL ON FUNCTION public.get_khala_money_history_v2(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_khala_money_history_v2(uuid,integer) TO authenticated;
