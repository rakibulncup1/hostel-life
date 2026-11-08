# Hostel Life — targeted improvements (Run39)

## Baseline reference

The sole source archive for this patch is `Hostel Life(4).zip` (SHA-256: `985ddbb099321a8b70e607c6fb7554eceef12a93455c3517a92a68a4443eabed`). The original archive remains unchanged; all edits were made in a separate working copy.

## Scope
This patch addresses only the seven user-requested areas:
1. Security Monitor attempted-email capture and matched-account context.
2. Cloudflare Worker city/region forwarding and signed Geo Nonce verification.
3. Creator/editor attribution for market, ledger/deposit/other-expense and Khala Money history.
4. More descriptive in-app/Telegram event notices, branded as Hostel Life / the user's mess, and creator-inclusive inbox delivery.
5. Supabase Auth email OTP registration UI and resend controls.
6–7. Period-bound Khala Money entries, retained month-end horizon, original closer identity, exact-period archive correction access and audit of edits.

No other feature was intentionally refactored. The supplied original ZIP was not changed. The intentionally absent `cloudflare/hostel-life-security-proxy/wrangler.toml` was not recreated; the existing `wrangler.toml.example` is retained as the deployment template. User-edited Run5/Run8 SQL and `src/middleware.js` are retained as supplied.

## Schema preflight correction (v2)

The first Run39 candidate incorrectly checked `public.meal_requests.review_note` and the new meal-request notification trigger read `NEW.review_note`. The supplied baseline's Run1 and Run19 schema defines `public.meal_requests.review_reason`; `review_note` belongs to `public.hostel_join_requests` (Run28). The v2 candidate corrects both references to `review_reason` and updates the read-only diagnostic accordingly. No column is added and no existing data is rewritten for this correction. A regression test now guards this distinction.

## Important limits
- No production Supabase or Cloudflare environment was accessed or modified.
- Run39 has not been executed against a database. It must first be tested on a restored staging copy of the production database.
- Older Security Monitor events cannot reveal the email if it was never stored. Those records remain unchanged and display that the email was not historically captured.
- The existing Run8 Archive Correction workflow is retained. The exact user recorded in `monthly_periods.closed_by` can additionally correct only that same closed/archived period through the existing Archive Correction RPC and the dedicated market-entry update permission, while their same-hostel membership remains active and unblocked. The generic manager permission helper remains unchanged, so this does not grant former closers unrelated manager actions. The grant does not cover another month, a running period, reopening a period, or manager handover. The Archive page reads the new period-scoped permission RPC and shows edit controls only for the server-issued periods.
- The OTP resend timer in the UI is a usability guard. Supabase Auth rate limits and OTP expiry remain authoritative. Password-reset success events now also store the normalized requested email in the dedicated `attempt_email` field; passwords and OTP codes are never logged. Verified login/signup telemetry additionally verifies the current Auth session id against the Run37 session guard.
- Geo city/region availability depends on Cloudflare's IP geolocation result; some IPs may not have a city or region value.
- Telegram delivery continues to respect each user's existing Telegram-channel opt-in and linked-chat state. The in-app notification inbox targets all active, non-blocked members, including the creator.
- Run39 enables both market and ledger activity preferences. This will increase in-app notifications and may increase Telegram deliveries for members who have opted in. Review this deliberate behavior change during staging.
- The recorded closer remains able to use the existing Archive Correction workflow and scoped archived edit flow for that exact closed period, provided they remain an active, non-blocked member of the same mess. The authority does not grant access to another period, a running month, manager handover, or month reopen. The original close identity is never rewritten.

## Validation performed

- Targeted Run39 regression tests: **8 passed, 0 failed**.
- Complete Node test suite: **555 tests; 552 passed, 3 failed**. The three failures are existing/out-of-scope expectations: a Google OAuth guide file absent from the supplied ZIP, a Backup UI copy-text assertion, and a legacy password re-authentication metric assertion. They were not changed just to force a green suite.
- `node --check` passed for the Cloudflare Worker and changed JavaScript service modules. TypeScript's parser/transpiler reported no syntax diagnostics for the changed JSX and Edge Function TypeScript files.
- `git diff --check` reports CRLF lines as trailing whitespace on three files that are byte-identical to the supplied archive (`src/middleware.js`, `Run5.sql`, and `Run8.sql`); their bytes were preserved and they were not intentionally edited.
- Full Vite production build and PostgreSQL migration execution were **not** performed: Vite/Supabase/PostgreSQL CLI tools and a staging database were not available in this environment. The migration has a transaction, preflight guards and a read-only verification script, but still needs to be tested on a restored staging database before rollout.

## Required deployment sequence (manual)
1. Export a fresh database backup and restore it into a staging Supabase project.
2. Confirm the staging project has successfully applied the supplied migrations through Run38 and that its schema/function signatures match the Run39 preflight. If a preflight check fails, stop; do not edit Run5/Run8 to force it through.
3. Apply `supabase/migrations/Run39_targeted_hostel_life_improvements.sql` to staging only. Run `supabase/verify/Verify_Run39_targeted_improvements.sql` and review every output, especially function grants, triggers, the notification preference row, and `khala_range_check`.
4. Deploy the updated Supabase Edge Functions: `record-auth-event`, `request-password-reset`, and `telegram-notification-dispatch`. Preserve their existing JWT/webhook deployment settings and secrets; do not expose the service-role key or HMAC secret to the frontend.
5. For Cloudflare, use the supplied `cloudflare/hostel-life-security-proxy/wrangler.toml.example` as the deployment config template. Set `SUPABASE_FUNCTIONS_ORIGIN` to the project's HTTPS Supabase origin and `ALLOWED_ORIGINS` to only the real production and required local origins. Store `HOSTEL_GEO_PROXY_HMAC_SECRET` as a Worker secret, matching the secret configured in the two Supabase Edge Functions. Do not commit the secret or recreate the deleted `wrangler.toml` in this patch. Deploy the Worker with the example config file after replacing its example values.
6. Set the frontend production environment variable `VITE_HOSTEL_SECURITY_WORKER_URL` to the deployed Worker origin. Keep the original `VITE_SUPABASE_URL` and publishable key unchanged. Do not enable this variable before the Worker and Edge Functions are deployed and verified together; a configured but unavailable Worker intentionally blocks protected auth operations rather than bypassing the IP gate.
7. In Supabase Auth settings, ensure email confirmations are enabled, the email template sends the six-digit token using `{{ .Token }}`, and the OTP expiry/rate limits are set to the desired policy. The app currently uses a 60-second UI resend cooldown and at most four manual re-sends per registration screen; configure the server limits as the authoritative control.
8. Test the complete flow on staging: failed login, successful login, registration submit, wrong/expired OTP, correct OTP, resend cooldown, geo city/region when available, Worker nonce replay rejection, notification recipient lists (including creator/manager), Telegram opt-in, month close, manager handover, former-closer Khala add/edit/void, and date boundary cases.
9. Only after staging sign-off, schedule production rollout with a point-in-time backup and rollback plan. No deployment is performed by this patch.

## Expected behavior after successful deployment
- New auth events carry the normalized attempted email; verified login/signup events link to the Supabase Auth user. Passwords and OTPs are never logged.
- Security Monitor adds matched account name, phone and membership context when the attempted email matches an Auth account.
- Worker-signed city, region and region code flow to the Supabase security event/geo path after nonce verification.
- Market, deposit/ledger and Khala Money history shows creator and, for subsequent edits, last editor and timestamp where an actor identity exists.
- Market, deposit, other-expense, Khala, relevant meal/member and month lifecycle notifications use descriptive names/details. The actor is included in the in-app inbox recipient list.
- Registration requests a Supabase email OTP, accepts exactly six digits, and supports a cooldown-protected resend.
- Khala Money entries remain attached to their selected period; the original closer retains access to the exact month after a handover, subject to active membership. Edits/voids record audit entries.

## Files
- `supabase/migrations/Run39_targeted_hostel_life_improvements.sql`
- `supabase/verify/Verify_Run39_targeted_improvements.sql`
- Updated frontend and Edge Function files in the project folder
- `cloudflare/hostel-life-security-proxy/src/index.js` and existing `wrangler.toml.example`
