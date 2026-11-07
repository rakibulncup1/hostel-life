# Hostel Life — Final Database & Frontend Completion Package

এই প্যাকেজটি তোমার ইতিমধ্যে প্রয়োগ করা **Baseline + পূর্বের Feature Patch + Super Admin Phase 1 + Phase 2 + Run36**-এর ওপর incremental overlay। এটি পুরো Project ZIP নয়। Run34, Run35 বা Run36 আবার চালানোর প্রয়োজন নেই। এই ZIP-এ একটিমাত্র নতুন Database migration আছে: **Run37**। Run38-এর Worker/Frontend/Edge Function অংশে কোনো SQL নেই।

## ১. প্রথমে নিরাপত্তা

1. বর্তমান Production project ও Database backup নাও। Backup file তৈরি হলেই যথেষ্ট নয়—SHA/manifest যাচাই এবং সম্ভব হলে আলাদা Staging Project-এ restore rehearsal করো।
2. Supabase Dashboard → Integrations → Cron-এ `pg_cron` Enable আছে কি না দেখো। 2026-11-05 snapshot-এ এটি enabled ছিল না। Migration extension নিজে install করে না; Enable না থাকলে preflight-এ থেমে যাবে এবং transaction rollback হবে।
3. ZIP Extract করে Project Root-এ Overlay করো। কোনো `.env`, `node_modules`, `dist` বা user file replace করবে না।
4. নিচের dependency order মেনে চলো।

## ২. একটিমাত্র নতুন SQL Migration — Run37

File: `supabase/migrations/Run37_final_operational_database_completion.sql`

এই Final package-এর **একমাত্র নতুন SQL migration**। এটি একবার Supabase SQL Editor-এ Project Owner/postgres role দিয়ে চালাবে। Run34, Run35, Run36 বা পুরোনো split Run37 SQL/setup file আবার চালাবে না। 2026-11-05-এর Database snapshot-এ `supabase_migrations.schema_migrations` history table ছিল না; তাই এই project-এ migration history reconcile না করে `supabase db push` চালাবে না—এই নির্দিষ্ট SQL Supabase SQL Editor-এ চালাবে।

Run37 preflight পরীক্ষা করবে:
- `pg_cron`-এর `cron.job`, `cron.job_run_details` ও `cron.schedule(text,text,text)` আছে কি না।
- Run35 retention tables এবং প্রতিটি timestamp column সঠিক type-এ আছে কি না।

এরপর একই transaction-এ private maintenance function তৈরি ও দুটি নির্দিষ্ট Cron job schedule/update করে:

| Job | UTC schedule | বাংলাদেশ সময় |
|---|---:|---:|
| `hostel-life-platform-log-retention-30d` | `15 21 * * *` | প্রতিদিন 03:15 |
| `hostel-life-cron-history-retention-7d` | `45 21 * * *` | প্রতিদিন 03:45 |

একই exact job name-এ pg_cron পুনরায় schedule করলে বিদ্যমান job update হয়; duplicate job তৈরি করার উদ্দেশ্য নেই। তবুও migration একবার চালাও। Supabase Cron Dashboard-এ Job ও Run History দেখা যাবে।

### Run37 ঠিক কী মুছবে

- `private.hl_activity_events`: ৩০ দিনের বেশি পুরোনো row
- `private.hl_security_events`: ৩০ দিনের বেশি পুরোনো row
- `private.hl_security_ip_blocks`: block শেষ হওয়ার ৩০ দিনেরও বেশি পরে থাকা row
- `private.hl_password_reset_ip_attempts`: ৪৮ ঘণ্টার বেশি পুরোনো row
- `private.password_reset_request_log`: ৩৫ দিনের বেশি পুরোনো HMAC quota row (৫টি/ক্যালেন্ডার-মাস quota ধরে রাখার জন্য)
- `cron.job_run_details`: কেবল এই দুইটি Hostel Life job-এর ৭ দিনের বেশি পুরোনো history

**মুছবে না:** `public.platform_audit_log`, Hostel/Member/Market/Meal/Financial records, Auth users, session/device history, Storage objects। Canonical Super Admin audit log ইচ্ছাকৃতভাবে আলাদা রাখা হয়েছে; Run27-এর DELETE-to-Activity mirror trigger-এর কারণে এই সংস্করণে সেটি স্বয়ংক্রিয়ভাবে delete করা নিরাপদ নয়।

Run37-এর insert-trigger cleanup এবং দৈনিক cleanup একই advisory lock `728194650175` নেয়; overlapping cleanup এড়ানোর জন্য এটি ইচ্ছাকৃত।

## ৩. একটিমাত্র Final Database Verification SQL

File: `supabase/verify/Verify_Final_Database_Clearance.sql`

Run37 সফল হওয়ার পরে একবার চালাও। এটি Read-only; DDL/DML/GRANT/REVOKE, cron schedule বা data পরিবর্তন করে না। Run34, Run35, Run36, Run37-এর গুরুত্বপূর্ণ object, permission, RLS, geo columns ও দুই Cron job পরীক্ষা করে। প্রত্যাশিত Summary: `0 failed` এবং `PASS`।

কোনো `FAIL` এলে SQL আবার চালিও না। Output CSV/text সংরক্ষণ করো এবং কারণ যাচাই না করে পরবর্তী ধাপে যেও না।

## ৪. Edge Function — একবার deploy

এই package-এ পরিবর্তিত Function source:
- `auth-security-gate`
- `record-auth-event`
- `request-password-reset`
- `admin-delete-unlinked-user`
- `admin-temporary-password`
- `complete-temporary-password`

Project root থেকে:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy auth-security-gate --project-ref YOUR_PROJECT_REF
npx supabase functions deploy record-auth-event --project-ref YOUR_PROJECT_REF
npx supabase functions deploy request-password-reset --project-ref YOUR_PROJECT_REF
npx supabase functions deploy admin-delete-unlinked-user --project-ref YOUR_PROJECT_REF
npx supabase functions deploy admin-temporary-password --project-ref YOUR_PROJECT_REF
npx supabase functions deploy complete-temporary-password --project-ref YOUR_PROJECT_REF
```

JWT Verification (`supabase/config.toml`-এও একই):

| Function | `verify_jwt` |
|---|---|
| `auth-security-gate` | `false` |
| `record-auth-event` | `false` |
| `request-password-reset` | `false` |
| `admin-delete-unlinked-user` | `true` |
| `admin-temporary-password` | `true` |
| `complete-temporary-password` | `true` |
| `telegram-bot-webhook` | `false` — অপরিবর্তিত |
| `telegram-notification-dispatch` | `false` — অপরিবর্তিত |

প্রথম তিনটি pre-auth/public endpoint; তাদের নিজস্ব Origin, quota, trusted ingress ও server-side validation থাকে। Admin Functions-এ JWT এবং Function-এর নিজস্ব Super Admin/user authorization—দুটিই থাকবে। `verify_jwt=false`-কে একা নিরাপত্তা ব্যবস্থা মনে করবে না।

Supabase Edge Runtime built-in secret map (`SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS`) থাকলে code সেটি আগে নেয় এবং legacy env fallback রাখে। এগুলো custom Secret হিসেবে নিজে বানাবে না। Service-role/Secret Key কখনো Frontend/Vercel `VITE_` variable-এ দেবে না।

## ৫. Supabase Edge Function Secrets

আগে থেকে তৈরি Secret-গুলো অক্ষত রাখবে:
- `PASSWORD_RESET_HMAC_SECRET`
- `HOSTEL_SECURITY_HMAC_SECRET`
- `HOSTEL_SECURITY_ALLOWED_ORIGINS`
- `PASSWORD_RESET_ALLOWED_ORIGINS`

Run38-এর জন্য নতুন:
- `HOSTEL_GEO_PROXY_HMAC_SECRET`

Windows PowerShell-এ 32-byte random value তৈরি করতে:

```powershell
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
$secret = [Convert]::ToBase64String($bytes)
$rng.Dispose()
$secret
```

Output-টি নিরাপদ password manager-এ রাখবে। একই exact value Supabase Edge Secret এবং Cloudflare Worker Secret—দুই জায়গায় দিতে হবে। `.env`, source code, GitHub বা chat-এ Secret লিখবে না। Secret change করলে দুই পাশে একসঙ্গে rotate ও deploy করতে হবে।

Allowed Origins-এ শুধু বাস্তবে ব্যবহৃত exact Origin রাখবে, comma-separated; trailing slash/path/wildcard নয়। উদাহরণ:

```text
https://YOUR_PRODUCTION_DOMAIN,http://localhost:5173,http://127.0.0.1:5173
```

এই list একইভাবে `HOSTEL_SECURITY_ALLOWED_ORIGINS`, `PASSWORD_RESET_ALLOWED_ORIGINS` এবং Worker `ALLOWED_ORIGINS`-এ মিলতে হবে। Vite port অন্য হলে সেটি ব্যবহার করবে। Vercel Preview ব্যবহার করলে exact Preview Origin আলাদা যোগ করবে।

## ৬. Cloudflare Worker — একবার deploy

Source: `cloudflare/hostel-life-security-proxy/src/index.js`

Config example: `cloudflare/hostel-life-security-proxy/wrangler.toml.example`

Cloudflare Dashboard → Workers & Pages → Create Worker → Edit Code-এ `src/index.js` বসিয়ে Deploy করো। Worker Settings → Variables-এ:

`SUPABASE_FUNCTIONS_ORIGIN`

```text
https://YOUR_PROJECT_REF.supabase.co
```

`ALLOWED_ORIGINS`: উপরের exact Origin list।

Worker Settings → Secrets-এ `HOSTEL_GEO_PROXY_HMAC_SECRET` যোগ করো—Supabase-এর সঙ্গে একই value। Secret সাধারণ Variable হিসেবে নয়, Secret হিসেবে রাখবে।

Worker URL হবে, উদাহরণ:

```text
https://hostel-life-security-proxy.YOUR_WORKERS_SUBDOMAIN.workers.dev
```

## ৭. Frontend / Vercel / Localhost

Vercel → Project → Settings → Environment Variables-এ:

`VITE_HOSTEL_SECURITY_WORKER_URL` = Worker origin (শুধু URL; `/functions/v1` যোগ করবে না)। Production ও Preview environment যেগুলো ব্যবহার করবে সেগুলোতে যোগ করে redeploy করো।

Local `.env.local`-এ একই Variable রাখো। Supabase URL ও Publishable/Anon Key আগের মতো থাকবে। Vite server restart করতে হবে। `http://localhost:5173` exact origin তিনটি allowlist-এ থাকতে হবে। Browser CSP থাকলে `connect-src`-এ Worker origin অনুমোদিত থাকতে হবে।

Run36-এর Localhost diagnostics-ও থাকবে; `super_admin` role-সহ ঠিক সেই Auth UID দিয়ে login হচ্ছে কি না নিশ্চিত করবে।

## ৮. Build & test — deploy-এর আগে

Project root:

```powershell
npm ci
npm test
npm run build
```

সব test pass এবং Vite build সফল না হলে Vercel-এ deploy করবে না। এই audit environment-এ `npm ci` শেষ হয়নি (`vite` অনুপস্থিত ছিল), তাই Vite Build pass হিসেবে দাবি করা হচ্ছে না। তোমার Windows project-এ build-টি করা আবশ্যক।

## ৯. End-to-End acceptance test

প্রথমে normal/low-risk tests:
1. Worker Health: `record-auth-event` এবং `auth-security-gate` endpoint থেকে `ready`, `database_rpc_ready`, `client_ip_available`, `protection_available`, `geo_proxy_verified` যাচাই।
2. Production ও Localhost Super Admin access; role, correct Supabase project, CSP/CORS যাচাই।
3. একটি normal সফল Login → Security Monitor-এ `login_success`।
4. একটি Test Account-এ একবার wrong password → `login_failed`। Production-এ threshold অতিক্রম করার চেষ্টা নয়।
5. একটি Password Reset → Email, redirect `/auth/reset-password`, নতুন Password দিয়ে login।
6. Telegram directory read ও disposable test account disconnect; orphan list read-only; অন্য Test User-এর device session revoke।
7. Activity/Security date filters, Country/City/Region (Cloudflare location না দিলে blank স্বাভাবিক), report export, health metrics।
8. Supabase Cron Dashboard → Jobs-এ দুই job Active এবং History-তে first successful run নিশ্চিত করো।

Production-এ ইচ্ছাকৃতভাবে বারবার ভুল Login, Reset IP threshold, bulk account delete বা বাস্তব ব্যবহারকারীর Session revoke test করবে না। Rate-limit threshold ও destructive flow আলাদা Staging Project-এ পরীক্ষা করবে।

## ১০. 6 GB Logs Query বনাম Logs Ingest বনাম Database size

এই তিনটি আলাদা metric:

- **Logs Query:** Dashboard/Logs Explorer/Management API/CLI দিয়ে logs খোঁজার সময় যত log data scan হয়। এটি Database storage নয় এবং সরাসরি GB-ভিত্তিক bill নয়। Supabase-এর 2026-09-24 documentation অনুযায়ী Free plan-এর documented query allowance 100 GB প্রতি billing month (1 GB included Logs Ingest-এর 100×); Query enforcement এখনও “Not yet enforced”। 6 GB যদি মাসের মোট Query হয়, allowance-এর তুলনায় কম। 6 GB যদি প্রতিদিন হয় ও পুরো মাস চলতে থাকে, আনুমানিক 180 GB/month—allowance ছাড়াতে পারে, যদিও বর্তমানে enforcement চালু নয়। Usage Dashboard-এ নির্দিষ্ট Project ও time period নির্বাচন করো; Organization view সব project একত্রে দেখাতে পারে।
- **Logs Ingest:** Supabase service-গুলো যে log bytes গ্রহণ করে। Free included quota 1 GB/month; Supabase documentation অনুযায়ী Logs Ingest billing শুরু হওয়ার আগে 2027-এর শুরু পর্যন্ত grace period রয়েছে। এটি বেশি হলে কোন source (`postgres_logs`, `edge_logs`, `auth_logs`, `function_logs` ইত্যাদি) বেশি log তৈরি করছে তা দেখো।
- **Database size:** PostgreSQL database/schema/table/index-এর প্রকৃত disk footprint। এটি Logs Query metric নয়।

Project source-এ Logs Explorer বা Supabase Management Logs API query করার app code পাওয়া যায়নি। Active tab-এ session-policy check প্রতি মিনিটে থাকে; Presence RPC network touch পাঁচ মিনিটে একবার করা হয়েছে, while session-revocation check প্রতি মিনিটেই থাকে। এই optimization redundant Presence requests কমায়; Logs Query 6 GB-এর root cause বলে প্রমাণ করে না।

### Diagnostic-এর নিরাপদ ক্রম

1. Supabase SQL Editor-এ Database source বেছে `supabase/diagnostics/Diagnose_database_storage_and_postgres_logging.sql` একবার চালাও। এটি read-only: actual DB size, largest relations/index, `pg_stat_statements`-এর expensive query, logging settings, dead tuples, active query দেখায়।
2. Usage Dashboard-এ metric যদি **Logs Query** হয়, প্রথমে শুধু `LogsExplorer_24h_source_summary.sql` Logs source (ClickHouse) ও 24h window-এ একবার চালাও—এটি scanned source breakdown।
3. শুধু summary-তে `postgres_logs` বেশি হলে `LogsExplorer_24h_postgres_signals.sql`; শুধু `edge_logs` বেশি হলে `LogsExplorer_24h_gateway_requests.sql` চালাও। এগুলো আবার scan করে, তাই বারবার চালাবে না।
4. `log_statement`, `log_min_duration_statement`, `pgaudit`, `log_min_messages` ইত্যাদি না দেখে পরিবর্তন করবে না। `log_statement=all` থাকলে statement text ingest বাড়াতে পারে; credentials/PII logs-এ চলে যাওয়ার ঝুঁকিও আছে। Logs source evidence না পাওয়া পর্যন্ত security/audit logging বন্ধ করবে না।
5. Diagnostic output শেয়ার করার আগে Email, UUID, IP, SQL text-এর private values, token/secret বা অন্য ব্যক্তিগত তথ্য redact করবে।

## ১১. Retention boundary

Run37 operational Activity/Security Events 30 দিন, expired IP block 30 দিন অতিরিক্ত, reset IP attempt 48 ঘণ্টা এবং reset quota fingerprint 35 দিন রাখে। Canonical `public.platform_audit_log` ও user/session/activity mirror এখনো 30-day cleanup-এর আওতায় নয়। কারণ existing trigger-এর সঙ্গে deletion loop হতে পারে; নিরাপদ archive design ছাড়া সেটি মুছবে না। `cron.job_run_details` cleanup কেবল দুইটি নামযুক্ত Hostel Life Job-এর 7 দিনের বেশি পুরোনো history মুছে।

## ১২. Rollback / recovery

- Run37 SQL একটি transaction। Migration-এর ভিতরে preflight/statement error হলে rollback হবে। সফল হলে migration committed থাকবে; automatic destructive rollback নেই। Cron Dashboard থেকে এই দুই named job pause/unschedule করা যায়; routine delete/replace করার আগে backup ও dependency review দরকার।
- Run38 Worker issue হলে `VITE_HOSTEL_SECURITY_WORKER_URL` সরিয়ে Frontend redeploy করে direct Supabase mode-এ ফেরা যায়। এতে signed City/Region proxy বন্ধ হয়; IP gate direct-mode সীমার মধ্যে থাকে। Worker failure হলে configured proxy mode fail-closed; direct fallback হয় না।
- Function rollback করতে আগের known-good Function source redeploy করতে হবে। Secret rotate করলে Worker এবং Supabase-এ একই সময়ে update/deploy করতে হবে।
- কোনো অবস্থাতেই Run34/35/36 বা পুরোনো all-in-one Core migration পুনরায় চালাবে না।

## ১৩. যেগুলো তোমার Account-এ Manual Setup

- Supabase Dashboard-এ backup/export ও restore-readiness যাচাই।
- `pg_cron` Enable ও Run37 SQL একবার চালানো।
- একটিমাত্র Final Database Verification SQL চালানো।
- Supabase Edge Secrets, ছয়টি Function deploy এবং JWT setting যাচাই।
- Cloudflare Worker deploy, Worker Secret, exact Origin allowlist।
- Vercel env var, redeploy, Local `.env.local`।
- Custom SMTP ও Auth Redirect URL সত্যিই configured কি না যাচাই।
- Live Health JSON, Cron run history ও diagnostic output দেখা।

এই package তৈরির সময় কোনো Live Database, Edge Function, Cloudflare Worker বা Vercel project পরিবর্তন করা হয়নি। Public logo Storage bucket স্পর্শ করা হয়নি।
