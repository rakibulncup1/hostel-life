# Hostel Life — Run40 Change Log ও Deployment নির্দেশনা

## Baseline ও নিরাপত্তা

- এই Candidate-এর ভিত্তি: `HostelLife_Run39_Update_v2_SchemaFix.zip` / ব্যবহারকারীর মূল `Hostel Life(4).zip` থেকে তৈরি সর্বশেষ অনুমোদিত কোড-ইতিহাস।
- মূল `Hostel Life(4).zip` অপরিবর্তিত রাখা হয়েছে; সব পরিবর্তন আলাদা Working Copy-তে করা হয়েছে।
- Production Supabase, Cloudflare, Vercel বা ব্যবহারকারীর কোনো Live Data-তে পরিবর্তন করা হয়নি।
- Run40-এ কোনো নতুন business/audit/OTP table তৈরি করা হয়নি; বিদ্যমান notification, `daily_meal_records`, `meal_requests`, `archive_period_audit` ও `private.hl_security_events` ব্যবহার করা হয়েছে।

## Run40-তে করা পরিবর্তন

### 1. Market ও Deposit Notification
- Market parent row শূন্য total-এ তৈরি হয়ে item যোগের পর total update হওয়ার বর্তমান flow অনুসারে notification trigger-কে প্রথম `0 -> positive total` update-এ সরানো হয়েছে।
- তাই আগের INSERT trigger-এর মতো মোট টাকা হিসাব হওয়ার আগে ৳০ পাঠানোর সমস্যা এড়ানো হবে।
- Deposit notice-এ সদস্যের নাম, তাঁর নামে জমা হওয়া পরিমাণ, এন্ট্রিকারীর নাম, তারিখ এবং থাকলে বিবরণ দেখানো হয়।
- Trigger সক্রিয় সদস্যদের inbox-এ লেখে; বিদ্যমান notification dispatcher/Telegram opt-in flow-ই পরবর্তী ডেলিভারি করে।

### 2. Final Meal Audit
- `public.hl_get_final_meal_audit(date)` একটি read-only, hostel-scoped manager RPC।
- এটি `daily_meal_records.finalization_source`, `finalized_by`, `finalized_at`, অনুমোদিত `meal_requests`, এবং `archive_period_audit` থেকে per-member source/actor/time, manual/request/system totals, manager event summaries এবং pending member list তৈরি করে।
- কোনো নতুন audit table বা polling loop নেই।
- এটি নির্বাচিত তারিখটি চলমান period-এর মধ্যে হলে উপলভ্য। Archived period-এর correction history আগের Archive workflow-তেই থাকে।
- পুরোনো রেকর্ডে যদি actor/source/member identifier ঐতিহাসিকভাবে সংরক্ষিত না থাকে, তার নাম/উৎস কৃত্রিমভাবে বানানো যাবে না। পুরোনো audit row-তে নির্দিষ্ট সদস্যের ID না থাকলে সেই event থেকে member name পুরোপুরি পুনর্গঠন করা সম্ভব নাও হতে পারে।
- অতীত তারিখের roster `joined_at`/`deactivated_at` ও বর্তমান block state থেকে অনুমান করা হয়; schema-তে সম্পূর্ণ reactivation timeline নেই, তাই পুরোনো সদস্যদের পুনরায় যোগদানের ইতিহাসে pending count সব ক্ষেত্রে শতভাগ নির্ভুল নাও হতে পারে।

### 3. Signup OTP resend protection
- Supabase Auth-এর native signup OTP sender ও `verifyOtp`-ই ব্যবহার করা হয়েছে। কোনো OTP বা password আলাদা করে সংরক্ষণ হয় না।
- Resend UI cooldown ১২০ সেকেন্ড। Server quota: প্রতি normalized email-এ Dhaka calendar day-তে সর্বোচ্চ ২টি অনুমোদিত resend attempt এবং প্রতি IP-তে rolling ১ ঘণ্টায় সর্বোচ্চ ২টি।
- Quota-এর event বিদ্যমান `private.hl_security_events`-এ সংরক্ষিত হয়; Run37-এর বিদ্যমান retention/cleanup policy প্রযোজ্য। নতুন table নেই।
- Custom quota resend-এর জন্য; প্রথম signup OTP পাঠানো Supabase Auth-এর নিজস্ব rate limit-এর অধীনে থাকে। Supabase Auth dashboard-এর email/OTP limits এবং expiry-ও সঠিকভাবে সেট থাকতে হবে।
- নতুন Edge Function: `request-signup-otp`; `supabase/config.toml`-এ JWT verify disabled, কারণ registration-এ ব্যবহারকারী এখনো authenticated নয়। Function নিজস্ব origin, payload, HMAC/visitor ও quota checks করে।
- Function-এর জন্য Run39-এ থাকা `PASSWORD_RESET_HMAC_SECRET` এবং Supabase-এর built-in URL/publishable/service secret পরিবেশ ভ্যারিয়েবল প্রয়োজন। Signed Geo Worker বাধ্যতামূলক করা থাকলে নতুন route `request-signup-otp`-সহ Cloudflare Worker-ও আপডেট করে deploy করতে হবে; Worker ও Function-এর বিদ্যমান HMAC secret/nonce settings অক্ষত রাখতে হবে।

### 4. UI/UX
- Meal Sheet, Archive, Reports, rankings, help/system info, Telegram, manager settings/member/Khala/month sections ও dining feature screens-এ ছোট contextual `InfoPanel` যোগ/সাজানো হয়েছে।
- Toast top-positioned, green success/red error, close button ছাড়া এবং প্রায় ২.৩–২.৮ সেকেন্ডে auto-dismiss (duration bounded)।
- Login/Registration/Join-এর saved theme override করা হয় না। OTP card এবং mobile brand area theme tokens ব্যবহার করে।
- Join page থেকে পুনরাবৃত্ত action subtitle বাদ, desktop brand divider line সরানো, এবং mobile choice panel-কে current theme token-এ আনা হয়েছে।

## গুরুত্বপূর্ণ Database পরিবর্তন

`supabase/migrations/Run40_notification_meal_audit_and_signup_otp_guard.sql`:
- Existing `private.hl_security_events_event_type_run39_check`-কে Run40 constraint দিয়ে replace করে `signup_otp_resend` event অনুমোদন করে; আগের event types বজায় থাকে।
- দুটি partial index তৈরি করে email fingerprint এবং IP quota lookup সাশ্রয়ী করে।
- দুটি notification trigger/function update করে, একটি read-only final-meal audit RPC যোগ করে, এবং একটি quota RPC যোগ করে।
- কোনো পুরোনো financial/meal row update/delete করে না; transaction ও prerequisite preflight আছে।

## Deployment — Production-এ সরাসরি চালাবেন না

1. Production-এর নতুন পূর্ণ backup নিন এবং আলাদা Staging Supabase project/database-এ restore করুন।
2. Staging-এর Run1–Run38 schema যাচাই করে Run39 v2 migration চালান: `supabase/migrations/Run39_targeted_hostel_life_improvements.sql`। Run39 v2-এর Read-Only preflight/verification ফলাফল `READY` না হলে থামুন।
3. Run39 v2 সফল ও যাচাই হওয়ার পরে Run40 preflight চালান: `supabase/verify/Run40_Preflight_READ_ONLY.sql`। প্রতিটি row `READY` না হলে Run40 চালাবেন না।
4. Staging-এ `supabase/migrations/Run40_notification_meal_audit_and_signup_otp_guard.sql` একবার চালান। Error হলে পুনরায়/আংশিক SQL চালাবেন না; সম্পূর্ণ error পাঠিয়ে আগে schema diagnosis করুন।
5. এরপর `supabase/verify/Run40_Verification_READ_ONLY.sql` চালান; সব item `READY` হতে হবে।
6. Edge Function `request-signup-otp` staging-এ deploy করুন। Supabase config-এর `verify_jwt=false` মান কার্যকর হয়েছে নিশ্চিত করুন; CLI দিয়ে deploy করলে সাধারণত `--no-verify-jwt` ব্যবহার করুন। Secret কখনো frontend, notes বা Git-এ রাখবেন না।
7. Signed Geo Worker enforcement চালু থাকলে Worker route allowlist-এ `/functions/v1/request-signup-otp`-এর পরিবর্তনসহ Worker deploy করুন। আগে Worker + Edge Function একসঙ্গে যাচাই করুন।
8. Staging-এ market create (একাধিক item), manager-এর নিজের market, member deposit, Telegram opt-in, six-member request/manual finalization split, pending member display, wrong/expired OTP, resend cooldown, daily/email ও hourly/IP quota এবং সব theme (Light/Blue/Dark/অন্য saved theme) পরীক্ষা করুন।
9. শুধু Staging sign-off-এর পরে production backup, rollback plan ও maintenance window নিয়ে deploy বিবেচনা করুন। এই ZIP কোনো Production deployment করে না।

## Validation ফলাফল ও সীমাবদ্ধতা

- নতুন Run40 Targeted tests: **9 passed, 0 failed**।
- সম্পূর্ণ Node suite: **565 tests; 562 passed, 3 failed**। একই ৩টি test Run39 v2 baseline-এও ব্যর্থ ছিল: Google OAuth guide absent-from-ZIP expectation, Backup restore file-picker expectation, এবং password re-authentication login metric expectation। Run40-তে নতুন test failure যোগ হয়নি।
- Vite production build চালাতে গিয়ে `vite: not found` এসেছে। `npm ci` নির্ধারিত সময়ে dependency install শেষ করতে পারেনি; তাই production build যাচাই করা যায়নি।
- PostgreSQL/Supabase staging database ও Deno runtime এখানে নেই; SQL migration এবং Edge Function runtime-এ execute করে যাচাই করা হয়নি। Static tests কোনোভাবেই live database success-এর নিশ্চয়তা নয়।
- Production database/Cloudflare/Vercel-এ কোনো পরিবর্তন করা হয়নি।

## Canonical Run40 files

- `supabase/migrations/Run40_notification_meal_audit_and_signup_otp_guard.sql`
- `supabase/verify/Run40_Preflight_READ_ONLY.sql`
- `supabase/verify/Run40_Verification_READ_ONLY.sql`
- `supabase/functions/request-signup-otp/index.ts`
- `tests/run40NotificationMealAuditOtp.test.js`
