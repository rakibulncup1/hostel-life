-- Read-only verification for Run22 assistant-manager permissions.
-- This script only reads PostgreSQL function definitions and does not mutate data.
WITH function_defs AS (
  SELECT
    pg_get_functiondef(to_regprocedure('public.manager_set_meal_entries(jsonb)')) AS final_meal,
    pg_get_functiondef(to_regprocedure('public.get_my_membership()')) AS membership,
    pg_get_functiondef(to_regprocedure('public.manager_update_hostel(text)')) AS hostel_name,
    pg_get_functiondef(to_regprocedure('public.regenerate_join_code()')) AS join_code
)
SELECT
  final_meal IS NOT NULL AS manager_final_meal_rpc_exists,
  position('v_period.id, false, false' IN coalesce(final_meal, '')) > 0 AS final_meal_checks_exact_running_period_role,
  position('v_day.status <> ''finalized''' IN coalesce(final_meal, '')) > 0 AS final_meal_still_requires_finalized_day,
  position('period_assistant_managers' IN coalesce(membership, '')) > 0 AS membership_returns_join_code_to_assigned_assistants,
  position('v_hostel, NULL, false, false' IN coalesce(hostel_name, '')) > 0 AS assistant_can_update_hostel_name,
  position('v_hostel, NULL, false, false' IN coalesce(join_code, '')) > 0 AS assistant_can_regenerate_join_code
FROM function_defs;
