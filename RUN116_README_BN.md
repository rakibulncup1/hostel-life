# Hostel Life — Run116 Selected Features Patch

## বেসলাইন

- মূল প্রজেক্ট: `Hostel Life(2).zip`
- বেসলাইন Git commit: `d5dd8cc`
- এটি সম্পূর্ণ প্রজেক্ট নয়; শুধু এই অনুরোধের জন্য প্রয়োজনীয় পরিবর্তিত/নতুন ফাইল রয়েছে।

## কী পরিবর্তন হয়েছে

1. **Final Meal Correction — ব্যক্তি অনুযায়ী ভিউ**
   - ডিফল্ট ভিউ আগের মতো তারিখ অনুযায়ী। নতুন সুইচারে ব্যক্তি অনুযায়ী ভিউ যুক্ত হয়েছে।
   - নির্বাচিত সক্রিয় সদস্যের চলমান Period-এর প্রতিটি তারিখ দেখায়।
   - কেবল সার্ভারে `finalized`, আজ বা অতীতের, বাতিল নয়—এমন দিন সম্পাদনাযোগ্য।
   - সংরক্ষণের জন্য আগের `manager_set_meal_entries` RPC-ই ব্যবহৃত; ফলে আগের Permission, validation ও `archive_period_audit` একই থাকে।
   - প্রতিদিনের লগ আগের `hl_get_final_meal_audit` RPC থেকে নেওয়া হয় এবং নির্বাচিত সদস্যের ইভেন্টগুলোই দেখানো হয়।
   - সদস্য বদলালে দেরিতে-ফেরা পুরোনো Audit Response নতুন সদস্যের স্ক্রিনে বসতে পারে না।

2. **Manual Meal Request — সক্রিয় সবাই**
   - একক ব্যক্তি / সক্রিয় সবাই Target Switcher যুক্ত হয়েছে; ডিফল্ট একক ব্যক্তি।
   - স্বাভাবিক অনুরোধের বিদ্যমান বারভিত্তিক ব্যতিক্রম (weekday exception) নিয়ম একইভাবে প্রয়োগ হয়।
   - সবার জন্য নতুন Manager-authorized RPC যোগ হয়েছে: `manager_create_member_meal_requests`।
   - RPC আগের `private.create_meal_request_internal` ব্যবহার করে; একই date/meal validation, normal auto-approval, existing audit log ও notification pathway বজায় থাকে।
   - ব্যাচ সর্বোচ্চ ২০০ সক্রিয় সদস্য। একজনেরও সক্রিয় Duplicate Request থাকলে পুরো ব্যাচ Rollback হবে; আংশিকভাবে কারও অনুরোধ তৈরি হবে না এবং পুরোনো অনুরোধ পরিবর্তিত হবে না।
   - এই ফিচারের জন্য একটি additive SQL migration প্রয়োজন: `supabase/migrations/Run95_manager_bulk_manual_meal_requests.sql`।

3. **About mobile header** — ভাষা/প্রবেশ/রেজিস্ট্রেশন/অ্যাপ অ্যাকশনের জন্য ছোট স্ক্রিনে responsive grid; শুধু About page-এ প্রযোজ্য।
4. **Social share preview** — সাদা/হালকা ব্র্যান্ডেড 1200×630 PNG; `index.html` ও `about.html`-এর OG/Twitter image URL cache-busting `v=116` করা হয়েছে।
5. **Google consent/sign-in** — প্রয়োজনীয় সম্মতি না দিলে Google SDK বা OAuth preparation শুরু হয় না। সম্মতির পরে SDK load ও nonce preparation parallel চলে; Google G মার্কের পেছনে সাদা ব্যাকগ্রাউন্ড রাখা হয়েছে।
6. **Desktop content width** — বড় Desktop breakpoint-এ শুধু `.app-main`-এর canvas প্রশস্ত; Auth screen-এ পরিবর্তন নেই। About page-এর wrap-ও বড় Desktop-এ প্রশস্ত।
7. **PDF reports** — বিদ্যমান Header/Footer ও রিপোর্টের বিন্যাস অপরিবর্তিত। Header-এর লোগো ও Hostel Life wordmark সামান্য ডানদিকে সরানো হয়েছে। প্রতিটি printed page-এ প্রকৃত Logo Image থেকে তৈরি খুব হালকা (3.5% alpha) কেন্দ্রীয় watermark যোগ হয়েছে; CSS background নয়, image element হওয়ায় Background Graphics বন্ধ থাকলেও মুদ্রণের উপযোগী।

## Production-এ প্রয়োগের ক্রম

1. বর্তমান Production database ও project backup নিন।
2. Supabase SQL Editor-এ `Run95_manager_bulk_manual_meal_requests.sql` একবার সম্পূর্ণ চালান। এটি শুধু একটি নতুন RPC তৈরি করে; কোনো Table, Column বা বিদ্যমান Request Function পরিবর্তন করে না। Migration-এ শেষে PostgREST schema cache reload notification রয়েছে।
3. SQL migration সফল হওয়ার আগে নতুন Frontend deploy করবেন না। Migration ব্যর্থ হলে থামুন; বিদ্যমান migration-গুলো পুনরায় চালাবেন না।
4. Local project-এ ZIP-এর ফাইলগুলো একই path-এ replace/add করে `npm ci` চালান।
5. পরীক্ষা করুন:
   - `node --test tests/run116_requested_features.test.mjs`
   - `npm test`
   - `npm run verify:styles`
   - `npm run build`
6. Local-এ Final Meal Correction-এর Date ও Person view, past finalized day edit, log filter, Manual single/all request, weekday exceptions, duplicate conflict, About 320–760px, share preview, Google consent, এবং Portrait/Landscape PDF পরীক্ষা করুন।
7. সবকিছু ঠিক থাকলে Vercel-এ deploy করুন। প্রথমে ছোট/নিয়ন্ত্রিত সদস্য-দলে Manual all-request পরীক্ষা করা নিরাপদ।

## পরীক্ষার অবস্থা

- Run116 targeted tests: **9/9 পাস**।
- `verify-stylesheet-integrity --source`: **PASS** (62 source imports, 28 public stylesheets)।
- পরিবর্তিত JS/JSX চারটি ফাইল TypeScript parser/transpile syntax check: **PASS**।
- সম্পূর্ণ test suite: **1,206/1,227 পাস; 21 ব্যর্থ**। Run116 পরিবর্তনের আগে বেসলাইন ZIP-এ **1,197/1,218 পাস; একই 21টি ব্যর্থ** ছিল। ব্যর্থতার পরিচয় অপরিবর্তিত; নতুন failure যোগ হয়নি।
- এই কাজের পরিবেশে `node_modules` অনুপস্থিত ছিল, তাই পূর্ণ Vite Production Build এবং React-সহ Browser end-to-end পরীক্ষা চালানো যায়নি। `npm ci`-এর পরে তোমার Local Environment-এ Build করতে হবে।

## Scope / সতর্কতা

- কোনো পুরোনো SQL Migration, Table, Column, Trigger, RLS Policy, Supabase Edge Function, Authentication Policy বা হিসাবের Business Logic পরিবর্তন করা হয়নি।
- নতুন SQL কেবল উপরে বর্ণিত bulk manual request RPC যোগ করে।
- `npm ci`-এর পরে যদি নতুন Build/Test failure দেখা যায়, Production deploy স্থগিত রেখে সেই error আলাদাভাবে যাচাই করুন।
