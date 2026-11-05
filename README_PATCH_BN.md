# Hostel Life — Super Admin Phase 2 Completion Patch

তারিখ: ৬ নভেম্বর ২০২৬  
ধরন: **Incremental overlay patch** — সম্পূর্ণ Project ZIP নয়।

## ১. কোন সংস্করণের ওপর প্রয়োগ করবেন

এই Patch-টি নিচের working tree-র ওপর তৈরি:

1. `Hostel Life Baseline 2026-11-05.zip`
2. আগের Public Experience / Operations patch-গুলো (আপনার আগের release chain অনুযায়ী)
3. `Hostel Life SuperAdmin Phase 1 Patch 2026-11-06.zip`
4. **বর্তমান Phase 2 Completion Patch**

আগের Phase 1 patch প্রয়োগ করা না থাকলে Phase 2 একা বসাবেন না। Phase 1 + Phase 2-এর migration-ও ক্রমানুসারে চালাতে হবে। ZIP-এর ফাইলগুলো project root-এ merge/overwrite করবেন; ZIP extract করে project-এর ভেতরে আলাদা nested folder বানাবেন না।

## ২. এই Patch-এ সম্পন্ন কাজ

### Security Monitor ও Auth protection

- Login success/failure, Registration success/failure/submission, Password Reset failure/request event আলাদা label-এ দেখা যায়।
- IP, Country Code (২ অক্ষরের code), Event Type এবং বাংলাদেশ সময়ের date range filter যুক্ত। শেষ তারিখের পুরো দিন অন্তর্ভুক্ত করতে পরের দিনের 00:00-কে exclusive upper bound ধরা হয়।
- Top Country, active Login/Registration IP block ও Password Reset IP block থেকে সংশ্লিষ্ট event-এ যাওয়া যায়।
- একই IP থেকে rolling ১ মিনিটে ৫টির বেশি ব্যর্থ Login/Registration event রেকর্ড হলে পরবর্তী app-mediated Login/Registration pre-check ১৫ মিনিটের জন্য বন্ধ হয়। গণনা ও block record Database RPC-তে হয়; UI-তে বাংলা বার্তা দেখানো হয়।
- Password Reset: একই IP থেকে এক ঘণ্টায় প্রথম ২টি অনুরোধ গ্রহণ; তৃতীয় অনুরোধে এক ঘণ্টার IP block। Email quota: বাংলাদেশ সময় অনুযায়ী দিনে সর্বোচ্চ ২টি এবং ক্যালেন্ডার মাসে সর্বোচ্চ ৫টি অনুরোধ।
- Email ও IP identity quota raw value হিসেবে রাখা হয় না; HMAC fingerprint রাখা হয়।
- Telemetry এবং Login IP Gate-এর health আলাদা করে দেখা যায়।

**গুরুত্বপূর্ণ সীমাবদ্ধতা — Login/Registration:** এই IP gate Hostel Life-এর app flow-এর আগে চলে। কেউ সরাসরি Supabase-এর public Auth endpoint-এ request পাঠালে app-এর pre-check এড়িয়ে যেতে পারে। Supabase Password Verification Attempt Auth Hook Free/Pro plan-এ উপলব্ধ নয়; বর্তমান Supabase documentation অনুযায়ী এটি Teams ও Enterprise plan-এ সীমাবদ্ধ। তাই এই Patch-কে সব Auth endpoint-এর ওপর সর্বজনীন IP firewall হিসেবে বিবেচনা করবেন না।

**Shared Wi-Fi / CGNAT সতর্কতা:** একই বাসা, হোস্টেল বা campus network-এর অনেক ব্যবহারকারী একটি public IP ভাগ করলে একজনের ছয়টি ব্যর্থ প্রচেষ্টায় পুরো shared IP-এর app-based Login/Registration ১৫ মিনিটের জন্য block হতে পারে। Password Reset-এর IP limit-ও একই shared IP-র অন্য ব্যবহারকারীদের প্রভাবিত করতে পারে। এই policy চালুর আগে বাস্তব shared-network ব্যবহার বিবেচনা করুন।

### Activity Timeline

- বাংলাদেশ সময় অনুযায়ী From/To date filter যোগ হয়েছে।
- Actor, subject, hostel, event label, target label, changed fields এবং প্রাসঙ্গিক login IP দেখানো হয়।
- Activity Timeline এবং administrative Audit Log আলাদা রাখা হয়েছে; Timeline থেকে Audit Log-এ cross-link আছে।
- Existing Run27 event capture বজায় রাখা হয়েছে; archive audit table-এ আরেকটি duplicate capture trigger যোগ করা হয়নি। Nested cascade delete-এ duplicate event capture এড়ানোর আগের নিয়মও অক্ষত।

### Telegram connection directory

- Super Admin এখন সংযুক্ত ব্যবহারকারীর নাম, Email, Phone, Telegram User ID, username, সংযোগের সময় ও সক্রিয় মেস দেখতে পারেন।
- Disconnect action শুধু Telegram channel ও pending link token সরায়; Hostel Life Auth account বা মেসের business data মুছে না।
- নিজের বর্তমান Admin account-কে এই UI থেকে disconnect করা যায় না; প্রতিটি disconnect Audit Log-এ লেখা হয়।

### Active Device Sessions

- Supabase Auth ও Hostel Life session registry — দুই জায়গায় সক্রিয় থাকা session-ই তালিকায় আসে।
- User, Email, মেস, device/browser, IP, last seen, registered date ও expiry দেখায়।
- আসল Supabase Session UUID browser-এ পাঠানো হয় না; SHA-256 reference দিয়ে নির্দিষ্ট session revoke করা হয়। নিজের বর্তমান Admin session শনাক্ত না হলে revoke fail-closed হয়।
- **গুরুত্বপূর্ণ Token সীমা:** Session revoke ভবিষ্যৎ Refresh Token ব্যবহার/refresh বন্ধ করার জন্য; ইতিমধ্যে ইস্যু হওয়া Access JWT তার `exp` সময় পর্যন্ত বৈধ থাকতে পারে। তাই এটি তাৎক্ষণিকভাবে চলমান সব API request বাতিল করে না। Project-এর JWT expiry যতক্ষণ, সম্ভাব্য অবশিষ্ট access-ও ততক্ষণ থাকতে পারে।

### Orphan Auth accounts

- Auth users প্রতি batch-এ সর্বোচ্চ ৫০০টি করে পরীক্ষা হয়; প্রতিটি account-এর membership না থাকার বিষয় যাচাই না হলে তালিকায় আসে না।
- Bulk action-এ সর্বোচ্চ ২৫টি account; typed confirmation বাধ্যতামূলক। Server প্রতিটি account delete-এর ঠিক আগে আবার membership ও Super Admin status যাচাই করে।
- এটি স্থায়ী ও ফেরত-অযোগ্য Auth deletion। Supabase Admin API deletion database transaction-এর অংশ নয়; তাই ফলাফল per-account success/failure হিসেবে ফেরত আসে।
- Bulk delete চালানোর আগে verified backup নিশ্চিত করুন।

### ৩০ দিনের operational log retention

- Activity ও Security operational log-এর লক্ষ্য ৩০ দিন। নতুন Activity/Security event insert হলে একটি transaction-guarded cleanup trigger পুরোনো log পরিষ্কার করে।
- এটি opportunistic cleanup: কোনো নতুন event না এলে নির্দিষ্ট সময়ের মধ্যে cleanup হওয়ার গ্যারান্টি নেই; Cron/Scheduler তৈরি করা হয়নি।
- Platform Audit Log প্রশাসনিক accountability-এর জন্য এই ৩০ দিনের purge-এর বাইরে রাখা হয়েছে। Password-reset email quota-র HMAC-only rows ৩৫ দিন থাকে, যাতে মাসভিত্তিক quota গণনা অক্ষত থাকে। Password-reset IP attempts ৪৮ ঘণ্টার বেশি রাখা হয় না।
- আর্থিক/মাসিক archive business data এই retention trigger দিয়ে মুছে ফেলা হয় না।

### অতিরিক্ত সামঞ্জস্য

- Login IP Gate health probe এখন request-এর trusted ingress IP ব্যবহার করে; NULL probe দিয়ে false unhealthy status তৈরি হয় না।
- End-date filter-এর exclusive upper bound পুরো শেষ দিন অন্তর্ভুক্ত করে।
- Shared System Notice Dialog component এক জায়গায় আনা হয়েছে; keyboard focus, Escape dismissal ও scroll-lock একই component-এ ব্যবস্থাপিত হয়।
- `admin-delete-unlinked-user` Edge Function-এর JWT verification config স্পষ্টভাবে enabled করা হয়েছে।

## ৩. Database migration — নিরাপদ প্রয়োগের ক্রম

এই Patch-এর নতুন migration:

`supabase/migrations/Run35_super_admin_security_retention_telegram_sessions.sql`

Phase 1-এর migration:

`supabase/migrations/Run34_super_admin_runtime_health_and_audit_readability.sql`

Production-এ যাওয়ার আগে:

1. Production Database-এর পূর্ণ backup নিন। Backup file-এর checksum/integrity যাচাই করুন এবং সম্ভব হলে আলাদা staging project-এ restore test করুন। শুধু backup file তৈরি হলেই recovery নিশ্চিত হয় না।
2. আগের snapshot-এ `supabase_migrations.schema_migrations` history table পাওয়া যায়নি। তাই migration history না বুঝে `supabase db push`, reset বা পুরোনো migration batch অন্ধভাবে চালাবেন না। সঠিক Supabase project নিশ্চিত করে SQL Editor-এ migration একবারে, পুরো script হিসেবে চালান।
3. আগে Run34 চালান এবং `Verify_Run34_super_admin_runtime_health.sql`-এর ফল দেখুন। Run34 সফল না হলে Run35 চালাবেন না।
4. এরপর Run35 সম্পূর্ণ script চালান। এটি একটি transaction, `lock_timeout=5s`, `statement_timeout=120s`; সব table/column/function/extension preflight করে। Preflight বা DDL ব্যর্থ হলে transaction rollback হওয়ার কথা। তবু error হলে একই script বারবার চালানোর আগে error সংরক্ষণ করে schema পরীক্ষা করুন।
5. Run35 সফল হওয়ার পর `supabase/verify/Verify_Run35_super_admin_completion.sql` চালান। Function grants, RLS, trigger ও final checks ফল সংরক্ষণ করুন।

**এই কাজের সময় কোনো Production SQL migration চালানো হয়নি।** Migration source ও snapshot মিলিয়ে static review করা হয়েছে; PostgreSQL server-এ বাস্তবে execute করা হয়নি। Production-সদৃশ staging-এ প্রথমে চালিয়ে verify করা আবশ্যক।

## ৪. Edge Functions deploy

Database migration ও verification-এর পরে সঠিক Supabase project link করে নিচের function-গুলো deploy করুন:

```powershell
supabase functions deploy auth-security-gate
supabase functions deploy record-auth-event
supabase functions deploy request-password-reset
supabase functions deploy admin-delete-unlinked-user
```

`supabase/config.toml`-এ:
- `auth-security-gate`, `record-auth-event`, `request-password-reset`: `verify_jwt = false` — এগুলো public Auth/telemetry flow-এর endpoint; handler-এর Origin/IP validation ও server-only RPC key ব্যবহার বজায় রাখতে হবে।
- `admin-delete-unlinked-user`: `verify_jwt = true` — উপরন্তু handler নিজে user JWT ও `super_admin` role যাচাই করে।

### Edge Function secrets / origins

Supabase Dashboard-এর Edge Function Secrets-এ built-in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` সঠিকভাবে উপলব্ধ কি না যাচাই করুন। এগুলো কখনো frontend `.env`, Vite variable বা GitHub repository-তে দেবেন না।

`request-password-reset`-এর জন্য বাধ্যতামূলক:
- `PASSWORD_RESET_HMAC_SECRET`: অন্তত ৩২ অক্ষরের/bytes-এর গোপন, random secret; শুধু server-side। এটি stable রাখুন—অকারণে rotate করলে পূর্বের quota fingerprint আর নতুন fingerprint মেলবে না।

ঐচ্ছিক কিন্তু সুপারিশকৃত:
- `HOSTEL_SECURITY_HMAC_SECRET`: Telemetry identity/IP fingerprint-এর জন্য আলাদা stable HMAC secret; না থাকলে বর্তমান code server-side service-role key fallback ব্যবহার করে।
- `HOSTEL_SECURITY_ALLOWED_ORIGINS`: `record-auth-event` ও `auth-security-gate`-এর exact comma-separated frontend origins।
- `PASSWORD_RESET_ALLOWED_ORIGINS`: Password Reset function-এর exact comma-separated frontend origins।

নিজস্ব production hostname ব্যবহার করলে সেটি দুই origin allowlist-এ যোগ করুন। Origin-এ path বা trailing slash প্রয়োজন নেই। Secret value কখনো patch/repository-তে রাখা হয়নি।

## ৫. Cloudflare rate-limit — আলাদা ঐচ্ছিক layer

Edge Function-এর database IP limiter এই Patch-এ আছে। Cloudflare WAF-এর অতিরিক্ত rule কেবল তখনই কাজ করবে, যখন Password Reset request সত্যিই আপনার নিজের Cloudflare-proxied hostname/zone দিয়ে যায়। Frontend যদি সরাসরি `https://<project-ref>.supabase.co/functions/v1/request-password-reset` কল করে, আপনার website-এর Cloudflare zone সেই request দেখতে পায় না। Supabase Custom Domain paid-plan add-on; শুধু Cloudflare dashboard-এ rule বানালেই default `supabase.co` endpoint আপনার zone-এর ভেতর চলে আসবে না।

যদি ভবিষ্যতে একটি proxied custom API hostname দিয়ে function request route করেন, Cloudflare Rate Limiting Rule-এর উদাহরণ:

- Expression: `(http.request.method eq "POST" and http.request.uri.path eq "/functions/v1/request-password-reset")`
- Counting characteristic: source IP address
- Threshold: ২ request / ৩৬০০ seconds
- Action: Block
- Mitigation timeout: ৩৬০০ seconds

Cloudflare UI-তে আপনার plan অনুযায়ী rate-limiting feature ও minimum mitigation duration যাচাই করুন। এই rule বর্তমান প্রকল্পে configure বা activate করা হয়নি; এটি user-managed external layer।

## ৬. পরীক্ষা ও সীমাবদ্ধতা

এই প্যাচ তৈরির সময় যাচাইকৃত ফল:

- Node regression suite: **৪৯০/৪৯০ pass**
- Backup Assistant Python unit suite: **৩০/৩০ pass**
- `node --check src/services/authService.js`: pass
- `node --check src/services/platformService.js`: pass
- Production snapshot-এর সঙ্গে Run35-এর ৬১টি non-Auth application column এবং `pgcrypto` extension মিলেছে; Supabase-managed `auth.users` / `auth.sessions` columns migration preflight-এ live যাচাই হবে।

যা এখানে করা সম্ভব হয়নি:

- `npm run build`: Vite dependency অনুপস্থিত; `npm ci` সময়সীমার মধ্যে শেষ হয়নি। তাই frontend production build pass দাবি করা হচ্ছে না।
- Deno Edge Function deploy/runtime test হয়নি।
- PostgreSQL migration বাস্তবে execute হয়নি; live RLS/RPC behavior বা lock contention পরীক্ষা হয়নি।
- Production restore test হয়নি; Backup & Recovery runbook উন্নত হয়েছে, কিন্তু live restore rehearsal আলাদা কাজ।
- Cloudflare WAF rule তৈরি হয়নি।

Node test-গুলো source/contract regression test; বাস্তব Production deployment-এর বিকল্প নয়। প্রথমে staging project-এ migration, Edge Function deploy, login, failed-login threshold, password-reset quota, Telegram disconnect, session revoke, orphan account dry-run/list ও ৩০ দিনের retention behavior যাচাই করে তারপর Production release করুন।

## ৭. Rollback/Recovery নীতি

- Run35 একটি transaction-এ হওয়ায় migration চলাকালে কোনো SQL error হলে transaction rollback হবে। সফলভাবে commit হওয়ার পরে rollback করতে হলে আগের verified database backup restore বা DBA-reviewed inverse migration প্রয়োজন; এই patch স্বয়ংক্রিয়ভাবে পুরোনো event constraint/function definitions ফিরিয়ে দেওয়ার script দেয় না।
- Edge Function deploy-এর আগের deployed versions সংরক্ষণ করুন, যাতে প্রয়োজন হলে আগের function version redeploy করা যায়।
- Orphan Auth delete irreversible; backup ছাড়া bulk delete করবেন না।
- Session revoke ও Telegram disconnect-এর মতো runtime action migration rollback দিয়ে ফেরত আনা যায় না; action-এর আগে target user/session যাচাই করুন।

---

**Patch format:** Phase 1 reference-এর তুলনায় শুধু এই phase-এ নতুন/পরিবর্তিত source files রাখা হয়েছে। `node_modules`, `.env`, credentials, generated cache বা database dump ZIP-এ নেই।
