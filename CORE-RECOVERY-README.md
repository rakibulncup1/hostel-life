# Hostel Life — CORE PERIOD & OPERATIONS RECOVERY

This package is the non-Super-Admin recovery layer for the Hostel Life application.

## Goal

Make the running month/period a reliable server-side authority so the same `period_id` is used consistently by:

- Dashboard/member data
- Meal requests and corrections
- Manager request inbox
- Market entries and market history
- Khala-money entries and history
- Deposits/other expenses through the existing period resolver
- Reports / meal-sheet retrieval
- Month close and next-month start
- Assistant-manager operational access

## Supabase order

Phase 1 and Phase 3 were already executed successfully in the recovery workflow. Do **not** re-run those older SQL files.

Run only:

`supabase/HOSTEL_LIFE_CORE_PERIOD_OPERATIONS_RECOVERY_V1.sql`

Run the entire file once in Supabase SQL Editor.

## Data-safety design

The migration does not DROP or TRUNCATE any Hostel Life business table and does not perform automatic cleanup of the two previously observed historical overlapping normal meal-request pairs.

It may extend one stale RUNNING period to the natural end of its current calendar month when today's date is still within that same month. This is an operational-boundary repair, not a historical archive rewrite.

The existing future-request cancellation behavior remains only behind the explicit month-close confirmation flag.

## Frontend changes included in this package

The current project snapshot also contains the frontend reconciliation already prepared in earlier phases, plus a targeted report-service alignment so current report bundles use the repaired v2 market/Khala history paths with legacy fallback.

## Build note

Static JSX/JS checks and relative-import checks were run. A full Vite production build was not completed in this environment because dependency installation was unavailable, so the package does not claim a production-build pass.
