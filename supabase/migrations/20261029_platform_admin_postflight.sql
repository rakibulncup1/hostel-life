-- Read-only verification: does not mutate any data.
SELECT 'whole-hostel delete RPC' AS feature, to_regprocedure('public.platform_admin_permanently_delete_hostel(uuid,boolean,text)') IS NOT NULL AS installed
UNION ALL SELECT 'role directory RPC', to_regprocedure('public.hl_platform_hostel_roles(uuid)') IS NOT NULL;
SELECT c.conname AS fk_name, c.conrelid::regclass AS child_table, c.confrelid::regclass AS parent_table,
  CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'r' THEN 'RESTRICT' WHEN 'a' THEN 'NO ACTION' WHEN 'n' THEN 'SET NULL' ELSE c.confdeltype::text END AS deletion_rule
FROM pg_constraint c WHERE c.contype='f' AND c.confrelid='public.hostels'::regclass
ORDER BY c.conrelid::regclass::text;
