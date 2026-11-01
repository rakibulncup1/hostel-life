-- ============================================================================
-- HOSTEL LIFE — PHASE 3: SYSTEM HEALTH, NOTICE MONITORING & REPORT EXPORT
-- Run after Run25. Read-only, Super Admin-only aggregate endpoints.
-- No tables/columns/RLS policies/triggers/data changes are created or modified.
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $preflight$
DECLARE
  v_missing_tables text;
  v_missing_columns text;
BEGIN
  SELECT string_agg(t, ', ' ORDER BY t) INTO v_missing_tables
  FROM unnest(ARRAY[
    'hostels','profiles','hostel_memberships','monthly_periods','period_assistant_managers',
    'market_entries','ledger_transactions','khala_money_entries','meal_requests',
    'daily_meal_days','daily_meal_records','platform_settings',
    'hostel_pinned_announcements','hl_archived_final_summaries'
  ]) AS req(t)
  WHERE to_regclass('public.' || t) IS NULL;
  IF v_missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Run26 blocked; required tables missing: %', v_missing_tables;
  END IF;

  SELECT string_agg(x.table_name || '.' || x.column_name, ', ' ORDER BY x.table_name, x.column_name)
    INTO v_missing_columns
  FROM (VALUES
    ('hostels','id'),('hostels','name'),('hostels','platform_status'),('hostels','created_at'),('hostels','updated_at'),
    ('profiles','id'),('profiles','full_name'),('profiles','is_blocked'),
    ('hostel_memberships','id'),('hostel_memberships','hostel_id'),('hostel_memberships','user_id'),('hostel_memberships','status'),
    ('monthly_periods','id'),('monthly_periods','hostel_id'),('monthly_periods','label'),('monthly_periods','start_date'),('monthly_periods','end_date'),('monthly_periods','status'),('monthly_periods','primary_manager_membership_id'),('monthly_periods','created_at'),
    ('period_assistant_managers','period_id'),('period_assistant_managers','hostel_id'),('period_assistant_managers','membership_id'),
    ('market_entries','hostel_id'),('market_entries','period_id'),('market_entries','entry_date'),('market_entries','status'),('market_entries','total_amount'),('market_entries','updated_at'),
    ('ledger_transactions','hostel_id'),('ledger_transactions','period_id'),('ledger_transactions','entry_date'),('ledger_transactions','ledger_type'),('ledger_transactions','amount'),('ledger_transactions','status'),('ledger_transactions','updated_at'),
    ('khala_money_entries','hostel_id'),('khala_money_entries','period_id'),('khala_money_entries','payment_date'),('khala_money_entries','amount'),('khala_money_entries','status'),('khala_money_entries','updated_at'),
    ('meal_requests','hostel_id'),('meal_requests','period_id'),('meal_requests','status'),('meal_requests','submitted_at'),('meal_requests','updated_at'),
    ('daily_meal_days','hostel_id'),('daily_meal_days','period_id'),('daily_meal_days','meal_date'),('daily_meal_days','status'),
    ('daily_meal_records','hostel_id'),('daily_meal_records','period_id'),('daily_meal_records','daily_meal_day_id'),('daily_meal_records','cancelled'),
    ('daily_meal_records','final_breakfast'),('daily_meal_records','actual_breakfast'),('daily_meal_records','planned_breakfast'),
    ('daily_meal_records','final_lunch'),('daily_meal_records','actual_lunch'),('daily_meal_records','planned_lunch'),
    ('daily_meal_records','final_dinner'),('daily_meal_records','actual_dinner'),('daily_meal_records','planned_dinner'),
    ('platform_settings','announcement_enabled'),('platform_settings','announcement_title'),('platform_settings','announcement_body'),('platform_settings','updated_by'),('platform_settings','updated_at'),
    ('hostel_pinned_announcements','hostel_id'),('hostel_pinned_announcements','title'),('hostel_pinned_announcements','body'),('hostel_pinned_announcements','created_by'),('hostel_pinned_announcements','created_at'),('hostel_pinned_announcements','updated_at'),
    ('hl_archived_final_summaries','hostel_id'),('hl_archived_final_summaries','period_id'),('hl_archived_final_summaries','period_label'),('hl_archived_final_summaries','start_date'),('hl_archived_final_summaries','end_date'),('hl_archived_final_summaries','summary'),('hl_archived_final_summaries','purged_at')
  ) AS x(table_name,column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=x.table_name AND c.column_name=x.column_name
  );
  IF v_missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Run26 blocked; required columns missing: %', v_missing_columns;
  END IF;

  IF to_regprocedure('private.assert_signed_in()') IS NULL
     OR to_regprocedure('private.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'Run26 blocked; Super Admin security helpers are missing.';
  END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1) System Health: operational signals only; no member-level personal data.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_admin_get_system_health(p_stale_days integer DEFAULT 14)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stale_days integer := LEAST(GREATEST(COALESCE(p_stale_days,14),7),60);
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='শুধু Super Admin System Health দেখতে পারবেন।', ERRCODE='42501';
  END IF;

  WITH running_period AS (
    SELECT DISTINCT ON (p.hostel_id)
      p.id,p.hostel_id,p.label,p.start_date,p.end_date,p.primary_manager_membership_id,p.created_at
    FROM public.monthly_periods p
    WHERE p.status='running'
    ORDER BY p.hostel_id,p.start_date DESC,p.created_at DESC
  ),
  member_counts AS (
    SELECT m.hostel_id,
      count(*) FILTER (WHERE m.status='active' AND NOT COALESCE(pr.is_blocked,false))::bigint AS active_members,
      count(*) FILTER (WHERE m.status='inactive')::bigint AS inactive_members
    FROM public.hostel_memberships m
    LEFT JOIN public.profiles pr ON pr.id=m.user_id
    GROUP BY m.hostel_id
  ),
  pending_counts AS (
    SELECT r.hostel_id,count(*)::bigint AS pending_requests
    FROM public.meal_requests r
    JOIN running_period rp ON rp.id=r.period_id
    WHERE r.status='submitted'
    GROUP BY r.hostel_id
  ),
  activity AS (
    SELECT q.hostel_id,max(q.activity_at) AS last_activity_at
    FROM (
      SELECT e.hostel_id,e.updated_at AS activity_at FROM public.market_entries e WHERE e.status='active'
      UNION ALL
      SELECT l.hostel_id,l.updated_at FROM public.ledger_transactions l WHERE l.status='active'
      UNION ALL
      SELECT k.hostel_id,k.updated_at FROM public.khala_money_entries k WHERE k.status='active'
      UNION ALL
      SELECT r.hostel_id,r.updated_at FROM public.meal_requests r WHERE r.status IN ('submitted','approved','rejected')
    ) q
    GROUP BY q.hostel_id
  ),
  base AS (
    SELECT h.id AS hostel_id,h.name AS hostel_name,h.platform_status,h.created_at AS hostel_created_at,
      rp.id AS running_period_id,rp.label AS running_period_label,rp.created_at AS period_created_at,
      rp.primary_manager_membership_id,
      COALESCE(mc.active_members,0)::bigint AS active_members,
      COALESCE(mc.inactive_members,0)::bigint AS inactive_members,
      COALESCE(pc.pending_requests,0)::bigint AS pending_requests,
      pm.id AS primary_membership_found,pm.status AS primary_membership_status,
      pp.id AS primary_user_found,
      COALESCE(pp.is_blocked,false) AS primary_user_blocked,
      act.last_activity_at,
      GREATEST(
        COALESCE(act.last_activity_at,'epoch'::timestamptz),
        COALESCE(rp.created_at,'epoch'::timestamptz),
        h.created_at
      ) AS activity_reference_at
    FROM public.hostels h
    LEFT JOIN running_period rp ON rp.hostel_id=h.id
    LEFT JOIN member_counts mc ON mc.hostel_id=h.id
    LEFT JOIN pending_counts pc ON pc.hostel_id=h.id
    LEFT JOIN public.hostel_memberships pm ON pm.id=rp.primary_manager_membership_id AND pm.hostel_id=h.id
    LEFT JOIN public.profiles pp ON pp.id=pm.user_id
    LEFT JOIN activity act ON act.hostel_id=h.id
  ),
  annotated AS (
    SELECT b.*,
      array_remove(ARRAY[
        CASE WHEN b.platform_status='suspended' THEN 'hostel_suspended' END,
        CASE WHEN b.platform_status='active' AND b.running_period_id IS NULL
          AND b.hostel_created_at < now()-interval '48 hours' THEN 'missing_running_period' END,
        CASE WHEN b.platform_status='active' AND b.active_members=0
          AND b.hostel_created_at < now()-interval '48 hours' THEN 'no_active_members' END,
        CASE WHEN b.running_period_id IS NOT NULL AND (
          b.primary_manager_membership_id IS NULL OR b.primary_membership_found IS NULL
          OR b.primary_membership_status<>'active' OR b.primary_user_found IS NULL OR b.primary_user_blocked
        ) THEN 'primary_manager_unavailable' END,
        CASE WHEN b.platform_status='active' AND b.running_period_id IS NOT NULL AND b.active_members>0
          AND b.activity_reference_at < now()-make_interval(days=>v_stale_days) THEN 'stale_activity' END,
        CASE WHEN b.platform_status='active' AND b.pending_requests>=8 THEN 'pending_request_backlog' END
      ]::text[],NULL) AS issue_codes
    FROM base b
  ),
  health_rows AS (
    SELECT a.*,
      CASE
        WHEN 'primary_manager_unavailable'=ANY(a.issue_codes) THEN 'critical'
        WHEN 'missing_running_period'=ANY(a.issue_codes)
          OR 'no_active_members'=ANY(a.issue_codes)
          OR 'stale_activity'=ANY(a.issue_codes)
          OR 'pending_request_backlog'=ANY(a.issue_codes) THEN 'warning'
        WHEN 'hostel_suspended'=ANY(a.issue_codes) THEN 'info'
        ELSE 'healthy'
      END AS severity
    FROM annotated a
  ),
  counts AS (
    SELECT count(*)::bigint AS hostel_count,
      count(*) FILTER (WHERE severity='healthy')::bigint AS healthy_hostel_count,
      count(*) FILTER (WHERE severity='critical')::bigint AS critical_hostel_count,
      count(*) FILTER (WHERE severity='warning')::bigint AS warning_hostel_count,
      count(*) FILTER (WHERE severity='info')::bigint AS info_hostel_count,
      count(*) FILTER (WHERE 'missing_running_period'=ANY(issue_codes))::bigint AS missing_running_period_count,
      count(*) FILTER (WHERE 'no_active_members'=ANY(issue_codes))::bigint AS no_active_members_count,
      count(*) FILTER (WHERE 'primary_manager_unavailable'=ANY(issue_codes))::bigint AS primary_manager_unavailable_count,
      count(*) FILTER (WHERE 'stale_activity'=ANY(issue_codes))::bigint AS stale_activity_count,
      count(*) FILTER (WHERE 'pending_request_backlog'=ANY(issue_codes))::bigint AS pending_request_backlog_count,
      count(*) FILTER (WHERE 'hostel_suspended'=ANY(issue_codes))::bigint AS suspended_hostel_count
    FROM health_rows
  ),
  items AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'hostel_id',h.hostel_id,'hostel_name',h.hostel_name,'platform_status',h.platform_status,
      'severity',h.severity,'issue_codes',to_jsonb(h.issue_codes),
      'running_period_id',h.running_period_id,'running_period_label',h.running_period_label,
      'active_members',h.active_members,'inactive_members',h.inactive_members,
      'pending_requests',h.pending_requests,'last_activity_at',h.last_activity_at,
      'activity_reference_at',h.activity_reference_at
    ) ORDER BY CASE h.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 ELSE 4 END,
      h.activity_reference_at ASC,h.hostel_name), '[]'::jsonb) AS value
    FROM health_rows h
    WHERE cardinality(h.issue_codes)>0
  )
  SELECT jsonb_build_object(
    'generated_at',now(),
    'stale_days',v_stale_days,
    'pending_request_threshold',8,
    'new_hostel_setup_grace_hours',48,
    'totals',to_jsonb(c),
    'items',i.value
  ) INTO v_result
  FROM counts c CROSS JOIN items i;

  RETURN COALESCE(v_result,'{}'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Notice monitoring: one global message + hostel-scoped active messages.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_admin_list_notice_monitoring(
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit,25),1),100);
  v_offset integer := LEAST(GREATEST(COALESCE(p_offset,0),0),1000000);
  v_search text := LOWER(NULLIF(LEFT(BTRIM(COALESCE(p_search,'')),120),''));
  v_global jsonb;
  v_items jsonb;
  v_total bigint := 0;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='শুধু Super Admin নোটিশ পর্যবেক্ষণ করতে পারবেন।', ERRCODE='42501';
  END IF;

  SELECT jsonb_build_object(
    'enabled',s.announcement_enabled,
    'title',s.announcement_title,
    'body',s.announcement_body,
    'updated_at',s.updated_at,
    'updated_by_name',COALESCE(NULLIF(p.full_name,''),'অজানা অ্যাকাউন্ট')
  ) INTO v_global
  FROM public.platform_settings s
  LEFT JOIN public.profiles p ON p.id=s.updated_by
  WHERE s.singleton=true;

  SELECT count(*) INTO v_total
  FROM public.hostel_pinned_announcements a
  JOIN public.hostels h ON h.id=a.hostel_id
  LEFT JOIN public.profiles p ON p.id=a.created_by
  WHERE v_search IS NULL OR POSITION(v_search IN LOWER(CONCAT_WS(' ',h.name,a.title,a.body,p.full_name,h.platform_status)))>0;

  SELECT COALESCE(jsonb_agg(q.item ORDER BY q.updated_at DESC,q.hostel_name),'[]'::jsonb)
    INTO v_items
  FROM (
    SELECT a.updated_at,h.name AS hostel_name,
      jsonb_build_object(
        'hostel_id',h.id,'hostel_name',h.name,'hostel_status',h.platform_status,
        'title',a.title,'body',a.body,'created_at',a.created_at,'updated_at',a.updated_at,
        'created_by_name',COALESCE(NULLIF(p.full_name,''),'অজানা অ্যাকাউন্ট'),
        'active_member_count',(SELECT count(*) FROM public.hostel_memberships m
          JOIN public.profiles mp ON mp.id=m.user_id
          WHERE m.hostel_id=h.id AND m.status='active' AND NOT mp.is_blocked)
      ) AS item
    FROM public.hostel_pinned_announcements a
    JOIN public.hostels h ON h.id=a.hostel_id
    LEFT JOIN public.profiles p ON p.id=a.created_by
    WHERE v_search IS NULL OR POSITION(v_search IN LOWER(CONCAT_WS(' ',h.name,a.title,a.body,p.full_name,h.platform_status)))>0
    ORDER BY a.updated_at DESC,h.name
    OFFSET v_offset LIMIT v_limit
  ) q;

  RETURN jsonb_build_object(
    'global_notice',COALESCE(v_global,jsonb_build_object('enabled',false,'title','','body','')),
    'items',COALESCE(v_items,'[]'::jsonb),
    'total_count',v_total,'limit',v_limit,'offset',v_offset,
    'has_more',(v_offset+jsonb_array_length(COALESCE(v_items,'[]'::jsonb)))<v_total,
    'generated_at',now()
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Date-bounded platform report. All output is hostel-level aggregate only.
-- Purged archive snapshots are included only when the full month fits in the
-- requested range; partial snapshot months are counted as excluded so totals
-- are never silently prorated or misrepresented.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_admin_get_platform_report(
  p_from_date date,
  p_to_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM private.assert_signed_in();
  IF NOT private.is_super_admin() THEN
    RAISE EXCEPTION USING MESSAGE='শুধু Super Admin প্ল্যাটফর্ম রিপোর্ট তৈরি করতে পারবেন।', ERRCODE='42501';
  END IF;
  IF p_from_date IS NULL OR p_to_date IS NULL OR p_to_date<p_from_date THEN
    RAISE EXCEPTION USING MESSAGE='রিপোর্টের তারিখ সঠিক নয়।', ERRCODE='22023';
  END IF;
  IF p_to_date-p_from_date>366 THEN
    RAISE EXCEPTION USING MESSAGE='একটি রিপোর্টে সর্বোচ্চ ৩৬৭ দিনের পরিসর নির্বাচন করা যাবে।', ERRCODE='22023';
  END IF;

  WITH period_scope AS (
    SELECT p.id,p.hostel_id,p.start_date,p.end_date,p.status
    FROM public.monthly_periods p
    WHERE p.start_date<=p_to_date AND p.end_date>=p_from_date
  ),
  live_period_counts AS (
    SELECT p.hostel_id,count(*)::bigint AS period_count
    FROM period_scope p GROUP BY p.hostel_id
  ),
  meal_totals AS (
    SELECT d.hostel_id,count(DISTINCT d.id) FILTER (WHERE d.status='finalized')::bigint AS finalized_days,
      COALESCE(sum(COALESCE(r.final_breakfast,r.actual_breakfast,r.planned_breakfast,0)) FILTER (WHERE d.status='finalized' AND NOT r.cancelled),0) AS breakfast,
      COALESCE(sum(COALESCE(r.final_lunch,r.actual_lunch,r.planned_lunch,0)) FILTER (WHERE d.status='finalized' AND NOT r.cancelled),0) AS lunch,
      COALESCE(sum(COALESCE(r.final_dinner,r.actual_dinner,r.planned_dinner,0)) FILTER (WHERE d.status='finalized' AND NOT r.cancelled),0) AS dinner
    FROM public.daily_meal_days d
    JOIN period_scope ps ON ps.id=d.period_id
    LEFT JOIN public.daily_meal_records r ON r.daily_meal_day_id=d.id
    WHERE d.meal_date BETWEEN p_from_date AND p_to_date
    GROUP BY d.hostel_id
  ),
  market_totals AS (
    SELECT e.hostel_id,count(*)::bigint AS market_entry_count,COALESCE(sum(e.total_amount),0) AS market_total
    FROM public.market_entries e
    JOIN period_scope ps ON ps.id=e.period_id
    WHERE e.status='active' AND e.entry_date BETWEEN p_from_date AND p_to_date
    GROUP BY e.hostel_id
  ),
  ledger_totals AS (
    SELECT l.hostel_id,
      COALESCE(sum(l.amount) FILTER (WHERE l.ledger_type='deposit' AND l.amount>0),0) AS cash_deposit,
      COALESCE(sum(l.amount) FILTER (WHERE l.ledger_type='market_deposit' AND l.amount>0),0) AS market_credit,
      COALESCE(sum(abs(least(l.amount,0))) FILTER (WHERE l.ledger_type='other_expense'),0) AS other_expense,
      COALESCE(sum(l.amount) FILTER (WHERE l.ledger_type='adjustment'),0) AS adjustment_net
    FROM public.ledger_transactions l
    JOIN period_scope ps ON ps.id=l.period_id
    WHERE l.status='active' AND l.entry_date BETWEEN p_from_date AND p_to_date
    GROUP BY l.hostel_id
  ),
  khala_totals AS (
    SELECT k.hostel_id,COALESCE(sum(k.amount),0) AS khala_expense
    FROM public.khala_money_entries k
    JOIN period_scope ps ON ps.id=k.period_id
    WHERE k.status='active' AND k.payment_date BETWEEN p_from_date AND p_to_date
    GROUP BY k.hostel_id
  ),
  pending_totals AS (
    SELECT r.hostel_id,count(*)::bigint AS pending_requests
    FROM public.meal_requests r
    JOIN period_scope ps ON ps.id=r.period_id
    WHERE r.status='submitted'
      AND (r.submitted_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN p_from_date AND p_to_date
    GROUP BY r.hostel_id
  ),
  snapshot_rows AS (
    SELECT s.*,
      (p_from_date<=s.start_date AND p_to_date>=s.end_date) AS fully_covered
    FROM public.hl_archived_final_summaries s
    WHERE s.purged_at IS NOT NULL
      AND s.start_date<=p_to_date AND s.end_date>=p_from_date
      AND NOT EXISTS (SELECT 1 FROM public.monthly_periods p WHERE p.id=s.period_id)
  ),
  snapshot_totals AS (
    SELECT s.hostel_id,
      count(*) FILTER (WHERE s.fully_covered)::bigint AS snapshot_period_count,
      count(*) FILTER (WHERE NOT s.fully_covered)::bigint AS snapshot_partial_excluded,
      COALESCE(sum(CASE WHEN s.fully_covered THEN COALESCE(NULLIF(s.summary->>'market_total','')::numeric,0) ELSE 0 END),0) AS market_total,
      COALESCE(sum(CASE WHEN s.fully_covered THEN COALESCE(NULLIF(s.summary->>'khala_total','')::numeric,0) ELSE 0 END),0) AS khala_expense,
      COALESCE(sum(CASE WHEN s.fully_covered THEN COALESCE(NULLIF(s.summary#>>'{meal_total,breakfast}','')::numeric,0) ELSE 0 END),0) AS breakfast,
      COALESCE(sum(CASE WHEN s.fully_covered THEN COALESCE(NULLIF(s.summary#>>'{meal_total,lunch}','')::numeric,0) ELSE 0 END),0) AS lunch,
      COALESCE(sum(CASE WHEN s.fully_covered THEN COALESCE(NULLIF(s.summary#>>'{meal_total,dinner}','')::numeric,0) ELSE 0 END),0) AS dinner,
      COALESCE(sum(CASE WHEN s.fully_covered THEN COALESCE((
        SELECT sum((item->>'amount')::numeric) FROM jsonb_array_elements(COALESCE(s.summary->'ledger_totals','[]'::jsonb)) AS ledger_rows(item)
        WHERE item->>'type'='deposit' AND item->>'status'='active' AND (item->>'amount')::numeric>0
      ),0) ELSE 0 END),0) AS cash_deposit,
      COALESCE(sum(CASE WHEN s.fully_covered THEN COALESCE((
        SELECT sum((item->>'amount')::numeric) FROM jsonb_array_elements(COALESCE(s.summary->'ledger_totals','[]'::jsonb)) AS ledger_rows(item)
        WHERE item->>'type'='market_deposit' AND item->>'status'='active' AND (item->>'amount')::numeric>0
      ),0) ELSE 0 END),0) AS market_credit,
      COALESCE(sum(CASE WHEN s.fully_covered THEN COALESCE((
        SELECT sum(abs(least((item->>'amount')::numeric,0))) FROM jsonb_array_elements(COALESCE(s.summary->'ledger_totals','[]'::jsonb)) AS ledger_rows(item)
        WHERE item->>'type'='other_expense' AND item->>'status'='active'
      ),0) ELSE 0 END),0) AS other_expense,
      COALESCE(sum(CASE WHEN s.fully_covered THEN COALESCE((
        SELECT sum((item->>'amount')::numeric) FROM jsonb_array_elements(COALESCE(s.summary->'ledger_totals','[]'::jsonb)) AS ledger_rows(item)
        WHERE item->>'type'='adjustment' AND item->>'status'='active'
      ),0) ELSE 0 END),0) AS adjustment_net
    FROM snapshot_rows s GROUP BY s.hostel_id
  ),
  hostel_rows AS (
    SELECT h.id AS hostel_id,h.name AS hostel_name,h.platform_status,
      COALESCE(pc.period_count,0)+COALESCE(st.snapshot_period_count,0)+COALESCE(st.snapshot_partial_excluded,0) AS periods_in_range,
      COALESCE(pc.period_count,0) AS detailed_periods,
      COALESCE(st.snapshot_period_count,0) AS snapshot_periods,
      COALESCE(st.snapshot_partial_excluded,0) AS snapshot_partial_excluded,
      COALESCE(mt.finalized_days,0) AS finalized_days,
      COALESCE(mt.breakfast,0)+COALESCE(st.breakfast,0) AS breakfast,
      COALESCE(mt.lunch,0)+COALESCE(st.lunch,0) AS lunch,
      COALESCE(mt.dinner,0)+COALESCE(st.dinner,0) AS dinner,
      COALESCE(mkt.market_entry_count,0) AS market_entry_count,
      COALESCE(mkt.market_total,0)+COALESCE(st.market_total,0) AS market_total,
      COALESCE(lt.cash_deposit,0)+COALESCE(st.cash_deposit,0) AS cash_deposit,
      COALESCE(lt.market_credit,0)+COALESCE(st.market_credit,0) AS market_credit,
      COALESCE(lt.other_expense,0)+COALESCE(st.other_expense,0) AS other_expense,
      COALESCE(kt.khala_expense,0)+COALESCE(st.khala_expense,0) AS khala_expense,
      COALESCE(lt.adjustment_net,0)+COALESCE(st.adjustment_net,0) AS adjustment_net,
      COALESCE(pt.pending_requests,0) AS pending_requests
    FROM public.hostels h
    LEFT JOIN live_period_counts pc ON pc.hostel_id=h.id
    LEFT JOIN meal_totals mt ON mt.hostel_id=h.id
    LEFT JOIN market_totals mkt ON mkt.hostel_id=h.id
    LEFT JOIN ledger_totals lt ON lt.hostel_id=h.id
    LEFT JOIN khala_totals kt ON kt.hostel_id=h.id
    LEFT JOIN pending_totals pt ON pt.hostel_id=h.id
    LEFT JOIN snapshot_totals st ON st.hostel_id=h.id
  ),
  report_rows AS (
    SELECT hr.*,
      hr.breakfast+hr.lunch+hr.dinner AS total_meals,
      hr.market_total+hr.other_expense+hr.khala_expense AS operating_expense,
      CASE WHEN hr.breakfast+hr.lunch+hr.dinner>0
        THEN round(hr.market_total/(hr.breakfast+hr.lunch+hr.dinner),4) ELSE 0 END AS meal_rate
    FROM hostel_rows hr
  ),
  totals AS (
    SELECT count(*)::bigint AS hostel_count,
      count(*) FILTER (WHERE platform_status='active')::bigint AS active_hostel_count,
      count(*) FILTER (WHERE platform_status='suspended')::bigint AS suspended_hostel_count,
      COALESCE(sum(periods_in_range),0)::bigint AS periods_in_range,
      COALESCE(sum(detailed_periods),0)::bigint AS detailed_periods,
      COALESCE(sum(snapshot_periods),0)::bigint AS snapshot_periods,
      COALESCE(sum(snapshot_partial_excluded),0)::bigint AS snapshot_partial_excluded,
      COALESCE(sum(finalized_days),0)::bigint AS finalized_days,
      COALESCE(sum(breakfast),0) AS breakfast,
      COALESCE(sum(lunch),0) AS lunch,
      COALESCE(sum(dinner),0) AS dinner,
      COALESCE(sum(total_meals),0) AS total_meals,
      COALESCE(sum(market_entry_count),0)::bigint AS market_entry_count,
      COALESCE(sum(market_total),0) AS market_total,
      COALESCE(sum(cash_deposit),0) AS cash_deposit,
      COALESCE(sum(market_credit),0) AS market_credit,
      COALESCE(sum(other_expense),0) AS other_expense,
      COALESCE(sum(khala_expense),0) AS khala_expense,
      COALESCE(sum(adjustment_net),0) AS adjustment_net,
      COALESCE(sum(operating_expense),0) AS operating_expense,
      COALESCE(sum(pending_requests),0)::bigint AS pending_requests
    FROM report_rows
  ),
  items AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'hostel_id',r.hostel_id,'hostel_name',r.hostel_name,'platform_status',r.platform_status,
      'periods_in_range',r.periods_in_range,'detailed_periods',r.detailed_periods,
      'snapshot_periods',r.snapshot_periods,'snapshot_partial_excluded',r.snapshot_partial_excluded,
      'finalized_days',r.finalized_days,'breakfast',r.breakfast,'lunch',r.lunch,'dinner',r.dinner,
      'total_meals',r.total_meals,'market_entry_count',r.market_entry_count,'market_total',r.market_total,
      'cash_deposit',r.cash_deposit,'market_credit',r.market_credit,'other_expense',r.other_expense,
      'khala_expense',r.khala_expense,'adjustment_net',r.adjustment_net,
      'operating_expense',r.operating_expense,'meal_rate',r.meal_rate,'pending_requests',r.pending_requests
    ) ORDER BY r.hostel_name),'[]'::jsonb) AS value
    FROM report_rows r
  )
  SELECT jsonb_build_object(
    'from_date',p_from_date,'to_date',p_to_date,'generated_at',now(),
    'totals',to_jsonb(t),
    'items',i.value,
    'snapshot_note','পুরো সময়সীমায় থাকা সংরক্ষিত আর্কাইভ সামারি অন্তর্ভুক্ত। আংশিকভাবে মিলে যাওয়া সংরক্ষিত মাসের টাকা ও মিল যোগ করা হয়নি। সংরক্ষিত সামারিতে বাজার এন্ট্রির সংখ্যা ও চূড়ান্ত দিনের সংখ্যা থাকে না; এই দুই গণনা শুধু বিস্তারিত রেকর্ড থাকা মাসের জন্য।'
  ) INTO v_result
  FROM totals t CROSS JOIN items i;

  RETURN COALESCE(v_result,'{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.platform_admin_get_system_health(integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_list_notice_monitoring(integer,integer,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_admin_get_platform_report(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_system_health(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_notice_monitoring(integer,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_get_platform_report(date,date) TO authenticated;

COMMENT ON FUNCTION public.platform_admin_get_system_health(integer) IS
  'Super Admin-only read-only health signals; no personal member rows are returned.';
COMMENT ON FUNCTION public.platform_admin_list_notice_monitoring(integer,integer,text) IS
  'Super Admin-only read-only monitoring of global and hostel-scoped current notices.';
COMMENT ON FUNCTION public.platform_admin_get_platform_report(date,date) IS
  'Super Admin-only date-bounded hostel-level aggregate report; never returns member-level records.';

COMMIT;
