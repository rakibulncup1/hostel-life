# Hostel Life — PHASE 3 Test Checklist

## Backend migration
- [ ] Run `supabase/HOSTEL_LIFE_PHASE3_BACKEND_FUNCTIONAL_HARDENING_V1.sql` once.
- [ ] Final result `PHASE3_BACKEND_REPAIR = committed`.
- [ ] Running periods count is expected.
- [ ] Historical overlap count remains preserved unless manually resolved.
- [ ] `MEAL_FINALIZER_CRON` still reports `hostel_life_meal_finalizer`.
- [ ] Profile avatar bucket limit reports `262144` bytes.

## Month lifecycle
- [ ] First month is auto-created for a newly created hostel.
- [ ] Current month can be closed today or naturally at its calendar end.
- [ ] Past end dates are rejected from the manual end-date control.
- [ ] Future request warning appears before an early close.
- [ ] Confirming early close cancels/trim future meal requests according to the backend function.
- [ ] New month cannot start on the same day the old month closes.
- [ ] New month starts only on `previous_end + 1 day`.
- [ ] New month natural end never exceeds that calendar month's last day.
- [ ] Same manager retains assistant managers; changed manager does not inherit old assistants.

## Meal request/correction
- [ ] New member normal request appears in manager/assistant request management.
- [ ] Duplicate overlapping normal request is rejected.
- [ ] Correction request after cutoff is accepted.
- [ ] Manager/assistant sees submitted correction request.
- [ ] Approving a locked-day correction creates an approved late override.
- [ ] After scheduled finalization the late override is applied to final records and snapshot.
- [ ] Approving a correction for an already-finalized day updates that day safely and refreshes snapshot.
- [ ] Manager emergency override shows a clear warning.
- [ ] Late request card updates after approval.

## Khala money
- [ ] Manager/assistant can add a period-scoped Khala entry where permission allows.
- [ ] Future payment date is rejected.
- [ ] Appropriate previous-month entry remains available within the configured window.
- [ ] General member can open Khala Money viewer.
- [ ] Current user's entries appear first and are marked as `আপনি`.
- [ ] New entries become visible after refresh/polling on another account.

## Offline/PWA
- [ ] While online, dashboard snapshot is saved.
- [ ] Meal/late-request bundle is saved.
- [ ] App shell opens offline.
- [ ] Dashboard remains visible offline without a blank screen.
- [ ] Cached data remains after normal browser restart.
- [ ] Coming back online refreshes the snapshot.
- [ ] Logging out does not accidentally expose another user's keyed snapshot.

## Profile/storage
- [ ] Large avatar input is compressed client-side.
- [ ] Result is approximately <=190 KiB.
- [ ] Replacing avatar uses the same object path.
- [ ] No unexpected new avatar object path is generated.

## Final phase boundary
- [ ] Do not expect `/super-admin` in Phase 3.
