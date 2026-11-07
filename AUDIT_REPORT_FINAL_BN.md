# Hostel Life — Final Consolidation Audit Report

## Scope

Final patch scope: আগে প্রয়োগ করা Phase 1 + Phase 2 + Run36-এর ওপর Run37 operational completion, Run38 signed Cloudflare geo proxy, presence heartbeat optimization এবং DB/Logs diagnostics। Baseline ও পূর্ববর্তী patch layer audit copy-তে reconstruct করে test করা হয়েছে। Production deployment করা হয়নি।

## Logs usage finding

“Logs Query” হলো Logs Explorer/Management API/CLI দিয়ে logs পড়ার সময় scan করা log-data volume; PostgreSQL database size বা Logs Ingest নয় এবং সরাসরি GB-ভিত্তিক billing item নয়। Supabase-এর 2026-09-24 documentation অনুযায়ী allowance একই মাসের Logs Ingest ×100; Free plan-এর 1 GB ingest থেকে 100 GB query allowance। Query allowance documentation-এ “Not yet enforced” বলা হয়েছে। Free Logs Ingest quota 1 GB/month; current Supabase documentation-এ 2027-এর শুরু পর্যন্ত grace period বলা হয়েছে।

Project source-এ Supabase Management Logs API বা Logs Explorer query call পাওয়া যায়নি। AuthContext active tab-এ session-policy check ও presence RPC আগের implementation-এ প্রতি 60 seconds চলত; DB presence write নিজেই 10-minute throttle-এ ছিল। Session security check 60 seconds রেখেই presence network RPC 5 minutes-এ নেওয়া হয়েছে। এটি presence RPC volume আনুমানিক 80% কমায়; 6 GB Logs Query-এর root cause প্রমাণ করে না।

6 GB যদি Logs Query monthly total হয়, Free plan-এর 100 GB monthly query allowance-এর তুলনায় কম; 6 GB/day একমাস চললে আনুমানিক 180 GB/month হতে পারে। 6 GB যদি Logs Ingest হয়, সেটি সম্পূর্ণ আলাদা ও অধিক জরুরি source investigation চায়। Dashboard-এর metric name, selected project এবং time range ছাড়া 6 GB-কে database growth বা logging bug বলা যাবে না।

## Database migration strategy

Run34, Run35, Run36 ব্যবহারকারী ইতিমধ্যে চালিয়েছেন বলে জানিয়েছেন; এই package সেগুলো পুনরায় চালায় না। একমাত্র নতুন transactional migration: `Run37_final_operational_database_completion.sql`; `pg_cron` আগে Dashboard-এ enabled থাকতে হবে। Migration cron objects এবং Run35 retention tables/columns preflight করে, cleanup routine তৈরি করে এবং দুটি named daily job schedule করে। Shared advisory lock `728194650175` Run35 insert cleanup trigger-এর সঙ্গে সামঞ্জস্যপূর্ণ। Canonical public audit log, Hostel/Member/Market/Meal/financial records, Auth accounts, session history বা Storage objects মুছে না।

একটি read-only `Verify_Final_Database_Clearance.sql` Run34–37-এর key functions, RLS/permissions, geo columns, retention triggers, cron schedules ও lock যাচাই করে। SQL static-reviewed; Live PostgreSQL/pg_cron-এ execute করা হয়নি।

## Package contents

- একটিমাত্র Run37 migration ও দুইটি named Cron schedule।
- একটিমাত্র combined read-only Run34–37 Database Clearance verification।
- Actual Postgres size, largest relations/index, pg_stat_statements, logging configuration, dead tuples ও active queries diagnostic।
- সীমিত Logs Explorer source summary এবং conditional Postgres/API Gateway drill-down query।
- Run38 Cloudflare Worker + HMAC-signed location metadata, কেবল তিনটি Security Function route করে।
- Run38 Frontend custom-fetch routing ও fail-closed configuration।
- ছয়টি Edge Function source overlay ও Supabase JWT config।
- AuthContext presence network touch প্রতি 5 minutes; session-policy check প্রতি 1 minute অপরিবর্তিত।
- Selected regression tests, README, manifest ও checksums।

## Automated validation

- Full reconstructed project Node test suite: **522/522 pass**।
- Backup Assistant Python test suite: **12/12 pass**।
- Supabase `config.toml` parse: pass।
- Wrangler TOML example parse: pass।
- Worker/client/service JavaScript syntax checks: pass।
- ZIP integrity ও SHA-256 manifest: final packaging-এ যাচাই করতে হবে।
- Vite production build: **not verified**। `npm ci` এই environment-এ timeout করেছে এবং পরে `vite` অনুপস্থিত ছিল। User-এর Windows project-এ `npm ci`, `npm test`, `npm run build` চালাতে হবে।
- SQL migration/verification: static review only; এখানে Postgres/pg_cron server নেই।
- Deno Edge Function ও Cloudflare Worker: Production-এ deploy বা live execution হয়নি।

## Safety boundaries

- কোনো Live Supabase SQL, Edge Function, Cloudflare Worker বা Vercel deployment করা হয়নি।
- Public logo Storage bucket অপরিবর্তিত।
- Run37 scheduled cleanup কেবল উল্লেখিত operational telemetry, reset quota/ip attempt এবং দুইটি নির্দিষ্ট Cron job run-history সীমার মধ্যে কাজ করবে।
- `public.platform_audit_log` আলাদা retained; বর্তমান mirrored activity trigger design-এর সঙ্গে automatic 30-day deletion নিরাপদ নয়।
- City/Region হলো approximate Cloudflare IP geolocation, GPS নয়; সব IP-এর জন্য City guaranteed নয়।
- Direct Supabase Auth API app-side pre-auth gate bypass করতে পারে; Worker শুধু তিনটি নির্দিষ্ট Edge Function proxy করে, Universal Auth Firewall নয়।

## Production clearance-এর আগে User-side acceptance

1. Verified Database backup/restore readiness।
2. `pg_cron` enable; Run37 একবার সফলভাবে run।
3. Combined clearance SQL-এ zero failures।
4. ছয়টি Edge Function deploy ও JWT matrix মিলেছে।
5. Supabase + Cloudflare-এ একই geo HMAC secret; exact Origin allowlist; Worker deployed।
6. `VITE_HOSTEL_SECURITY_WORKER_URL` Vercel-এ, redeploy ও Local `.env.local` configured।
7. Health JSON, normal Login/Reset, Admin/Telegram/Session ও Cron run history verified।
8. 6 GB metric Logs Query না Logs Ingest নিশ্চিত; bounded source summary এবং Database diagnostic reviewed।
9. Windows environment-এ `npm ci`, `npm test`, `npm run build` সফল।

এই account/runtime checks শেষ না হওয়া পর্যন্ত সিস্টেমকে Production-cleared বলা যাবে না।
