-- READ-ONLY postflight verification for Hostel Life finishing migrations.
-- Run after the open-ended-period migration (if needed) and the finishing
-- reliability migration have completed successfully. This file changes no data.

SELECT check_name, installed
FROM (VALUES
  ('open-ended period trigger helper', to_regprocedure('private.hl_b_guard_period_dates()') IS NOT NULL),
  ('Khala creator history', to_regprocedure('public.get_khala_money_history_v2(uuid,integer)') IS NOT NULL),
  ('archive management list', to_regprocedure('public.get_archive_management_items()') IS NOT NULL),
  ('archive reopen', to_regprocedure('public.reopen_archived_period(uuid)') IS NOT NULL),
  ('single notification delete', to_regprocedure('public.delete_my_notification(uuid)') IS NOT NULL),
  ('bulk notification delete', to_regprocedure('public.delete_all_my_notifications()') IS NOT NULL),
  ('permanent hostel delete', to_regprocedure('public.platform_admin_permanently_delete_hostel(uuid,boolean,text)') IS NOT NULL),
  ('expired archive list', to_regprocedure('public.platform_admin_list_expired_archives()') IS NOT NULL),
  ('saved summary list', to_regprocedure('public.platform_admin_list_saved_summaries()') IS NOT NULL),
  ('manager meal request list v3', to_regprocedure('public.get_manager_meal_requests_v3(uuid,text,text,boolean,integer)') IS NOT NULL),
  ('normal meal request cutoff', to_regprocedure('public.create_meal_request(date,date,jsonb)') IS NOT NULL),
  ('late meal request', to_regprocedure('public.create_late_meal_request(date,numeric,numeric,numeric,text)') IS NOT NULL),
  ('correction request creation', to_regprocedure('public.create_meal_correction_request(date,date,jsonb,uuid)') IS NOT NULL),
  ('approved request direct edit', to_regprocedure('public.edit_my_approved_meal_request(uuid,date,date,jsonb)') IS NOT NULL),
  ('correction manager review', to_regprocedure('public.manager_review_correction(uuid,boolean,text)') IS NOT NULL),
  ('retention policy row', EXISTS (SELECT 1 FROM public.platform_retention_policy WHERE singleton = true)),
  ('daily meal cutoff columns', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='daily_meal_days' AND column_name='cutoff_at')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='daily_meal_days' AND column_name='finalizes_at'))
) AS checks(check_name, installed)
ORDER BY check_name;

-- Expected: every row above returns installed = true. If any row is false,
-- do not use the associated feature until the migration error is resolved.
