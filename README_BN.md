# Hostel Life — Run117 Patch

এই প্যাচটি `Hostel Life(2).zip`-এর ওপর প্রয়োগ করা Run116 পরিবর্তনের পরবর্তী incremental update। অন্য কোনো বেসলাইন বা পুরোনো প্যাচের ওপর এটি প্রয়োগ করবেন না।

## এই প্যাচে যা আছে

1. Final Meal Correction-এর ব্যক্তি-ভিত্তিক মাসিক ভিউ এখন `daily_meal_records`-এর আসল planned/actual/final মান একটি manager-authorized read-only RPC থেকে পড়ে। আগের per-date audit log-ই ব্যবহার হয়।
2. Manual Meal Request-এর “সক্রিয় সবাই” মোডে আগে থেকে সক্রিয় duplicate request থাকা সদস্য ও overlap date আগে দেখানো হয়। তাদের বাদ দিয়ে বাকি সদস্যদের অনুরোধ পাঠানো হয়। Submit-এর আগের সময়ের মধ্যে নতুন duplicate তৈরি হলে backend শুধু সেই সদস্যকে skip করে; অন্য ধরনের integrity error হলে পুরো transaction rollback হয়।
3. Bangladesh time রাত ১০:০০ থেকে নির্বাচিত range-এ আগামীকাল থাকলে Submit button disabled হয়। UI এক সেকেন্ড অন্তর সময় refresh করে এবং click-handler-ও submit-এর মুহূর্তে সময় পুনরায় যাচাই করে।

## প্রয়োগের ক্রম — গুরুত্বপূর্ণ

1. বর্তমান Run116-সমন্বিত প্রজেক্টের source এবং Supabase database backup নিন।
2. Supabase SQL Editor-এ `supabase/migrations/Run96_member_final_meal_and_manual_request_conflicts.sql` ফাইলটি **একবার** চালান। এটি `BEGIN/COMMIT`-এর মধ্যে আছে; preflight ব্যর্থ হলে transaction commit হবে না। ব্যর্থ হলে থামুন—Frontend patch deploy করবেন না।
3. SQL সফল হলে এই ZIP-এর ফাইলগুলো একই relative path-এ বর্তমান Run116 Project Root-এ copy/replace করুন। পুরো project replace করবেন না।
4. Local project-এ চালান:

   ```powershell
   npm ci
   node --test tests/run116_requested_features.test.mjs tests/run117_member_final_meal_and_manual_request_safety.test.mjs tests/mealRequestPolicy.test.js tests/managerFinalMealUi.test.js
   npm run verify:styles
   npm test
   npm run build
   ```

5. Local-এ Final Meal Correction-এর ব্যক্তি-ভিত্তিক ভিউতে এমন একজন সদস্য পরীক্ষা করুন যার finalized এবং চলমান দিনের meal record আছে। প্রতিদিনের Breakfast/Lunch/Dinner এবং Audit Log মিলিয়ে দেখুন।
6. Manual Meal Request-এর “সক্রিয় সবাই” মোডে এমন date range পরীক্ষা করুন যেখানে ১–২ জনের active request আগেই আছে। UI-তে তাদের নাম ও overlapping dates দেখা, তাদের বাদ যাওয়া, এবং বাকি সদস্যদের request হওয়া যাচাই করুন। একই সময়ে অন্য request তৈরি হলে backend duplicate member-কে skip করছে কি না নিয়ন্ত্রিতভাবে পরীক্ষা করুন।
7. বাংলাদেশ সময় ২১:৫৯, ২২:০০ এবং ২২:০১-এর কাছাকাছি পরের দিনের তারিখসহ range পরীক্ষা করুন। ২২:০০ থেকে button disabled হওয়া এবং click handler-এও block হওয়া যাচাই করুন।
8. সব Local পরীক্ষা সফল না হলে Production-এ deploy করবেন না।

## Database পরিবর্তনের পরিধি

এই Migration নতুন table/column/index/trigger তৈরি বা পরিবর্তন করে না। কোনো RLS Policy, meal amount, finalized record, request history বা existing audit row পরিবর্তন করে না। এটি কেবল তিনটি narrowly scoped RPC তৈরি/replace করে:

- `manager_get_member_final_meal_month(uuid, uuid)` — read-only member/month reader
- `manager_preview_member_meal_request_conflicts(uuid[], uuid, date, date, jsonb)` — read-only duplicate preflight
- `manager_create_member_meal_requests(uuid[], date, date, jsonb)` — Run95 manager bulk writer-এর conflict-aware replacement

নতুন RPC-গুলো `SECURITY DEFINER`, explicit empty `search_path`, manager authorization guard, এবং `PUBLIC`/`anon` execute revoke ব্যবহার করে। Bulk writer বিদ্যমান `private.create_meal_request_internal`-ই পুনরায় ব্যবহার করে।

## পরিচিত সীমাবদ্ধতা

- এই প্যাচের SQL Supabase Production Database-এ প্রয়োগ করা হয়নি; Migration সফল হয়েছে বলে ধরে নেবেন না।
- এই build environment-এ `node_modules` ছিল না, তাই পূর্ণ Vite build/real browser E2E চালানো যায়নি।
- Run116 base archive-এ আগে থেকেই ২১টি test failure ছিল। Run117-এর পরে full suite-এ একই ২১টি failure ছিল; নতুন failure যোগ হয়নি।
