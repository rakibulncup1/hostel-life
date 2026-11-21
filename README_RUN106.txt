HOSTEL LIFE — RUN106 FOCUSED FOLLOW-UP PATCH

BASELINE
Apply this incremental patch only on top of the accepted Run105 baseline (which already includes Run104). Do not apply it to an older project snapshot.

REQUESTED SCOPE
1. Refine the About page language switcher appearance while preserving its existing language-toggle behavior.
2. Group “এখনো অ্যাকাউন্ট নেই?” and “রেজিস্ট্রেশন” together on the left side of the login footer; keep “পাসওয়ার্ড ভুলে গেছেন?” on the right.
3. Rebuild the member-detail PDF using the shared branded report layout with regular multi-page pagination, repeated report header/footer, a four-column summary table, and readable daily-meal, transaction, and market sections. Remove the compressed single-page mode.

FILES
Only the paths listed in PATCH_MANIFEST_RUN106.json are included. This is a patch, not a full project archive.

APPLYING
1. Back up the current project folder.
2. Extract this ZIP at the project root.
3. Overwrite only the paths contained in this patch.
4. Test the About language switch, desktop/mobile login footer, and member-detail PDF locally before production deployment.

VALIDATION
- Targeted Run103 + Run105 + Run106 tests: 26 passed, 0 failed.
- Full test suite: 1,143 passed / 24 failed out of 1,167. The same 24 failures were present in the baseline test log; no new full-suite failures were introduced.
- Stylesheet integrity check: passed.
- JavaScript syntax checks for reportService.js and relevant test files: passed.
- Vite production build was not run because node_modules is absent from the supplied project environment.

SAFETY SCOPE
No SQL migration, Supabase schema, RPC implementation, Edge Function, permission policy, authentication flow, or database operation was changed. The member report continues to use the existing report/print pipeline and existing detail data.
