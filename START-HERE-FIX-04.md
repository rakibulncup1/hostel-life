# START HERE — Hostel Life FIX-04

Baseline: `Hostel-Life-Frontend-Fix-03`. FIX-04 contains the FIX-03 source state plus the accounting changes.

1. Backup/commit the current project.
2. Run `supabase/FIX-04-ACCOUNT-HISTORY-SECURITY-PATCH.sql` once in Supabase SQL Editor.
3. Merge/replace the project source with this FIX-04 package.
4. Run `npm install` then `npm run build`.
5. Run accounting/history/report smoke tests.
6. `FIX-04-READONLY-PREFLIGHT.sql` is optional/read-only.

Important: do not rerun Master SQL, Repair V2.0.2, Dashboard Repair, or the old Module 06 database patch. The targeted backend patch changes only the existing `get_account_history_v2` function definition; it does not modify table data.
