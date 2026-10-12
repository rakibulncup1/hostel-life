# Hostel Life — Final Delivery (বাংলা)

এই ZIP-টি তোমার বর্তমান প্রজেক্টের পরবর্তী build। এটি আগের project history-কে মুছে নতুন করে তৈরি করা নয়; বর্তমান source-এ বিদ্যমান feature recovery, archive/period flow, manager operations এবং Super Admin UI-র সঙ্গে শেষ অডিটে চিহ্নিত usage ও avatar-upload পরিবর্তনগুলো একত্রে রাখা হয়েছে।

## প্রধান পরিবর্তন

- RPC request cache-এ একই key-তে ইতিমধ্যে চলমান request থাকলে `force` refresh হলেও নতুন duplicate RPC শুরু হবে না। এতে একই সময়ে focus/realtime/retry থেকে আসা duplicate fetch কমে।
- ড্যাশবোর্ড refresh এবং realtime refresh-এ আগে থেকেই throttle/cache আছে; এগুলো বজায় রাখা হয়েছে।
- profile avatar upload এখন প্রতি ব্যবহারকারীর জন্য একটি stable Storage object ব্যবহার করে, যাতে প্রত্যেক upload-এ স্থায়ী নতুন file জমতে না থাকে। Combined SQL-এ ওই bucket-এর own-folder SELECT/INSERT/UPDATE/DELETE policies যোগ করা হয়েছে।
- রিপোর্টের টেবিলের font 13px এবং header 12px করা হয়েছে।
- Core SQL migration-এ বাজার এন্ট্রি create/edit, manager meal-request edit badge, deposit/other transaction adjustment, closed period-এর পরে manager change, avatar bucket/policies এবং duplicate every-minute meal finalizer removal আছে।
- Super Admin Phase 2 backend-এ role protection, manager-controlled gate settings, one-time/expiring registration ও hostel-creation codes, announcements/developer info settings, limited member directory, block/suspend/soft-delete এবং admin audit log আছে।

## Supabase audit থেকে গুরুত্বপূর্ণ findings

Uploaded audit snapshot-এ `pg_stat_statements` cumulative counts ছিল: `get_dashboard_data` 240,147; `get_offline_meal_bundle` 238,916; `get_member_directory_v4` 202,015; `get_running_period_context` 203,748। এগুলো stats-reset timestamp ছাড়া নির্দিষ্ট ২৪ ঘণ্টার সংখ্যা বলা যাবে না। `pg_cron`-এ `private.finalize_due_meal_days()`-এর daily job-এর পাশাপাশি `hostel_life_meal_finalizer` নামে প্রতি-মিনিটের duplicate job ছিল। Core migration শুধু সেই duplicate নামের job unschedule করে; daily finalizer, daily lock ও retention job রেখে দেয়।

Audit snapshot-এ `profile-avatars` bucket অনুপস্থিত ছিল এবং app source সেটি ব্যবহার করছিল—এটি avatar upload ব্যর্থতার একটি বাস্তব mismatch। PostgreSQL log settings scan-এ সাধারণ query logging খুব verbose পাওয়া যায়নি; তাই Log Ingestion-এর সম্পূর্ণ কারণ শুধু ওই settings দিয়ে ব্যাখ্যা করা যায় না।

## SQL চালানোর আগে/পরে

1. Supabase-এ backup/export নাও।
2. `Hostel-Life-Final-Migration.sql` আলাদা ফাইল হিসেবে চালাও (project root-এর `supabase/HOSTEL_LIFE_CORE_USAGE_AND_FEATURE_FIXES_V1.sql` এবং `HOSTEL_LIFE_SUPER_ADMIN_PHASE2_V1.sql` একই দুই অংশ আলাদা migration file হিসেবেও আছে)।
3. Core phase এবং phase 2-এর verification rows দেখো। যদি error হয়, stop করে পূর্ণ error text সংরক্ষণ করো; পুরোনো recovery SQL এলোমেলোভাবে চালিও না।
4. সফল হলে Supabase SQL Editor-এ শেষে থাকা commented instructions অনুসারে শুধু নিজের verified Auth UUID-র `profiles.role`-কে `super_admin` করো। এই ZIP/script নিজে কাউকে super admin বানায় না।
5. `/super-admin`-এ ঢুকে main account password দিয়ে re-authentication করো।
6. Dashboard Usage এবং Supabase Logs-এর নতুন সময়সীমা নোট করো। `pg_stat_statements` counts reset না করা পর্যন্ত এগুলো cumulative থাকবে; আগের limit-counter retroactively কমবে না।

## Local test status

- `npm test`: 3/3 existing tests passed.
- Archive/source integrity and JavaScript/JSX import references were previously checked in the audit workflow.
- `npm run build` was not verified in this environment because `npm ci --no-audit --no-fund` hit a container transport timeout and Vite is not installed here. Locally run `npm ci`, then `npm test` and `npm run build` before deployment.
- Live Supabase execution cannot be simulated from this ZIP alone. SQL must be run against the target project, and RLS/function permissions need to be verified there.

## Security / honest limitations

- Do not share `.env.local`, `service_role` key, DB password, auth tokens or real member financial data.
- Registration / hostel-creation codes are expiring and one-time displayed. Generating a new code revokes the previous code for the same purpose. This implementation does not run a scheduled job that automatically shows a brand-new plaintext code to the admin; that would require a separate secure delivery/rotation design.
- Hostel “delete” is a soft-delete to preserve old accounting/meal history; users are shown limited profile data only, not meal/financial ledgers.
- A code migration passing is not proof of “100% hack-proof”; check Supabase Security Advisor, policies and live behavior after migration.
