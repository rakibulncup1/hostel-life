# Archive / Role Recovery V1 — changed areas

## Database migration
- `supabase/HOSTEL_LIFE_ARCHIVE_ROLE_AND_PERIOD_SAFETY_V1.sql`
  - pre-close end date preservation for repeated close/reopen cycles;
  - private archive audit table and audit triggers for archived business data changes;
  - primary-manager authority helper and conservative running-period pointer reconciliation;
  - closing-manager-only archive edit grants, explicit revoke, targeted notifications;
  - safe same-calendar-month accidental reopen path;
  - hardened deactivate/reactivate RPC authority checks;
  - member-directory v3/v4 role flags and post-run diagnostics.

## Frontend areas
- `src/hooks/useManagementContext.js`: period primary-manager pointer takes priority when available.
- `src/app/AppShell.jsx`, `src/components/Header.jsx`, `src/components/MenuDrawer.jsx`: name/role/period badge and navigation for archive edit access.
- `src/features/manager/ManagerPages.jsx`: archive close-manager assignment, temporary access controls, reopen warning, better assistant manager UI, primary-manager-only membership management.
- `src/features/menu/MenuPages.jsx`: previous closer's archive edit access list and no-running-period member list state.
- `src/features/history/HistoryPage.jsx`, `src/services/historyService.js`: archive audit display and permission-scoped editing.
- `src/features/dashboard/DashboardPage.jsx`: members preserved when no period is running or the dashboard summary RPC fails, role badges and clear no-month state.
- `src/features/dining/DiningPage.jsx`: fixed period initialization order and preloads existing server meal values for manager emergency override; assistants use normal request flow for their own meals.
- `src/services/diningService.js`, `src/services/managerService.js`: current RPC fallback and archive access RPC callers.
- `src/styles/ui-refresh.css`: compact role/no-period badges, archive detail/audit/reopen layouts and mobile spacing.
