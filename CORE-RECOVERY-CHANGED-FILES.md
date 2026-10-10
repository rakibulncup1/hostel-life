# Core Recovery — Changed Areas

## Backend

- `supabase/HOSTEL_LIFE_CORE_PERIOD_OPERATIONS_RECOVERY_V1.sql`
  - canonical current-period reconciliation
  - stale running-period recovery within the current calendar month
  - current running-period context contract (`id` + `period_id`)
  - month-management context alignment
  - month start wrappers
  - month close/preflight hardening
  - period-scoped Khala permissions
  - manager-request v2 read path
  - market history/detail v2 read paths
  - Khala history v2 read path
  - diagnostic checks
  - non-destructive operational indexes

## Frontend

- `src/services/diningService.js`
  - manager request v2 path with period resolution and legacy fallback
  - running-period `period_id` normalization

- `src/services/historyService.js`
  - market history/detail v2 paths
  - Khala history v2 path

- `src/services/reportService.js`
  - current report bundle uses repaired v2 market/Khala paths with fallback

- `src/hooks/useManagementContext.js`
  - normalized period ID and periodic/focus/online refresh

- `src/features/manager/ManagerPages.jsx`
  - month-close selection and stale-period UI safeguards

- `src/components/Header.jsx`, `src/app/AppShell.jsx`, `src/styles/global.css`
  - visible current-period label

Other files in the project snapshot are the already-applied Phase 2/3 frontend work and are preserved intentionally.
