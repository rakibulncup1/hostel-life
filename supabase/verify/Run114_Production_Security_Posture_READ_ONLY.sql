-- Hostel Life — Production Security Posture Audit (READ ONLY)
-- Run in Supabase SQL Editor using the postgres role.
-- This script DOES NOT change schema, data, policies, roles, or settings.
-- Review result sets manually; intended migrations do not prove live project state.

BEGIN;
SET TRANSACTION READ ONLY;

-- 1) Environment and client-schema privileges.
SELECT current_database() AS database_name,
       current_user AS executing_role,
       current_setting('server_version') AS postgres_version,
       now() AS checked_at;

SELECT n.nspname AS schema_name,
       has_schema_privilege('anon', n.oid, 'USAGE') AS anon_has_usage,
       has_schema_privilege('authenticated', n.oid, 'USAGE') AS authenticated_has_usage,
       has_schema_privilege('service_role', n.oid, 'USAGE') AS service_role_has_usage
FROM pg_namespace n
WHERE n.nspname IN ('public', 'private', 'storage')
ORDER BY n.nspname;

-- 2) RLS and grants for application tables and storage objects.
SELECT n.nspname AS schema_name,
       c.relname AS object_name,
       CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned table'
                      WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' ELSE c.relkind::text END AS object_type,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       COALESCE(pol.policy_count, 0) AS policy_count,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
       has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
       has_table_privilege('anon', c.oid, 'UPDATE') AS anon_update,
       has_table_privilege('anon', c.oid, 'DELETE') AS anon_delete,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
       has_table_privilege('authenticated', c.oid, 'INSERT') AS authenticated_insert,
       has_table_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update,
       has_table_privilege('authenticated', c.oid, 'DELETE') AS authenticated_delete,
       CASE WHEN c.relkind = 'v' THEN COALESCE(c.reloptions::text, '') ELSE NULL END AS view_options
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN (
  SELECT schemaname, tablename, count(*) AS policy_count
  FROM pg_policies
  GROUP BY schemaname, tablename
) pol ON pol.schemaname = n.nspname AND pol.tablename = c.relname
WHERE n.nspname IN ('public', 'private', 'storage')
  AND c.relkind IN ('r', 'p', 'v', 'm')
  AND c.relname NOT LIKE 'pg_%'
ORDER BY n.nspname, c.relname;

-- 3) Any ordinary public/private/storage tables without RLS (review every returned row).
SELECT n.nspname AS schema_name, c.relname AS table_name, c.relkind AS relation_kind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'private', 'storage')
  AND c.relkind IN ('r', 'p')
  AND NOT c.relrowsecurity
ORDER BY n.nspname, c.relname;

-- 4) SECURITY DEFINER functions: review exposed EXECUTE grants and pinned search_path.
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private')
  AND p.prosecdef
ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);

-- 5) Public views: security_invoker should be reviewed where a view reads protected tables.
SELECT schemaname, viewname, viewowner, definition
FROM pg_views
WHERE schemaname = 'public'
ORDER BY viewname;

-- 6) Storage bucket visibility and Storage object policies.
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
ORDER BY name;

SELECT policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;

-- 7) Extensions installed in the database (review unexpected extensions).
SELECT extname, extversion, n.nspname AS extension_schema
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY extname;

ROLLBACK;
