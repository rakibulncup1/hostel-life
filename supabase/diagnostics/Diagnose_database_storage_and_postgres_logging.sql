-- READ ONLY — run in Supabase SQL Editor with source = Database.
-- This is diagnostic, not a migration. It does not reset statistics or change configuration.

-- 1) Actual Postgres database size (NOT the Supabase Logs Query metric).
SELECT current_database() AS database_name,
       pg_database_size(current_database()) AS database_bytes,
       pg_size_pretty(pg_database_size(current_database())) AS database_size_pretty;

-- 2) Largest application/extension relations, including indexes and TOAST.
SELECT n.nspname AS schema_name,
       c.relname AS relation_name,
       pg_total_relation_size(c.oid) AS total_bytes,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
       pg_size_pretty(pg_relation_size(c.oid)) AS heap_size,
       pg_size_pretty(pg_indexes_size(c.oid)) AS index_size,
       COALESCE(s.n_live_tup,0) AS estimated_live_rows,
       COALESCE(s.n_dead_tup,0) AS estimated_dead_rows,
       s.last_autovacuum,
       s.last_autoanalyze
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid
WHERE c.relkind IN ('r','m')
  AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 30;

-- 3) Top normalized statements by total execution time.
-- Query text is shown for owner diagnostics only; redact before sharing externally.
SELECT queryid, calls,
       round(total_exec_time::numeric,2) AS total_exec_ms,
       round(mean_exec_time::numeric,2) AS mean_exec_ms,
       rows,
       shared_blks_read,
       shared_blks_hit,
       temp_blks_written,
       left(query,600) AS normalized_query
FROM extensions.pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 25;

-- 4) Logging settings that can cause unusually high Logs Ingest.
-- Do not change settings until you have recorded the current values and reviewed Logs Ingest by source.
SELECT name, setting, unit, source, pending_restart
FROM pg_settings
WHERE name IN (
  'log_statement','log_min_messages','log_min_duration_statement',
  'log_connections','log_disconnections','log_duration',
  'log_autovacuum_min_duration','log_temp_files'
) OR name LIKE 'pgaudit.%'
ORDER BY name;

-- 5) Tables with significant dead tuples / frequent writes.
SELECT schemaname, relname,
       n_live_tup, n_dead_tup,
       n_tup_ins, n_tup_upd, n_tup_del,
       last_vacuum, last_autovacuum,
       last_analyze, last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC, (n_tup_ins+n_tup_upd+n_tup_del) DESC
LIMIT 30;

-- 6) Currently active queries/waits. SQL text clipped; do not share unredacted values.
SELECT pid, usename, application_name, state,
       wait_event_type, wait_event,
       now()-query_start AS query_age,
       left(query,500) AS query_excerpt
FROM pg_stat_activity
WHERE datname=current_database()
  AND pid<>pg_backend_pid()
  AND state<>'idle'
ORDER BY query_start NULLS LAST
LIMIT 30;
