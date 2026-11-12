-- Run46: read-only post-deployment verification. No writes are performed.
WITH checks AS (
  SELECT 'Activity capture trigger function' AS check_name,
    CASE WHEN to_regprocedure('private.hl_capture_activity_event()') IS NOT NULL
      AND pg_get_functiondef(to_regprocedure('private.hl_capture_activity_event()')) ILIKE '%suppress_activity_capture%'
      AND pg_get_functiondef(to_regprocedure('private.hl_capture_activity_event()')) ILIKE '%TG_TABLE_NAME=''daily_meal_days'' AND TG_OP=''INSERT''%'
    THEN 'PASS' ELSE 'FAIL' END AS status,
    'Calendar-day seed inserts no longer create one Activity event per date; bulk system transitions can suppress row-level noise.' AS details
  UNION ALL SELECT 'Finalization summary event function',
    CASE WHEN to_regprocedure('private.finalize_due_days(uuid,uuid)') IS NOT NULL
      AND pg_get_functiondef(to_regprocedure('private.finalize_due_days(uuid,uuid)')) ILIKE '%meal_day.auto_finalized%'
      AND pg_get_functiondef(to_regprocedure('private.finalize_due_days(uuid,uuid)')) ILIKE '%finalized_meal_record_count%'
    THEN 'PASS' ELSE 'FAIL' END,
    'Business day/meal rows are updated normally, with one compact Activity summary per bulk finalization.'
  UNION ALL SELECT 'Daily meal date uniqueness retained',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid='public.daily_meal_days'::regclass AND c.contype='u'
        AND (SELECT array_agg(a.attname ORDER BY k.ord)
             FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
             JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)
            = ARRAY['period_id','meal_date']::name[]
    ) THEN 'PASS' ELSE 'FAIL' END,
    'The unique(period_id, meal_date) constraint continues to prevent duplicate calendar-day records.'
  UNION ALL SELECT 'Security RPC one-minute counter retained',
    CASE WHEN to_regprocedure('public.platform_admin_list_security_events_v4(text,text,text,text,timestamptz,timestamptz,integer,integer)') IS NOT NULL
      AND to_regprocedure('public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer)') IS NOT NULL
      AND pg_get_functiondef(to_regprocedure('public.platform_admin_list_security_events_v3(text,text,text,text,timestamptz,timestamptz,integer,integer)')) ILIKE '%ip_attempts_1m%'
    THEN 'PASS' ELSE 'FAIL' END,
    'V4 carries the V3 result; V3 computes a rolling last-60-seconds IP failure count beside the 15-minute count.'
  UNION ALL SELECT 'IP security controls retained',
    CASE WHEN to_regprocedure('public.platform_admin_add_security_ip_block(text,text,integer,text)') IS NOT NULL
      AND to_regprocedure('public.platform_admin_release_security_ip_block(text,text)') IS NOT NULL
      AND to_regclass('private.hl_security_ip_blocks') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END,
    'Manual IP block/release objects remain present; event IP and block policy data are not removed.'
  UNION ALL SELECT 'Database-side IP-only write guard',
    CASE WHEN to_regprocedure('private.hl_enforce_ip_only_security_metadata()') IS NOT NULL
      AND (SELECT count(*) FROM pg_trigger WHERE tgname='hl_enforce_ip_only_geo' AND NOT tgisinternal) = 3
    THEN 'PASS' ELSE 'FAIL' END,
    'All three private security telemetry tables reject new country/city/region metadata at the database boundary.'
  UNION ALL SELECT 'Historical geo values cleared from event logs',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM private.hl_security_events
      WHERE country_code IS NOT NULL OR city IS NOT NULL OR region IS NOT NULL OR region_code IS NOT NULL
    ) THEN 'PASS' ELSE 'FAIL' END,
    'Only country/city/region metadata is cleared. IP, timestamps, fingerprints and event fields remain.'
  UNION ALL SELECT 'Historical geo values cleared from IP blocks',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM private.hl_security_ip_blocks
      WHERE country_code IS NOT NULL OR city IS NOT NULL OR region IS NOT NULL OR region_code IS NOT NULL
    ) THEN 'PASS' ELSE 'FAIL' END,
    'Block scope, IP, reason, attempt count and expiry remain unchanged.'
  UNION ALL SELECT 'Historical geo values cleared from reset attempts',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM private.hl_password_reset_ip_attempts
      WHERE country_code IS NOT NULL OR city IS NOT NULL OR region IS NOT NULL OR region_code IS NOT NULL
    ) THEN 'PASS' ELSE 'FAIL' END,
    'Reset quota rows keep IP, timestamps and email fingerprint while dropping location metadata.'
)
SELECT check_name,status,details FROM checks ORDER BY check_name;

-- Safe aggregate check: the migration does not delete existing Activity Log history.
SELECT event_type,source_table,count(*) AS retained_events,
       min(created_at) AS oldest_event,max(created_at) AS newest_event
FROM private.hl_activity_events
WHERE created_at >= now()-interval '30 days'
  AND (event_type LIKE 'meal_day.%' OR source_table='daily_meal_days')
GROUP BY event_type,source_table
ORDER BY retained_events DESC,event_type;
