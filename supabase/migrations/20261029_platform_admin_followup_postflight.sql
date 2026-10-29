-- Read-only checks after deploying the follow-up migration.
SELECT 'hostel delete RPC' AS feature, to_regprocedure('public.platform_admin_permanently_delete_hostel(uuid,boolean,text)') IS NOT NULL AS installed
UNION ALL SELECT 'closed-period directory', to_regprocedure('public.platform_admin_list_closed_periods()') IS NOT NULL;
SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
WHERE conname IN ('daily_meal_snapshots_hostel_id_fkey','hl_period_summary_snapshots_hostel_id_fkey');
-- Inspect any user-defined triggers that could regenerate snapshots during deletion.
SELECT c.relname AS table_name, t.tgname AS trigger_name, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal
AND c.relname IN ('hostels','monthly_periods','daily_meal_days','daily_meal_records','daily_meal_snapshots','hostel_memberships')
ORDER BY 1,2;
