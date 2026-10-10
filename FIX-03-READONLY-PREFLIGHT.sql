-- Hostel Life FIX-03 — Read-only preflight
-- No data mutation. Run in Supabase SQL Editor only if desired.

select
  to_regprocedure('public.get_month_management_context()') as month_context,
  to_regprocedure('public.manager_set_running_period_end_date(date,boolean)') as set_period_end,
  to_regprocedure('public.close_current_month(boolean)') as close_month,
  to_regprocedure('public.start_new_month(date)') as start_month,
  to_regprocedure('public.change_manager(uuid)') as change_manager,
  to_regprocedure('public.get_period_assistants(uuid)') as get_assistants,
  to_regprocedure('public.set_period_assistant_managers(uuid[],uuid)') as set_assistants,
  to_regprocedure('public.deactivate_member(uuid)') as deactivate_member,
  to_regprocedure('public.reactivate_member(uuid)') as reactivate_member,
  to_regprocedure('public.regenerate_join_code()') as regenerate_join_code,
  to_regprocedure('public.grant_archive_edit_permission(uuid,uuid,timestamptz,text)') as grant_archive_permission,
  to_regprocedure('public.revoke_archive_edit_permission(uuid)') as revoke_archive_permission;
