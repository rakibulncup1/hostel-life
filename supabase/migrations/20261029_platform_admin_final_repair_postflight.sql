-- READ-ONLY verification; safe to run multiple times.
SELECT 'platform hostel delete RPC' AS check_name,
       to_regprocedure('public.platform_admin_permanently_delete_hostel(uuid,boolean,text)') IS NOT NULL AS installed
UNION ALL
SELECT 'realtime beacon function',
       to_regprocedure('private.bump_realtime_beacon()') IS NOT NULL
UNION ALL
SELECT 'closed-period directory RPC',
       to_regprocedure('public.platform_admin_list_closed_periods()') IS NOT NULL
UNION ALL
SELECT 'safe member-delete RPC',
       to_regprocedure('public.platform_admin_permanently_delete_member(uuid,uuid,boolean,text)') IS NOT NULL;

SELECT 'realtime beacon skips missing parent rows' AS check_name,
       position('public.monthly_periods' IN pg_get_functiondef('private.bump_realtime_beacon()'::regprocedure)) > 0
       AND position('public.hostels' IN pg_get_functiondef('private.bump_realtime_beacon()'::regprocedure)) > 0
       AND position('NOT EXISTS' IN pg_get_functiondef('private.bump_realtime_beacon()'::regprocedure)) > 0
       AND position('hostel_lifecycle.deleting_hostel' IN pg_get_functiondef('private.bump_realtime_beacon()'::regprocedure)) > 0 AS passed;

SELECT 'hostel delete removes period tree before parent' AS check_name,
       position('DELETE FROM public.monthly_periods' IN pg_get_functiondef('public.platform_admin_permanently_delete_hostel(uuid,boolean,text)'::regprocedure))
       < position('DELETE FROM public.hostels' IN pg_get_functiondef('public.platform_admin_permanently_delete_hostel(uuid,boolean,text)'::regprocedure)) AS passed;

SELECT conname, conrelid::regclass AS child_table, confrelid::regclass AS parent_table,
       CASE confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'r' THEN 'RESTRICT' WHEN 'a' THEN 'NO ACTION' WHEN 'n' THEN 'SET NULL' ELSE confdeltype::text END AS deletion_rule
FROM pg_constraint
WHERE conname IN ('daily_meal_snapshots_hostel_id_fkey','hl_period_summary_snapshots_hostel_id_fkey')
ORDER BY conname;

-- Function source versions (no secrets or user data).
SELECT 'admin temporary password frontend is separately deployed' AS reminder,
       'Use the Edge Function health-check button after deploying index.ts from this release.' AS instruction;

SELECT 'member delete delegates Auth cleanup to Edge Function' AS check_name,
       position('auth_cleanup_separate' IN pg_get_functiondef('public.platform_admin_permanently_delete_member(uuid,uuid,boolean,text)'::regprocedure)) > 0
       AND position('DELETE FROM auth.users' IN pg_get_functiondef('public.platform_admin_permanently_delete_member(uuid,uuid,boolean,text)'::regprocedure)) = 0 AS passed;
