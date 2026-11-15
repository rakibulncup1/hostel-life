-- READ-ONLY verification for Run49_hostel_meal_count_modes.sql.
-- This script does not insert, update, or delete application data.

SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'hostels'
      AND column_name = 'meal_count_modes'
      AND data_type = 'jsonb'
      AND is_nullable = 'NO'
  ) AS meal_count_modes_column_ready,
  to_regprocedure('public.manager_update_meal_count_modes(jsonb)') IS NOT NULL
    AS save_rpc_exists,
  to_regprocedure('public.get_my_membership()') IS NOT NULL
    AS membership_rpc_exists,
  COALESCE((
    SELECT column_default LIKE '%breakfast%half%'
      AND column_default LIKE '%lunch%full%'
      AND column_default LIKE '%dinner%full%'
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'hostels'
      AND column_name = 'meal_count_modes'
  ), false) AS default_modes_ready,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'manager_update_meal_count_modes'
      AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
      )
  ) AS save_rpc_authenticated_only;

-- Confirm the membership RPC includes the setting without exposing provider data.
SELECT
  position('meal_count_modes' IN pg_catalog.pg_get_functiondef('public.get_my_membership()'::regprocedure)) > 0
    AS membership_returns_modes,
  position('period_assistant_managers' IN pg_catalog.pg_get_functiondef('public.get_my_membership()'::regprocedure)) > 0
    AS assistant_manager_join_code_logic_preserved;
