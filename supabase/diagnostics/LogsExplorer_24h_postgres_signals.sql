-- Run only if the 24h source summary shows postgres_logs is a material contributor.
-- Supabase SQL Editor → query source: Logs (ClickHouse), time picker: last 24 hours.
SELECT log_attributes['parsed.error_severity'] AS severity,
       log_attributes['parsed.sql_state_code'] AS sqlstate,
       log_attributes['parsed.command_tag'] AS command_tag,
       count() AS event_count
FROM logs
WHERE source='postgres_logs'
  AND timestamp >= now() - INTERVAL 24 HOUR
  AND timestamp < now()
GROUP BY severity,sqlstate,command_tag
ORDER BY event_count DESC
LIMIT 50;
