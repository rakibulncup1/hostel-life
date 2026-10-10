# Hostel Life — Stabilization-01

## Why this package exists
The project moved through several cumulative frontend fixes before every core workflow had been live-tested. The result was regression: member-management pages lost a reliable member loader, period queries could fail when legacy data contained more than one running month, and several manager/dining/report screens depended on those shared queries.

This package is a recovery/stabilization layer. It is not a new feature phase.

## Current baseline
Start from the user's current successful FIX-05 source/build state.

## Database step
Run `supabase/HOSTEL_LIFE_STABILIZATION_01.sql` once in Supabase SQL Editor.

Do NOT rerun:
- Master SQL
- HOSTEL_LIFE_REPAIR_MIGRATION_V2_0_2.sql
- Dashboard Repair V2.1.x
- Module-06 database patch
- FIX-04 account-history patch

Then run `supabase/HOSTEL_LIFE_STABILIZATION_01_VERIFICATION.sql`.

## Frontend step
Use the source in this package after the SQL succeeds.

Run:
`npm install`
`npm run build`

## Core smoke test order
1. Member Management — full active + inactive list visible.
2. Change Manager — active members appear.
3. Assistant Manager — active member choices appear.
4. Dining — market entry and manager deposit load the current month/member list.
5. Khala Money — current running month appears and entry can be submitted.
6. Current Month Close — confirm future request cancellation, then close today.
7. New Month — only after close, start the next calendar day.
8. Reports — running-month report loads and CSV/PDF actions work.
9. History — market/account/month history loads.

## Important
Stabilization-01 deliberately does not auto-delete or auto-cancel historical duplicate requests. The verification report exposes overlap pairs so they can be reviewed safely. Existing future requests are cancelled only by the explicit manager month-close action already defined by the product rules.
