HOSTEL LIFE — TELEGRAM NOTIFICATION & MOBILE DINING PATCH v16
============================================================

BASELINE
--------
Apply this incremental patch to the project where you have already
implemented Hostel Life — Finishing & Consistency v15.
This is NOT a standalone project and must NOT be extracted over the
original Hostel Life.zip by itself.

SCOPE
-----
1. Keep Telegram only. No Messenger integration or Messenger secrets.
2. Cash deposit notifications go only to the account whose membership
   received the deposit. If the member account cannot be resolved or is
   blocked, the system safely skips the notification; it never falls back
   to a hostel-wide broadcast.
3. Khala payment notifications go only to the named member account, using
   the same safe recipient resolution.
4. A successful new market entry continues to notify all active, unblocked
   hostel members. Telegram includes ordered market items, the buyer, total,
   who entered it, and whether the market amount was added to the buyer's
   deposit/account.
5. Market credit (ledger_type = market_deposit) does not create an extra
   deposit notification. The market message already describes that credit.
6. Manager broadcasts, platform/global notices, membership changes, month
   lifecycle events, archive corrections and meal-request manager/approval
   routing keep their existing recipient rules.
7. Market/finance edits do not create another notification through these
   insert/first-total notification triggers.
8. In-app notifications remain concise. Full market item metadata is used
   by the Telegram dispatcher and is not added to get_notifications().
9. The new meal-request day cards are adjusted for narrow mobile screens.
10. The existing v10 API/cache/heartbeat/realtime optimizations are not
    changed. No Messenger code, new polling, cron, RPC or webhook is added.

FILES INCLUDED
--------------
supabase/migrations/Run48_notification_recipient_policy_and_telegram_format.sql
supabase/verify/Verify_Run48_notification_recipient_policy.sql
supabase/functions/telegram-notification-dispatch/index.ts
src/styles/dining-experience-v2.css
tests/run48NotificationRecipientAndTelegramFormat.test.mjs
tests/run39TargetedImprovements.test.js

DEPLOYMENT ORDER — DO NOT REVERSE
---------------------------------
1. Make a database backup/export using your normal backup method.
2. Confirm that the existing migrations through Run47 have already been
   applied to this production database (they are part of the v15 baseline).
3. Open Supabase Dashboard > SQL Editor.
4. Open the complete Run48 migration file from this patch and run it once.
   The migration is wrapped in a transaction and runs preflight checks
   before changing the schema/functions. A preflight or lock-timeout error
   aborts the transaction; do not remove the checks to force it through.
5. After Run48 succeeds, run the complete read-only verification file:
   supabase/verify/Verify_Run48_notification_recipient_policy.sql
   Confirm all returned readiness/recipient-policy columns are TRUE,
   including telegram_outbox_trigger_enabled and
   provider_metadata_not_exposed_by_inbox_rpc.
6. Deploy the updated Edge Function from the project root using Supabase CLI:

   supabase functions deploy telegram-notification-dispatch --project-ref YOUR_PROJECT_REF

   If the project is already linked, the --project-ref option may be omitted.
7. Do not change the existing Database Webhook, Telegram Bot Webhook,
   notification dispatch secret, Telegram token, or provider settings.
   This patch uses the existing Telegram configuration and existing secrets.

IMPORTANT DEPLOYMENT ORDER
--------------------------
Run the SQL migration FIRST, then deploy the Edge Function. The new Edge
Function reads the delivery_metadata column introduced by Run48. If the
Function is deployed before the migration, it will not find that column.

POST-DEPLOYMENT TESTS
---------------------
Use two active member accounts and one manager account:
A. Enter a cash deposit for Member A. Only Member A should receive the
   in-app notification and, if linked, the Telegram message.
B. Enter Khala payment for Member A. Only Member A should receive it.
C. Create a market entry. All active, unblocked members should receive one
   notification; linked Telegram users should see ordered item details,
   total amount, actor and the market-credit status.
D. If market credit is enabled, confirm there is no second standalone
   deposit alert for that market credit.
E. Edit an existing market/finance entry and confirm no duplicate alert is
   created by these triggers.
F. Submit a meal/late request and confirm the existing manager routing;
   approve/reject it and confirm the result goes to the requesting member.
G. Send a manager/global notice and confirm existing broadcast behavior.

DATABASE SAFETY
---------------
Run48 adds one nullable-history-safe JSONB metadata column with a default
for new/old rows and replaces only the existing market, ledger and Khala
notification trigger-function bodies. It does not delete or rewrite old
notifications, financial rows, Telegram links or outbox batches. Existing
triggers are not recreated. The preflight requires the Run31 outbox trigger
and the Run40 market first-total trigger to be enabled.

No live production database was available to this build environment, so the
migration has NOT been executed against your database. The verification SQL
must be run after you apply it. Do not claim deployment is complete until
those manual steps succeed.

TEST STATUS
-----------
Focused notification tests: 22/22 passed.
Full local test suite: 804 passed, 7 failed (811 total). The seven failures
are existing baseline issues in Backup UI, password re-authentication,
Run45 migration filename/fixture and cold-launch lifecycle tests; no new
failure was introduced by this patch.
Telegram TypeScript source parse: no syntax diagnostics.
Dining CSS PostCSS parse: passed.
A production Vite build was not run because Vite/node_modules are not
installed in this workspace.
