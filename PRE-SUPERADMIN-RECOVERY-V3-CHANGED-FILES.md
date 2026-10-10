# Pre-SuperAdmin Functional Recovery V3 — Changed Scope

## Supabase
- `supabase/HOSTEL_LIFE_PRE_SUPERADMIN_FUNCTIONAL_RECOVERY_V3.sql`
  - Approval-day public late-request feed with a 9 PM visibility boundary.
  - Period-aware correction day lookup.
  - Broader realtime publication registration.
  - Read-only pre-SuperAdmin functional diagnostic RPC.
  - No destructive historical reset.

## Frontend
- `src/features/dashboard/DashboardPage.jsx`
  - Public late-request card uses server `visible_until`.
  - Shows target meal date and readable B/L/D labels.
  - Adds operational realtime refresh sources.
  - Keeps a less intrusive 10-minute fallback polling interval.
- `src/features/dining/DiningPage.jsx`
  - Operational realtime refresh for requests/market/khala/period/member changes.
  - Market-entry member-list recovery warning/retry.
  - Existing manager edit/correction/default-meal features preserved.
- `src/features/manager/ManagerPages.jsx`
  - Historical overlap is informational during month close, not a close blocker.
- `src/services/reportService.js`
  - All-member report ledger rows are read directly from the existing RLS-protected table instead of the member-scoped account-history RPC.
  - Ledger rows are normalized and member names are attached for report output.
- `src/styles/ui-refresh.css`
  - Small late-request/market warning readability improvements.

## Explicitly excluded
- Super Admin is not included in this package.
- No business-table reset/drop/truncate.
- No new authentication secrets or credentials.
