-- READ ONLY: investigate meal-day Activity Log volume and actual duplicate day rows.
-- No INSERT/UPDATE/DELETE/TRUNCATE or statistics reset is performed.

-- 1) Distinguish Activity Log rows from actual meal-calendar rows.
SELECT event_type, count(*) AS activity_log_rows,
       count(DISTINCT target_id) AS distinct_targets,
       min(created_at) AS first_seen,max(created_at) AS last_seen
FROM private.hl_activity_events
WHERE source_table='daily_meal_days'
  AND created_at >= now()-interval '30 days'
GROUP BY event_type
ORDER BY activity_log_rows DESC,event_type;

-- 2) Actual duplicate calendar dates should be zero because of the unique key.
SELECT period_id,meal_date,count(*) AS rows_for_same_period_date
FROM public.daily_meal_days
GROUP BY period_id,meal_date
HAVING count(*)>1
ORDER BY rows_for_same_period_date DESC,meal_date DESC;

-- 3) Repeated same event type for the same day target can be real state changes;
-- inspect only aggregates here. Do not delete history automatically.
SELECT event_type,target_id,count(*) AS event_count,
       min(created_at) AS first_event,max(created_at) AS last_event
FROM private.hl_activity_events
WHERE source_table='daily_meal_days'
  AND created_at >= now()-interval '30 days'
GROUP BY event_type,target_id
HAVING count(*)>1
ORDER BY event_count DESC,last_event DESC
LIMIT 100;

-- 4) Compare calendar rows to recorded meal rows, without exposing member data.
SELECT d.period_id,d.status,count(DISTINCT d.id) AS calendar_days,
       count(r.id) AS meal_record_rows,
       count(DISTINCT d.meal_date) AS unique_dates
FROM public.daily_meal_days d
LEFT JOIN public.daily_meal_records r ON r.daily_meal_day_id=d.id
WHERE d.created_at >= now()-interval '30 days'
GROUP BY d.period_id,d.status
ORDER BY max(d.created_at) DESC;

-- 5) Confirm Activity capture has one trigger per intended source table.
-- Run27 creates these with DROP/CREATE, so each listed table should return count=1.
WITH expected_tables(table_name) AS (
  VALUES
    ('hostel_memberships'),('monthly_periods'),('daily_meal_days'),('daily_meal_records'),
    ('meal_requests'),('market_entries'),('market_entry_items'),('ledger_transactions'),
    ('khala_money_entries'),('period_assistant_managers'),('archive_edit_permissions'),
    ('notifications'),('platform_audit_log'),('profiles')
)
SELECT 'public' AS schema_name,e.table_name,
       count(t.oid) AS activity_capture_trigger_count,
       COALESCE(array_agg(t.tgname ORDER BY t.tgname) FILTER (WHERE t.oid IS NOT NULL),ARRAY[]::name[]) AS trigger_names
FROM expected_tables e
LEFT JOIN pg_class c ON c.relname=e.table_name AND c.relnamespace='public'::regnamespace
LEFT JOIN pg_trigger t ON t.tgrelid=c.oid AND NOT t.tgisinternal
  AND t.tgfoid=to_regprocedure('private.hl_capture_activity_event()')
GROUP BY e.table_name
ORDER BY e.table_name;
