-- READ-ONLY diagnostic. No production data is modified.
-- Confirm the installed RPC supports a member without an existing daily_meal_records row.
SELECT p.oid::regprocedure AS rpc_signature,
       pg_get_functiondef(p.oid) AS installed_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'manager_set_meal_entries';
