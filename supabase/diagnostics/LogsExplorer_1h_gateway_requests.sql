-- Run only if the 1h source summary shows edge_logs/API Gateway is a material contributor.
-- Supabase SQL Editor → query source: Logs (ClickHouse), time picker: last 1 hour.
SELECT log_attributes['request.path'] AS request_path,
       log_attributes['request.method'] AS request_method,
       log_attributes['response.status_code'] AS status_code,
       count() AS event_count
FROM logs
WHERE source='edge_logs'
  AND timestamp >= now() - INTERVAL 1 HOUR
  AND timestamp < now()
GROUP BY request_path,request_method,status_code
ORDER BY event_count DESC
LIMIT 50;
