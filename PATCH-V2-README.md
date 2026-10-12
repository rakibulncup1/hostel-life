# Hostel Life — Targeted V2 patch (11 October 2026)

This package is **not** the requested complete system rebuild. It contains corrections grounded in the provided database snapshots and frontend files. Run only after backup and staging review. No live database was accessed and there is no claim of runtime verification.

## Installation
1. Save a full Supabase backup. Ideally test on a staging copy first.
2. Apply `supabase/HOSTEL_LIFE_REPAIR_20261011_V2.sql` ONCE using Supabase SQL Editor. The script has two transaction blocks; test all operations after completion.
3. Merge the ZIP's `src/` files into an **unchanged original project** (do not merge on top of an incompatible newer branch), or review each diff manually. Run `npm ci` and `npm run build`.
4. Redeploy and sign in again. Test manager and ordinary member flows using a newly running period.

## Addressed in this package
- Previously repaired: member-readable account history, manager changing when no running period, dashboard active members, avatar unique path.
- Ledger history: effective deposits/expenses include adjustment entries without duplicating amendment rows in the visible history; original adjustment audit rows remain in DB.
- Manager adjustments explicitly checked against hostel scope and manager privilege.
- Market write RPCs refreshed from database snapshot, active buyer check, manager edit hostel/status guard, ledger credit-reversal entry dates.
- Member history archive permission error removed from read-only browsing; edit permission remains separately gated.
- UI: more reliable expense sign handling.

## Remaining / NOT promised fixed
- Market create still *requires a running month* for ordinary members; do not open closed months to fix apparent entry failure. Confirm with live errors if entry fails during running month.
- Request history edits before finalization, updated badge data source, late request editing, full dining/history month picker, super admin, registration/hostel permission codes, global alerts, dynamic developer info, blocking, and complete integration/regression tests are **not finished**. The request badge remains hidden until the backend returns an explicit `manager_edited` field.
- Avatar upload success depends on Supabase Storage policies for the `hostel_documents` bucket and profile RPC; SQL here does not alter storage rules.
- SQL syntax has not been validated against a PostgreSQL service. Stop if migration raises an error and do NOT run arbitrary workaround commands.

## Minimum smoke tests
1. Create a running month; regular member adds their own market; manager adds for another active member.
2. Manager edits the market two times and verify net market credit (no duplicate balance). Verify archived edit policy.
3. Manager edits deposit and other expense; check effective history amount on all roles.
4. Ordinary member reads another member's account history but cannot modify.
5. Close month; verify no new ordinary market entry and manager transfer still possible.
6. Upload profile avatar and reload. Record database error code if failure persists.
