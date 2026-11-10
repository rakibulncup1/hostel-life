-- HOSTEL LIFE — READ-ONLY verification for Run43 archive closer-only access.
-- Run in Supabase SQL Editor AFTER Run43_archive_closer_only_permissions.sql.
-- This file performs SELECTs only; it does not modify application data or schema.

WITH function_defs AS (
  SELECT
    to_regprocedure('private.can_manage_closed_period(uuid,uuid)') AS closed_helper_oid,
    to_regprocedure('private.can_manage_hostel(uuid,uuid,boolean,boolean)') AS manager_helper_oid,
    to_regprocedure('private.can_manage_khala_period(uuid,uuid)') AS khala_helper_oid,
    to_regprocedure('public.get_my_archive_editable_periods()') AS editable_list_oid,
    to_regprocedure('public.hlc_get_archive_correction_bundle(uuid)') AS correction_bundle_oid,
    to_regprocedure('public.hlc_apply_archive_correction(uuid,text,uuid,jsonb,text)') AS correction_apply_oid,
    to_regprocedure('public.grant_archive_edit_permission(uuid,uuid,timestamp with time zone,text)') AS grant_oid,
    to_regprocedure('public.reopen_archived_period(uuid)') AS reopen_oid
), normalized AS (
  SELECT
    closed_helper_oid,
    manager_helper_oid,
    khala_helper_oid,
    editable_list_oid,
    correction_bundle_oid,
    correction_apply_oid,
    grant_oid,
    reopen_oid,
    lower(regexp_replace(COALESCE(pg_get_functiondef(closed_helper_oid), ''), '\s+', '', 'g')) AS closed_def,
    lower(regexp_replace(COALESCE(pg_get_functiondef(manager_helper_oid), ''), '\s+', '', 'g')) AS manager_def,
    lower(regexp_replace(COALESCE(pg_get_functiondef(khala_helper_oid), ''), '\s+', '', 'g')) AS khala_def,
    lower(regexp_replace(COALESCE(pg_get_functiondef(editable_list_oid), ''), '\s+', '', 'g')) AS editable_def,
    lower(regexp_replace(COALESCE(pg_get_functiondef(correction_bundle_oid), ''), '\s+', '', 'g')) AS bundle_def,
    lower(regexp_replace(COALESCE(pg_get_functiondef(correction_apply_oid), ''), '\s+', '', 'g')) AS apply_def,
    lower(regexp_replace(COALESCE(pg_get_functiondef(grant_oid), ''), '\s+', '', 'g')) AS grant_def,
    lower(regexp_replace(COALESCE(pg_get_functiondef(reopen_oid), ''), '\s+', '', 'g')) AS reopen_def
  FROM function_defs
), checks AS (
  SELECT '১. Canonical closer helper' AS check_name,
    (closed_helper_oid IS NOT NULL
      AND position('mp.closed_by=auth.uid()' IN closed_def) > 0
      AND position('mp.statusin(''closed'',''archived'')' IN closed_def) > 0
      AND position('m.status=''active''' IN closed_def) > 0
      AND position('notcoalesce(p.is_blocked,false)' IN closed_def) > 0
      AND position('mp.hostel_id=p_hostel_id' IN closed_def) > 0) AS passed,
    'closed_by + closed status + same-hostel active/unblocked membership' AS detail
  FROM normalized

  UNION ALL
  SELECT '২. General manager helper (closed period)',
    manager_helper_oid IS NOT NULL
      AND position('thenprivate.can_manage_closed_period(p_hostel_id,p_period_id)' IN manager_def) > 0,
    'Closed/archived period is delegated to the strict closer helper'
  FROM normalized

  UNION ALL
  SELECT '৩. Khala helper (closed period)',
    khala_helper_oid IS NOT NULL
      AND position('thenprivate.can_manage_closed_period(p_hostel_id,p_period_id)' IN khala_def) > 0,
    'Closed-period Khala edits use the same recorded-closer rule'
  FROM normalized

  UNION ALL
  SELECT '৪. Editable-period list',
    editable_list_oid IS NOT NULL
      AND position('private.can_manage_closed_period' IN editable_def) > 0
      AND position('archive_edit_permissions' IN editable_def) = 0,
    'The app receives editable months only from closed_by; no legacy grant lookup'
  FROM normalized

  UNION ALL
  SELECT '৫. Archive correction read RPC',
    correction_bundle_oid IS NOT NULL
      AND position('private.can_manage_closed_period(v_hostel,p_period_id)' IN bundle_def) > 0,
    'Correction bundle is gated by the recorded closer'
  FROM normalized

  UNION ALL
  SELECT '৬. Archive correction write RPC',
    correction_apply_oid IS NOT NULL
      AND position('private.can_manage_closed_period(v_hostel,p_period_id)' IN apply_def) > 0,
    'Correction writes are gated by the recorded closer'
  FROM normalized

  UNION ALL
  SELECT '৭. Legacy permission grant RPC',
    grant_oid IS NOT NULL
      AND position('raiseexception' IN grant_def) > 0
      AND position('insertinto' IN grant_def) = 0,
    'New archive edit grants are rejected; old grants cannot be issued'
  FROM normalized

  UNION ALL
  SELECT '৮. Reopen RPC',
    reopen_oid IS NOT NULL
      AND position('private.can_manage_closed_period(v_hostel,p_period_id)' IN reopen_def) > 0,
    'Reopening a closed period is also restricted to its recorded closer'
  FROM normalized

  UNION ALL
  SELECT '৯. Legacy active grant rows',
    to_regclass('public.archive_edit_permissions') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.archive_edit_permissions a
        WHERE a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > now())
      ),
    'Expected zero active legacy grant rows after Run43'
  FROM normalized

  UNION ALL
  SELECT '১০. Direct table write policies',
    NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname='public' AND p.tablename='archive_edit_permissions'
        AND p.permissive='PERMISSIVE'
        AND upper(p.cmd) IN ('INSERT','UPDATE','ALL')
    )
      AND NOT has_table_privilege('authenticated','public.archive_edit_permissions','INSERT')
      AND NOT has_table_privilege('authenticated','public.archive_edit_permissions','UPDATE')
      AND NOT has_table_privilege('authenticated','public.archive_edit_permissions','DELETE')
      AND NOT has_table_privilege('anon','public.archive_edit_permissions','INSERT')
      AND NOT has_table_privilege('anon','public.archive_edit_permissions','UPDATE')
      AND NOT has_table_privilege('anon','public.archive_edit_permissions','DELETE'),
    'No authenticated INSERT/UPDATE/DELETE privilege or permissive write policy should exist for archive_edit_permissions'
  FROM normalized
)
SELECT check_name,
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL — REVIEW BEFORE PRODUCTION' END AS result,
       detail
FROM checks
ORDER BY check_name;

-- Also display the actual active grant count separately for easy review.
SELECT count(*)::bigint AS active_archive_edit_permission_rows
FROM public.archive_edit_permissions
WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now());

SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls
FROM pg_class c WHERE c.oid='public.archive_edit_permissions'::regclass;
