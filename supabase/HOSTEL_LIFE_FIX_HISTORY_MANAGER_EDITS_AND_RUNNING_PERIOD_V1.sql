-- Hostel Life — focused repair for History manager edits and false "no running month" UI
-- Version: 1.0.0
-- Safe scope:
--   1) Replace only private.can_manage_period(uuid), retaining archived-period rules.
--   2) No table rows are inserted/updated/deleted; no table is dropped.
--   3) Does not DROP or recreate manager_adjust_transaction, so the earlier 42P13 issue is avoided.
-- Backup your project before applying. Run this file once in Supabase SQL Editor as project owner.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.monthly_periods') IS NULL
     OR to_regclass('public.hostel_memberships') IS NULL
     OR to_regclass('public.period_assistant_managers') IS NULL
     OR to_regclass('public.archive_edit_permissions') IS NULL THEN
    RAISE EXCEPTION 'Hostel Life preflight failed: one or more period/manager permission tables are missing. No change was applied.';
  END IF;
  IF to_regprocedure('private.can_manage_period(uuid)') IS NULL THEN
    RAISE EXCEPTION 'private.can_manage_period(uuid) does not exist. Apply the project base/archive permission migration first.';
  END IF;
  IF to_regprocedure('public.manager_adjust_transaction(uuid,numeric,text)') IS NULL
     OR to_regprocedure('public.manager_update_market_entry(uuid,date,uuid,jsonb,boolean,text)') IS NULL
     OR to_regprocedure('public.manager_void_market_entry(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'One or more manager History RPCs are missing. Stop here and send this error; do not run the old all-in-one migration because it may hit the previous return-type conflict.';
  END IF;
END;
$preflight$;

-- A running period can be managed by the currently active manager role for this
-- hostel, even if legacy primary_manager_membership_id metadata is stale or NULL.
-- Period assistants remain authorized by period_assistant_managers.
-- ARCHIVED period authorization is intentionally unchanged: close-manager or
-- explicit, active archive-edit grant only.
CREATE OR REPLACE FUNCTION private.can_manage_period(p_period_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.monthly_periods mp
    JOIN public.hostel_memberships me
      ON me.hostel_id = mp.hostel_id
     AND me.user_id = auth.uid()
     AND me.status = 'active'::public.membership_status
    WHERE mp.id = p_period_id
      AND (
        (
          mp.status = 'running'::public.month_status
          AND (
            me.role = 'manager'::public.membership_role
            OR me.id = mp.primary_manager_membership_id
            OR EXISTS (
              SELECT 1
              FROM public.period_assistant_managers pam
              WHERE pam.period_id = mp.id
                AND pam.membership_id = me.id
            )
          )
        )
        OR
        (
          mp.status = 'archived'::public.month_status
          AND (
            (
              me.id = mp.manager_at_close_membership_id
              AND (
                EXISTS (
                  SELECT 1
                  FROM public.monthly_periods current_period
                  WHERE current_period.hostel_id = mp.hostel_id
                    AND current_period.status = 'running'::public.month_status
                    AND current_period.primary_manager_membership_id = me.id
                )
                OR
                (
                  NOT EXISTS (
                    SELECT 1
                    FROM public.monthly_periods current_period
                    WHERE current_period.hostel_id = mp.hostel_id
                      AND current_period.status = 'running'::public.month_status
                  )
                  AND me.role = 'manager'::public.membership_role
                )
              )
            )
            OR EXISTS (
              SELECT 1
              FROM public.archive_edit_permissions aep
              JOIN public.hostel_memberships current_manager
                ON current_manager.id = aep.granted_by
               AND current_manager.hostel_id = mp.hostel_id
               AND current_manager.role = 'manager'::public.membership_role
               AND current_manager.status = 'active'::public.membership_status
               AND (
                 EXISTS (
                   SELECT 1
                   FROM public.monthly_periods current_period
                   WHERE current_period.hostel_id = mp.hostel_id
                     AND current_period.status = 'running'::public.month_status
                     AND current_period.primary_manager_membership_id = current_manager.id
                 )
                 OR NOT EXISTS (
                   SELECT 1
                   FROM public.monthly_periods current_period
                   WHERE current_period.hostel_id = mp.hostel_id
                     AND current_period.status = 'running'::public.month_status
                 )
               )
              WHERE aep.period_id = mp.id
                AND aep.membership_id = mp.manager_at_close_membership_id
                AND aep.membership_id = me.id
                AND aep.revoked_at IS NULL
                AND aep.expires_at IS NOT NULL
                AND aep.expires_at > now()
            )
          )
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION private.can_manage_period(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_manage_period(uuid) TO authenticated;

-- Keep the existing RPC execute grants explicit. These functions still perform
-- their own authentication, same-hostel, row-lock, and period authorization checks.
GRANT EXECUTE ON FUNCTION public.manager_adjust_transaction(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_update_market_entry(uuid, date, uuid, jsonb, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_void_market_entry(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Read-only verification after commit. It does not simulate auth.uid(); SQL Editor
-- runs with an owner role, so test actual edits from the logged-in manager account.
SELECT 'can_manage_period function' AS check_name,
       CASE WHEN to_regprocedure('private.can_manage_period(uuid)') IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS result
UNION ALL
SELECT 'manager_adjust_transaction grant',
       CASE WHEN has_function_privilege('authenticated', 'public.manager_adjust_transaction(uuid,numeric,text)', 'EXECUTE') THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'manager_update_market_entry grant',
       CASE WHEN has_function_privilege('authenticated', 'public.manager_update_market_entry(uuid,date,uuid,jsonb,boolean,text)', 'EXECUTE') THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'manager_void_market_entry grant',
       CASE WHEN has_function_privilege('authenticated', 'public.manager_void_market_entry(uuid,text)', 'EXECUTE') THEN 'OK' ELSE 'MISSING' END;
