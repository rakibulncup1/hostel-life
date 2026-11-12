-- Supabase SQL Editor → choose query source: Logs (ClickHouse), NOT Database.
-- Keep the Logs Explorer time picker at the last 1 hour. Run this source-summary query once first.
SELECT source,
       severity_text,
       count() AS event_count,
       min(timestamp) AS first_event_utc,
       max(timestamp) AS last_event_utc
FROM logs
WHERE timestamp >= now() - INTERVAL 1 HOUR
  AND timestamp < now()
GROUP BY source,severity_text
ORDER BY event_count DESC
LIMIT 100;
