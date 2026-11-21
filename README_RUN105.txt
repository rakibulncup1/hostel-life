HOSTEL LIFE — RUN105 UI PATCH

BASELINE
This is an incremental patch for the current Hostel Life project ZIP with the accepted Run104 patch already applied. Do not apply it to an older project snapshot.

CONTENTS
Only the listed Run105 source, stylesheet, public-page, and regression-test files are included. This is not a full project archive.

APPLYING
1. Make a fresh backup of your current project folder.
2. Extract this ZIP at the project root.
3. Allow overwrite only for the paths included in this patch.
4. Run the app locally and verify the affected pages before deploying to production.

SAFETY SCOPE
No SQL migration, Supabase schema, RPC implementation, Edge Function, permission policy, or database operation is included. Existing manager approval/rejection actions and server-side invitation checks remain in place.

VALIDATION
- Run105 and related targeted regression tests: 132 passed, 0 failed.
- Stylesheet integrity check: passed.
- Full test suite: 1,138 passed / 24 failed out of 1,162. The 24 failures were already present in the previous baseline and are outside the Run105 targeted tests.
- Vite production build was not run because node_modules is not present in the supplied project environment.

NOTES
- The individual member PDF uses a compact landscape layout. Very large member histories can still flow onto additional pages; report headers and footers are configured to repeat on printed pages.
- Invite pages are forced to a light theme, including the /invite#token route. The preview card shown by WhatsApp or other social platforms is separate metadata and may be cached by those platforms; the client-side page theme cannot override a cached preview card.
