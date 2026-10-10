# Feature Recovery V1 — Changed files and behavior

## Frontend changes

- `src/services/diningService.js`: recognize PostgreSQL `42883` and PostgREST `PGRST202/PGRST203`/schema-cache errors when safely falling back across versioned member/request RPCs.
- `src/services/historyService.js`: same missing-RPC fallback classification for market history/detail.
- `src/features/dining/DiningPage.jsx`: load period and member directory independently; a directory RPC failure no longer hides a valid running period; manager market page displays retry/error state and, when available, only the current member as a clearly limited fallback; realtime refresh is quiet so it does not continually unmount an in-progress dining form.
- Existing feature branches implement request history, manager review, late request UI, late-card rendering, member details, market/account history filters, PDF/print, and Khala viewer.

## New backend migration

`supabase/HOSTEL_LIFE_FEATURE_RECOVERY_V1.sql`

- adds `meal_requests.is_late_request` with default false;
- extends the late-override source-type guard to include `member_late_request`, preserving existing source categories;
- adds versioned member/manager request list RPCs, manager-on-behalf-of-member request RPC, late request submit/review RPCs, same-hostel member detail RPC, and a period manager notification helper;
- revises correction review so finalized dates are updated immediately and approved pending corrections enter the 9 PM override pipeline; void override audit rows are reused to respect the one-row-per-day/member unique constraint;
- refreshes PostgREST schema cache and prints read-only checks at the end.

No `DROP TABLE`, `TRUNCATE`, or `DELETE FROM` is used in this migration. It intentionally does not rewrite the existing market-accounting function body.

## Validation limitations

The 49 JS/JSX files passed the TypeScript parser in JSX mode with zero syntax diagnostics; 164 relative imports were checked with zero missing targets. SQL dollar-quote blocks are balanced, one BEGIN/COMMIT pair exists, and no destructive row/table command is present. A real Supabase execution and Vite production build have not been performed in this environment; run the prescribed checks before production use.
