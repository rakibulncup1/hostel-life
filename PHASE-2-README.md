# Hostel Life — Phase 2 Frontend Functional Reconciliation

This phase is intentionally limited to frontend/runtime reconciliation on top of the Phase 1 backend repair.

## Included
- General-member Khala Money viewer in the three-line menu.
- Khala history is loaded per period so archived/current period labels remain accurate.
- The current user's Khala entries are pinned to the top of each period and clearly marked.
- All Members balance labels now distinguish `বর্তমান অবশিষ্ট` and `বর্তমান বকেয়া`, with the displayed amount normalized to a positive value.
- Assistant Manager badge is shown in the member directory when the backend marks the member for the running period.
- Meal request history / manager request day summaries use readable Breakfast/Lunch/Dinner labels instead of B/L/D abbreviations.
- New normal meal requests perform a client-side overlap pre-check before submission; the backend overlap protection remains authoritative.
- Market entry fields use compact, clearer Bengali placeholders for mobile use.
- Profile photos are automatically resized/compressed to a target of <=190 KB, converted to JPEG, and uploaded to the existing per-user replacement path.

## Intentionally not included
- No database/schema/RLS/function migration.
- No destructive data cleanup.
- No PWA architecture rewrite; strict offline snapshot work remains Phase 3.
- No Super Admin panel; reserved for the final phase.

## Validation
- `git diff --check` passes.
- Local import/path scan reports no missing relative imports.
- A production build could not be executed in this environment because the package install did not complete and Vite was unavailable locally. Runtime verification should therefore be done after `npm ci` on the development machine.
