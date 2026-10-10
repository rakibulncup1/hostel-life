# Hostel Life — FIX-03 + FIX-04 Install Order

## Baseline
Current successful baseline: `Hostel-Life-Frontend-Fix-02.zip`.

## Important
These frontend packages are cumulative. FIX-04 is built on top of FIX-03.
Do not treat FIX-04 as an independent package to apply on top of FIX-02.

## Step 1 — FIX-03
1. Backup/commit the current FIX-02 project.
2. Merge `Hostel-Life-Frontend-Fix-03.zip`.
3. Run `npm install` and `npm run build`.
4. Smoke-test Month/Manager operations.

## Step 2 — FIX-04 backend targeted patch
Run `supabase/FIX-04-ACCOUNT-HISTORY-SECURITY-PATCH.sql` once in Supabase SQL Editor.
It only replaces the existing `get_account_history_v2(uuid,uuid,integer)` function and grants the existing execute privilege. It does not drop, reset, truncate, or modify table data.

Do NOT rerun Master SQL, Repair V2.0.2, or Dashboard Repair SQL.

## Step 3 — FIX-04 frontend
1. Keep a FIX-03 backup/commit.
2. Merge `Hostel-Life-Frontend-Fix-04.zip`.
3. Run `npm install` and `npm run build`.
4. Run the accounting/report/history smoke tests.

## Safer single-step option
FIX-04 already contains all FIX-03 source changes. For a fresh working tree, using only FIX-04 can reach the FIX-03+04 source state. If FIX-03 has already been tested separately, continue with FIX-04 normally.

## Verification SQL
- FIX-03: `FIX-03-READONLY-PREFLIGHT.sql`
- FIX-04: `FIX-04-READONLY-PREFLIGHT.sql`
Both are read-only.
