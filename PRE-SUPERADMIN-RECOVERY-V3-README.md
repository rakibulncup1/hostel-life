# Hostel Life — Pre-SuperAdmin Functional Recovery V3

This package is the final non-SuperAdmin recovery layer. It focuses on request/correction/finalization/late-card/realtime/market/report consistency.

## Supabase
Run **only** `supabase/HOSTEL_LIFE_PRE_SUPERADMIN_FUNCTIONAL_RECOVERY_V3.sql` once, after the already-successful Phase 1 / Phase 3 / Core Recovery migrations.

## Key rules
- Public late-request card shows approved/applied late changes approved today, until 9 PM of approval day.
- Normal/late changes finalize through the existing 9 PM finalization pipeline.
- Historical correction day lookup is period-aware.
- Month-close overlap pairs are informational, not blockers; only requests extending past the selected close date trigger future-request confirmation.
- Market/report/request/dashboard refresh uses realtime where available plus existing focus/visibility fallback.
- No SuperAdmin route or role UI is included.
- No historical business data is bulk-deleted.

## Important
The two previously observed historical normal-request overlap pairs remain preserved and should be manually reviewed later.
