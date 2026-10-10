# Stabilization-01 changed files

## Frontend/runtime
- `src/services/diningService.js` — resilient member-directory RPC; running-period context RPC; month-close preflight helper.
- `src/services/managerService.js` — resilient Khala period RPC.
- `src/services/reportService.js` — stable running-period loading and popup-safe print window.
- `src/features/manager/ManagerPages.jsx` — manager member loader migration; direct/confirmable month-close flow; month-close preflight warnings; PDF print launch fix.
- `src/features/dining/DiningPage.jsx` — operational manager member loader and manager market buyer context.
- `src/utils/supabaseErrors.js` — clearer duplicate-request / missing-function / multiple-running-period messages.

## Backend SQL
- `supabase/HOSTEL_LIFE_STABILIZATION_01.sql` — resilient member directory, running-period context, Khala periods, month-close preflight, and duplicate-running-period guard.
- `supabase/HOSTEL_LIFE_STABILIZATION_01_VERIFICATION.sql` — read-only verification/diagnostic queries.

## No data reset
This package does not drop, truncate, delete, or rewrite application rows. It changes only functions/privileges and frontend code.
