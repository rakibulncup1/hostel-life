-- Read-only verification for Run33_platform_communications_release_and_public_notices.sql.
-- Safe to run in the Supabase SQL Editor after applying Run33; performs SELECTs only.
WITH checks AS (
  SELECT 'platform_communications table'::text AS check_name,
         to_regclass('public.platform_communications') IS NOT NULL AS passed,
         COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.platform_communications')), false) AS detail_boolean
  UNION ALL
  SELECT 'exactly one singleton row',
         to_regclass('public.platform_communications') IS NOT NULL
           AND (SELECT count(*)=1 FROM public.platform_communications WHERE singleton=true),
         to_regclass('public.platform_communications') IS NOT NULL
           AND (SELECT count(*)=1 FROM public.platform_communications WHERE singleton=true)
  UNION ALL
  SELECT 'admin read RPC', to_regprocedure('public.platform_admin_get_communications()') IS NOT NULL,
         to_regprocedure('public.platform_admin_get_communications()') IS NOT NULL
  UNION ALL
  SELECT 'admin save RPC', to_regprocedure('public.platform_admin_save_communications(jsonb)') IS NOT NULL,
         to_regprocedure('public.platform_admin_save_communications(jsonb)') IS NOT NULL
  UNION ALL
  SELECT 'public settings RPC', to_regprocedure('public.get_platform_public_settings()') IS NOT NULL,
         to_regprocedure('public.get_platform_public_settings()') IS NOT NULL
  UNION ALL
  SELECT 'member list RPC returns jsonb',
         COALESCE(pg_get_function_result(to_regprocedure('public.platform_admin_list_hostel_members_v3(uuid)'))='jsonb', false),
         COALESCE(pg_get_function_result(to_regprocedure('public.platform_admin_list_hostel_members_v3(uuid)'))='jsonb', false)
  UNION ALL
  SELECT 'banner upload INSERT policy', EXISTS (
           SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
             AND policyname='hostel_life_platform_notice_image_insert'),
         EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
             AND policyname='hostel_life_platform_notice_image_insert')
  UNION ALL
  SELECT 'banner upload UPDATE policy', EXISTS (
           SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
             AND policyname='hostel_life_platform_notice_image_update'),
         EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
             AND policyname='hostel_life_platform_notice_image_update')
  UNION ALL
  SELECT 'developer-assets bucket', EXISTS (
           SELECT 1 FROM storage.buckets WHERE id='developer-assets' AND public=true),
         EXISTS (SELECT 1 FROM storage.buckets WHERE id='developer-assets' AND public=true)
)
SELECT check_name, passed, detail_boolean
FROM checks
ORDER BY check_name;
