# Run45 — Security Simplification ও IP + Email Pair Protection

## Baseline
- ব্যবহারকারীর সর্বশেষ পূর্ণ প্রজেক্ট: `Hostel Life(5).zip`
- SHA-256: `5891411ec602624280100b2c6a76b0f0416ab600930e098924943ed95c2fb4d3`
- এটি ওই ZIP-এর ওপর তৈরি Incremental Patch; কোনো আগের Project ZIP-কে নতুন Baseline ধরে নেওয়া হয়নি।

## চূড়ান্ত নকশা
1. Supabase Auth থাকবে মূল Authentication Provider। Native Auth Rate Limit সক্রিয় থাকবে।
2. App-level অতিরিক্ত Login/Registration pre-check trusted IP + normalized email-এর server-side HMAC fingerprint জোড়ায় কাজ করবে।
3. ১ মিনিটে একই IP + একই ইমেইল থেকে ৬টি ব্যর্থ Login/Registration হলে ১৫ মিনিটের Automatic Pair Block হবে। অন্য Email একই Wi-Fi/CGNAT IP ব্যবহার করলে সে এই Automatic Block-এর শিকার হবে না।
4. Password Reset-এর আগের IP সীমা (এক ঘণ্টায় ২টি; তৃতীয় অনুরোধে ১ ঘণ্টা Block) এখন IP + email pair-এ প্রযোজ্য। বিদ্যমান Email quota (Dhaka local day-এ ২টি, calendar month-এ ৫টি) অক্ষত।
5. Signup OTP resend-এর আগের IP সীমা (এক ঘণ্টায় ২টি) এখন IP + email pair-এ প্রযোজ্য; বিদ্যমান Email quota (প্রতিদিন ২টি) অক্ষত। IP পাওয়া না গেলে শুধু অতিরিক্ত IP quota skip হবে; Email quota এবং Supabase Auth rate limit চলবে।
6. Super Admin-এর Manual IP Block ইচ্ছাকৃতভাবে Global থাকবে। UI-তে `Manual Global IP Block` হিসেবে আলাদা করে দেখানো হবে। Automatic Pair Block-এ সংশ্লিষ্ট attempted email দেখাবে এবং Unblock করলে শুধু ওই Email + IP pair মুক্ত হবে।
7. পুরোনো Automatic IP-only Block-এ কোন Email দায়ী ছিল তা নির্ভরযোগ্যভাবে জানা যায় না। তাই Migration ওই দুই ধরনের পুরোনো Automatic IP-only Block expire করবে; Super Admin-এর `manual:` Global Block অপরিবর্তিত থাকবে।
8. Cloudflare Worker রাখা হয়েছে, নতুন করে পরিষ্কার optional signed Geo Proxy হিসেবে। Vercel-এ Worker URL না থাকলেও Direct Supabase Auth চলবে। Worker/Geo Signature/Proxy 5xx failure হলে Frontend নির্দিষ্ট failure code-এ Direct Supabase-এ fallback করবে। Worker আর Authentication-এর বাধ্যতামূলক dependency নয়।
9. City/Region কেবল Cloudflare `request.cf` থেকে পাওয়া গেলে থাকবে। IPinfo Lite/third-party Geo lookup বাদ। Location না পাওয়া Login বা OTP আটকাবে না।
10. Registration button সবসময় `রেজিস্ট্রেশন করুন`। Supabase signup response-এ session পাওয়া গেলে (Email Confirmation বন্ধ) OTP ধাপ বাদ দিয়ে বর্তমান AuthContext-এর Onboarding/Joining route-এ যাবে। Session না থাকলে (Email Confirmation চালু) OTP ধাপ দেখাবে। Supabase Auth confirmation setting SQL table-এর config নয়; actual Signup response-ই authoritative।
11. বর্তমান ZIP-এ Google OAuth/`signInWithOAuth` implementation নেই। কোনো Continue with Google যোগ করা হয়নি; stale future-setup legal copy বাদ। Super Admin Google Authenticator/TOTP MFA আলাদা, সেটি অক্ষত।
12. বর্তমান ZIP-এ Language Switcher/i18n runtime নেই; Bengali UI-ই থাকবে, technical English label-গুলো translate/remove করার অজুহাতে কোনো অপ্রয়োজনীয় feature বা framework যোগ করা হয়নি।

## Database পরিবর্তন
- Migration: `supabase/migrations/Run45_auth_ip_email_pair_limits.sql`
- Read-only Verification: `supabase/verify/Verify_Run45_auth_ip_email_pair_limits.sql`
- নতুন Table তৈরি হয় না।
- বিদ্যমান `private.hl_security_ip_blocks`-এ `email_fingerprint` column; primary key `(scope, ip_address, email_fingerprint)`। খালি fingerprint `''` শুধু Manual Global Block-এর জন্য।
- বিদ্যমান `private.hl_password_reset_ip_attempts`-এ `email_fingerprint` column; Password Reset attempt quota pair অনুযায়ী count হয়।
- Signup OTP resend বিদ্যমান `private.hl_security_events` table-ই ব্যবহার করে; নতুন table নেই।
- Raw attempted email `private.hl_security_events.attempt_email`-এ থাকে (বিদ্যমান private schema এবং ৩০ দিনের retention-এর অধীনে)। IP Block table-এ raw email নয়, HMAC fingerprint থাকে; Super Admin RPC matched event থেকে email দেখায়।
- কোনো Password, OTP, Service Role key বা HMAC secret Database-এ লেখা হয় না।

## Compatibility ও Deploy Order
1. আগে বর্তমান Production Master Backup নিন এবং `Hostel Life(5).zip`-কে অক্ষত রাখুন।
2. Patch ZIP Extract করে একই relative path-এ Merge করুন; unrelated files মুছবেন না। `DELETE_FILES.txt`-এ দেওয়া obsolete Cloudflare Express middleware শুধু তালিকাভুক্ত অবস্থায় সরান।
3. SQL Editor-এ `Run45_auth_ip_email_pair_limits.sql` একবার চালান। এটি Run35–Run44-এর বিদ্যমান Security schema preflight করে; কোনো dependency না মিললে Transaction বন্ধ হবে।
4. এরপর `Deploy_Run45_EdgeFunctions.ps1` অথবা Supabase CLI দিয়ে চারটি Function Deploy করুন: `auth-security-gate`, `record-auth-event`, `request-password-reset`, `request-signup-otp`। `supabase/config.toml`-এর `verify_jwt=false` বজায় রাখুন; Service Role key Frontend-এ দেবেন না।
5. প্রথমে Vercel-এ `VITE_HOSTEL_SECURITY_WORKER_URL` ফাঁকা রেখে Direct Mode-এ Login, Failed Login pair limit, Signup, OTP, Password Reset, Super Admin MFA এবং Security Monitor Smoke Test করুন।
6. একই IP থেকে Email-A দিয়ে ৬টি ব্যর্থ Login দিন: পরের প্রচেষ্টা ১৫ মিনিট Block হবে। একই IP থেকে Email-B দিয়ে পরীক্ষা করুন: Manual Global Block না থাকলে Email-B Block হবে না। এই Test Production-এ না করে Staging/Test Account-এ করুন।
7. Supabase Auth Email Confirmation ON/OFF পরীক্ষা আলাদা Staging project-এ করুন। ON হলে OTP; OFF হলে Session তৈরি হয়ে Onboarding/Join route। Production Auth setting পরিবর্তন করে পরীক্ষা করবেন না।
8. Direct Mode স্থিতিশীল হওয়ার পর Cloudflare Worker `README_BN.md` অনুযায়ী Deploy করুন; একই HMAC Secret Cloudflare Worker ও Supabase Functions-এ রাখুন। Worker health JSON এবং signed Request যাচাই না হওয়া পর্যন্ত Vercel Worker URL যোগ করবেন না।
9. Worker সক্রিয় করার পরেও Proxy/Geo failure হলে Direct Supabase fallback থাকবে; তবে real `429` Pair Block response bypass করা হবে না।

## Secret Boundary
- Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`; ঐচ্ছিক Worker enable করতে হলে `VITE_HOSTEL_SECURITY_WORKER_URL` শুধু Worker origin।
- Supabase Edge Function Secrets: `SUPABASE_SECRET_KEYS` বা legacy `SUPABASE_SERVICE_ROLE_KEY`, `HOSTEL_SECURITY_HMAC_SECRET`, `PASSWORD_RESET_HMAC_SECRET`, `HOSTEL_GEO_PROXY_HMAC_SECRET` এবং অন্য বিদ্যমান feature secrets।
- Cloudflare Worker Secret: `HOSTEL_GEO_PROXY_HMAC_SECRET`।
- `wrangler.toml.example`, `.env.example`, SQL Migration, Frontend Source, localStorage বা logs-এ কোনো actual secret যোগ করা হয়নি।
- `IPINFO_TOKEN` অপ্রয়োজনীয়। `HOSTEL_GEO_PROXY_REQUIRED` আর Code-এ ব্যবহার হয় না; deploy ও Smoke Test সফল হলে পুরোনো Secret মুছে দিতে পারবেন।

## Validation
- বর্তমান ZIP-এর untouched baseline: **712 tests; 698 passed, 14 failed**।
- Run45 patch-এর পর: **716 tests; 703 passed, 13 failed**। অবশিষ্ট ১৩টি failure একই পুরোনো Backup, Password Re-authentication metric, Route/Archive/History layout assertion—যেগুলো untouched baseline-এও ব্যর্থ ছিল। অনুপস্থিত Google OAuth staging guide-এর পুরোনো assertion-টি no-OAuth contract test দিয়ে বদলানো হয়েছে।
- নতুন Run45 pair-limit/optional Worker/Registration tests পাস করেছে।
- Cloudflare Worker ও পরিবর্তিত JavaScript module-এ `node --check` পাস করেছে। পরিবর্তিত Edge Function TypeScript ফাইলগুলোর TypeScript `transpileModule` syntax pass হয়েছে; পূর্ণ Deno type-check করা হয়নি।
- পূর্ণ Vite production build চালানো হয়নি—ZIP-এ `node_modules` নেই এবং dependency install/build environment প্রস্তুত করা হয়নি।
- SQL Migration static review করা হয়েছে; PostgreSQL server না থাকায় Migration execute বা live DB validation করা হয়নি।
- এই কাজের সময় Production Supabase Database, Vercel বা Cloudflare account-এ প্রবেশ/পরিবর্তন করা হয়নি। Migration Production-এ চালানো হয়নি; প্রদত্ত Read-only Verification SQL ফল যাচাই করতে হবে.
