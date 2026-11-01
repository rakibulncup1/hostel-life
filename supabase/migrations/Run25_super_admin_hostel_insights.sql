-- ============================================================================
-- HOSTEL LIFE — PHASE 2: SUPER ADMIN HOSTEL INSIGHTS
-- Run after Run24. Read-only, aggregate-only hostel/period insight endpoint.
-- No table/column/data changes. No personal member financial rows are returned.
-- ============================================================================
BEGIN;

DO $preflight$
DECLARE
  v_missing_tables text;
  v_missing_columns text;
BEGIN
  SELECT string_agg(table_name, ', ' ORDER BY table_name) INTO v_missing_tables
  FROM unnest(ARRAY[
    'hostels','monthly_periods','hostel_memberships','period_assistant_managers',
    'daily_meal_days','daily_meal_records','market_entries','ledger_transactions',
    'khala_money_entries','meal_requests','hl_archived_final_summaries'
  ]) AS req(table_name)
  WHERE to_regclass('public.' || table_name) IS NULL;
  IF v_missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Run25 blocked; required tables missing: %', v_missing_tables;
  END IF;

  SELECT string_agg(x.table_name || '.' || x.column_name, ', ' ORDER BY x.table_name, x.column_name)
    INTO v_missing_columns
  FROM (VALUES
    ('hostels','id'),('hostels','name'),('hostels','platform_status'),('hostels','created_at'),
    ('monthly_periods','id'),('monthly_periods','hostel_id'),('monthly_periods','label'),
    ('monthly_periods','start_date'),('monthly_periods','end_date'),('monthly_periods','status'),
    ('monthly_periods','primary_manager_membership_id'),('monthly_periods','created_at'),
    ('hostel_memberships','id'),('hostel_memberships','hostel_id'),('hostel_memberships','status'),
    ('hostel_memberships','joined_at'),('hostel_memberships','deactivated_at'),
    ('period_assistant_managers','period_id'),('period_assistant_managers','hostel_id'),
    ('daily_meal_days','id'),('daily_meal_days','hostel_id'),('daily_meal_days','period_id'),('daily_meal_days','status'),
    ('daily_meal_records','hostel_id'),('daily_meal_records','daily_meal_day_id'),('daily_meal_records','period_id'),('daily_meal_records','cancelled'),
    ('daily_meal_records','final_breakfast'),('daily_meal_records','final_lunch'),('daily_meal_records','final_dinner'),
    ('daily_meal_records','actual_breakfast'),('daily_meal_records','actual_lunch'),('daily_meal_records','actual_dinner'),
    ('daily_meal_records','planned_breakfast'),('daily_meal_records','planned_lunch'),('daily_meal_records','planned_dinner'),
    ('market_entries','hostel_id'),('market_entries','period_id'),('market_entries','status'),('market_entries','total_amount'),
    ('ledger_transactions','hostel_id'),('ledger_transactions','period_id'),('ledger_transactions','status'),('ledger_transactions','ledger_type'),('ledger_transactions','amount'),
    ('khala_money_entries','hostel_id'),('khala_money_entries','period_id'),('khala_money_entries','status'),('khala_money_entries','amount'),
    ('meal_requests','hostel_id'),('meal_requests','period_id'),('meal_requests','status'),
    ('hl_archived_final_summaries','period_id'),('hl_archived_final_summaries','hostel_id'),
    ('hl_archived_final_summaries','period_label'),('hl_archived_final_summaries','start_date'),
    ('hl_archived_final_summaries','end_date'),('hl_archived_final_summaries','summary'),
    ('hl_archived_final_summaries','archived_at'),('hl_archived_final_summaries','purged_at')
  ) AS x(table_name,column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=x.table_name AND c.column_name=x.column_name
  );
  IF v_missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Run25 blocked; required columns missing: %', v_missing_columns;
  END IF;

  IF to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'Run25 blocked; Super Admin security helpers are missing.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.platform_admin_get_hostel_insights(
  p_hostel_id uuid,
  p_period_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hostel public.hostels%ROWTYPE;
  v_period public.monthly_periods%ROWTYPE;
  v_saved public.hl_archived_final_summaries%ROWTYPE;
  v_period_found boolean := false;
  v_saved_found boolean := false;
  v_periods jsonb := '[]'::jsonb;
  v_period_json jsonb;
  v_summary jsonb;
  v_period_id uuid;
  v_period_members bigint := 0;
  v_active_members bigint := 0;
  v_assistant_count bigint := 0;
  v_manager_assigned boolean := false;
  v_period_days integer := 0;
  v_finalized_days bigint := 0;
  v_cancelled_days bigint := 0;
  v_breakfast numeric := 0;
  v_lunch numeric := 0;
  v_dinner numeric := 0;
  v_market_entries bigint := 0;
  v_market_total numeric := 0;
  v_cash_deposit numeric := 0;
  v_market_credit numeric := 0;
  v_other_expense numeric := 0;
  v_adjustments numeric := 0;
  v_khala_total numeric := 0;
  v_pending_requests bigint := 0;
  v_total_meals numeric := 0;
  v_operating_expenses numeric := 0;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='শুধু Super Admin মেসের সারসংক্ষেপ দেখতে পারবেন।', ERRCODE='42501';
  END IF;
  IF p_hostel_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='একটি মেস নির্বাচন করুন।', ERRCODE='22023';
  END IF;

  SELECT * INTO v_hostel FROM public.hostels WHERE id=p_hostel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='নির্বাচিত মেস পাওয়া যায়নি।', ERRCODE='P0002';
  END IF;

  -- Current/closed periods plus durable summaries whose detailed period rows
  -- were legitimately purged under the existing retention workflow.
  SELECT COALESCE(jsonb_agg(q.item ORDER BY q.start_date DESC, q.period_id DESC),'[]'::jsonb)
    INTO v_periods
  FROM (
    SELECT p.id AS period_id, p.start_date,
      jsonb_build_object(
        'id',p.id,'label',p.label,'start_date',p.start_date,'end_date',p.end_date,
        'status',p.status,'snapshot_only',false
      ) AS item
    FROM public.monthly_periods p
    WHERE p.hostel_id=p_hostel_id
    UNION ALL
    SELECT s.period_id, s.start_date,
      jsonb_build_object(
        'id',s.period_id,'label',s.period_label,'start_date',s.start_date,'end_date',s.end_date,
        'status','saved_summary','snapshot_only',true,'archived_at',s.archived_at
      ) AS item
    FROM public.hl_archived_final_summaries s
    WHERE s.hostel_id=p_hostel_id AND s.purged_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.monthly_periods p WHERE p.id=s.period_id)
    ORDER BY start_date DESC, period_id DESC
    LIMIT 120
  ) q;

  IF p_period_id IS NOT NULL THEN
    SELECT * INTO v_period FROM public.monthly_periods
    WHERE id=p_period_id AND hostel_id=p_hostel_id;
    v_period_found := FOUND;
    IF NOT v_period_found THEN
      SELECT * INTO v_saved FROM public.hl_archived_final_summaries
      WHERE period_id=p_period_id AND hostel_id=p_hostel_id AND purged_at IS NOT NULL;
      v_saved_found := FOUND;
    END IF;
    IF NOT v_period_found AND NOT v_saved_found THEN
      RAISE EXCEPTION USING MESSAGE='এই মেসের নির্বাচিত মাস পাওয়া যায়নি।', ERRCODE='P0002';
    END IF;
  ELSE
    SELECT * INTO v_period FROM public.monthly_periods
    WHERE hostel_id=p_hostel_id AND status='running'
    ORDER BY start_date DESC, created_at DESC LIMIT 1;
    v_period_found := FOUND;
    IF NOT v_period_found THEN
      SELECT * INTO v_period FROM public.monthly_periods
      WHERE hostel_id=p_hostel_id
      ORDER BY start_date DESC, created_at DESC LIMIT 1;
      v_period_found := FOUND;
    END IF;
    IF NOT v_period_found THEN
      SELECT * INTO v_saved FROM public.hl_archived_final_summaries
      WHERE hostel_id=p_hostel_id AND purged_at IS NOT NULL
      ORDER BY end_date DESC, archived_at DESC LIMIT 1;
      v_saved_found := FOUND;
    END IF;
  END IF;

  IF NOT v_period_found AND NOT v_saved_found THEN
    RETURN jsonb_build_object(
      'hostel',jsonb_build_object('id',v_hostel.id,'name',v_hostel.name,
        'platform_status',v_hostel.platform_status,'created_at',v_hostel.created_at),
      'periods',v_periods,'selected_period_id',NULL,'period',NULL,'summary',NULL,
      'generated_at',now()
    );
  END IF;

  IF v_period_found THEN
    v_period_id := v_period.id;
    v_period_days := GREATEST(0,(v_period.end_date-v_period.start_date)+1);
    v_period_json := jsonb_build_object(
      'id',v_period.id,'label',v_period.label,'status',v_period.status,
      'start_date',v_period.start_date,'end_date',v_period.end_date,
      'snapshot_only',false
    );

    SELECT count(*) INTO v_period_members
    FROM public.hostel_memberships m
    WHERE m.hostel_id=p_hostel_id
      AND (m.joined_at AT TIME ZONE 'Asia/Dhaka')::date <= v_period.end_date
      AND (m.deactivated_at IS NULL OR (m.deactivated_at AT TIME ZONE 'Asia/Dhaka')::date >= v_period.start_date);

    SELECT count(*) INTO v_active_members
    FROM public.hostel_memberships m
    WHERE m.hostel_id=p_hostel_id AND m.status='active';

    SELECT count(*) INTO v_assistant_count
    FROM public.period_assistant_managers a
    WHERE a.hostel_id=p_hostel_id AND a.period_id=v_period.id;

    v_manager_assigned := v_period.primary_manager_membership_id IS NOT NULL;

    SELECT count(*) FILTER (WHERE d.status='finalized'),
           count(*) FILTER (WHERE d.status='cancelled')
      INTO v_finalized_days,v_cancelled_days
    FROM public.daily_meal_days d
    WHERE d.hostel_id=p_hostel_id AND d.period_id=v_period.id;

    SELECT
      COALESCE(sum(COALESCE(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0)),0),
      COALESCE(sum(COALESCE(r.final_lunch,r.actual_lunch,r.planned_lunch,0)),0),
      COALESCE(sum(COALESCE(r.final_dinner,r.actual_dinner,r.planned_dinner,0)),0)
      INTO v_breakfast,v_lunch,v_dinner
    FROM public.daily_meal_records r
    JOIN public.daily_meal_days d ON d.id=r.daily_meal_day_id
    WHERE r.hostel_id=p_hostel_id AND r.period_id=v_period.id
      AND d.status='finalized' AND NOT r.cancelled;

    SELECT count(*),COALESCE(sum(e.total_amount),0)
      INTO v_market_entries,v_market_total
    FROM public.market_entries e
    WHERE e.hostel_id=p_hostel_id AND e.period_id=v_period.id AND e.status='active';

    SELECT
      COALESCE(sum(l.amount) FILTER (WHERE l.ledger_type='deposit' AND l.amount>0),0),
      COALESCE(sum(l.amount) FILTER (WHERE l.ledger_type='market_deposit' AND l.amount>0),0),
      COALESCE(sum(abs(least(l.amount,0))) FILTER (WHERE l.ledger_type='other_expense'),0),
      COALESCE(sum(l.amount) FILTER (WHERE l.ledger_type='adjustment'),0)
      INTO v_cash_deposit,v_market_credit,v_other_expense,v_adjustments
    FROM public.ledger_transactions l
    WHERE l.hostel_id=p_hostel_id AND l.period_id=v_period.id AND l.status='active';

    SELECT COALESCE(sum(k.amount),0) INTO v_khala_total
    FROM public.khala_money_entries k
    WHERE k.hostel_id=p_hostel_id AND k.period_id=v_period.id AND k.status='active';

    SELECT count(*) INTO v_pending_requests
    FROM public.meal_requests r
    WHERE r.hostel_id=p_hostel_id AND r.period_id=v_period.id AND r.status='submitted';

  ELSE
    -- Detail rows were intentionally purged; serve only the durable saved
    -- aggregate snapshot and clearly flag that source to the UI.
    v_period_id := v_saved.period_id;
    v_period_days := GREATEST(0,(v_saved.end_date-v_saved.start_date)+1);
    v_period_json := jsonb_build_object(
      'id',v_saved.period_id,'label',v_saved.period_label,'status','saved_summary',
      'start_date',v_saved.start_date,'end_date',v_saved.end_date,
      'snapshot_only',true,'archived_at',v_saved.archived_at
    );

    SELECT
      COALESCE(sum((item->>'total')::numeric) FILTER (WHERE item->>'type'='deposit' AND item->>'status'='active' AND (item->>'total')::numeric>0),0),
      COALESCE(sum((item->>'total')::numeric) FILTER (WHERE item->>'type'='market_deposit' AND item->>'status'='active' AND (item->>'total')::numeric>0),0),
      COALESCE(sum(abs(least((item->>'total')::numeric,0))) FILTER (WHERE item->>'type'='other_expense' AND item->>'status'='active'),0),
      COALESCE(sum((item->>'total')::numeric) FILTER (WHERE item->>'type'='adjustment' AND item->>'status'='active'),0)
      INTO v_cash_deposit,v_market_credit,v_other_expense,v_adjustments
    FROM jsonb_array_elements(COALESCE(v_saved.summary->'ledger_totals','[]'::jsonb)) AS ledger_rows(item);

    v_market_total := COALESCE(NULLIF(v_saved.summary->>'market_total','')::numeric,0);
    v_khala_total := COALESCE(NULLIF(v_saved.summary->>'khala_total','')::numeric,0);
    v_breakfast := COALESCE(NULLIF(v_saved.summary#>>'{meal_total,breakfast}','')::numeric,0);
    v_lunch := COALESCE(NULLIF(v_saved.summary#>>'{meal_total,lunch}','')::numeric,0);
    v_dinner := COALESCE(NULLIF(v_saved.summary#>>'{meal_total,dinner}','')::numeric,0);
    v_period_members := NULL;
    v_active_members := NULL;
    v_assistant_count := NULL;
    v_manager_assigned := NULL;
    v_finalized_days := NULL;
    v_cancelled_days := NULL;
    v_market_entries := NULL;
    v_pending_requests := NULL;
  END IF;

  v_total_meals := v_breakfast+v_lunch+v_dinner;
  v_operating_expenses := v_market_total+v_other_expense+v_khala_total;

  v_summary := jsonb_build_object(
    'source',CASE WHEN v_period_found THEN 'live_detail' ELSE 'saved_archive' END,
    'period_members',v_period_members,
    'active_members_now',v_active_members,
    'assistant_manager_count',v_assistant_count,
    'primary_manager_assigned',v_manager_assigned,
    'period_days',v_period_days,
    'finalized_days',v_finalized_days,
    'cancelled_days',v_cancelled_days,
    'finalized_days_percent',CASE WHEN v_period_found AND v_period_days>0 THEN round((v_finalized_days::numeric/v_period_days)*100,1) ELSE NULL END,
    'finalized_breakfast',v_breakfast,
    'finalized_lunch',v_lunch,
    'finalized_dinner',v_dinner,
    'finalized_meals_total',v_total_meals,
    'market_entry_count',v_market_entries,
    'market_total',v_market_total,
    'cash_deposit_total',v_cash_deposit,
    'market_credit_total',v_market_credit,
    'other_expense_total',v_other_expense,
    'khala_expense_total',v_khala_total,
    'adjustment_net',v_adjustments,
    'operating_expense_total',v_operating_expenses,
    'meal_rate',CASE WHEN v_total_meals>0 THEN round(v_market_total/v_total_meals,4) ELSE 0 END,
    'pending_meal_requests',v_pending_requests,
    'snapshot_only',NOT v_period_found
  );

  RETURN jsonb_build_object(
    'hostel',jsonb_build_object('id',v_hostel.id,'name',v_hostel.name,
      'platform_status',v_hostel.platform_status,'created_at',v_hostel.created_at),
    'periods',v_periods,
    'selected_period_id',v_period_id,
    'period',v_period_json,
    'summary',v_summary,
    'generated_at',now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.platform_admin_get_hostel_insights(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_hostel_insights(uuid,uuid) TO authenticated;
COMMENT ON FUNCTION public.platform_admin_get_hostel_insights(uuid,uuid) IS
  'Super Admin only. Returns aggregated hostel/period insights; never returns member-level financial or meal rows.';

COMMIT;
