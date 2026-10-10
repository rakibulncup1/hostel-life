# Hostel Life — Frontend Recovery V1

## এই ZIP কী বদলেছে

এই প্যাকেজ `Hostel Life(2).zip`-এর উপর ভিত্তি করে তৈরি। পরিবর্তনগুলো নিচের নির্দিষ্ট ফাইলগুলোর মধ্যে সীমিত:

- `src/features/dining/DiningPage.jsx`: লেট রিকোয়েস্টের সতর্কবার্তা, অনুমোদিত লেট রিকোয়েস্টের history-তে সম্পাদনা/সংশোধন বন্ধ করে locked notice, final meal correction-এর icon ব্যবহার।
- `src/features/dashboard/DashboardPage.jsx`: অনুমোদিত late overrides-কে আগের meal snapshot-এর সঙ্গে তুলনা করে Breakfast/Lunch/Dinner-এর net `+ / −` সমন্বয়, member-wise details modal, last-sync এবং offline snapshot-এ থাকা late data ব্যবহার।
- `src/features/history/HistoryPage.jsx`: non-primary-member/assistant accounts-এর জন্য সবার হিসাব বনাম শুধু নিজের হিসাব filter; manager-এর হিসাব entry row ক্লিক করে আগে বিস্তারিত দেখা এবং অনুমোদিত হলে detail modal থেকে edit; desktop action alignment.
- `src/features/menu/MenuPages.jsx`: সাধারণ সদস্যের Khala Money read-only view-এর summary copy উন্নত।
- `src/components/Icon.jsx`: আগে ব্যবহৃত কিন্তু সংজ্ঞায়িত না থাকা `check-circle` icon যোগ।
- `src/styles/ui-refresh.css`: ইতিহাস, late-request card/detail, arrears red state, member account rows ও Khala view-এর targeted styling.

## Supabase-এ চালানোর SQL

### 1. Account history scope (এই feature-এর জন্য প্রয়োজন)

`supabase/HOSTEL_LIFE_ACCOUNT_HISTORY_SCOPE_V1.sql`

এটি `public.get_account_history_v2(uuid, uuid, integer)`-এর একই signature ও return type রেখে শুধু একই hostel-এর সদস্যদের history `p_member_id = NULL` হলে দেখার অনুমতি দেয়। নির্দিষ্ট member filter দিলে non-manager এখনও শুধু নিজের membership নির্বাচন করতে পারে। এটি user-confirmed product rule-এর ভিত্তিতে তৈরি। Function replacement এবং grants/schema cache refresh হবে, কিন্তু business table-এর row insert/update/delete হবে না।

চালানোর আগে Supabase backup নেও। SQL Editor-এ এই এক ফাইলের সম্পূর্ণ code একবার চালাও। **এই SQL চালানো না হলে “সবার হিসাব” filter live database-এর বর্তমান function-এর permission check-এ ব্যর্থ হতে পারে।**

### 2. Market সমস্যা এখনও থাকলে read-only diagnostic

`supabase/READ_ONLY_MARKET_DIAGNOSTIC_V2.sql`

এই ফাইলে শুধু SELECT-based catalog/data diagnostics রয়েছে। এটি market entry/edit repair করে না এবং database-এ কিছু পরিবর্তন করে না। Snapshot-এ `create_market_entry`, `manager_update_market_entry`, market history RPC-গুলো ও authenticated execute grants পাওয়া গেছে; কিন্তু real browser error ছাড়া write function পাল্টে দেওয়া ঝুঁকিপূর্ণ। আপডেটেড ZIP দিয়ে market add/edit একবার পরীক্ষা করার পরও ব্যর্থ হলে এই diagnostic চালিয়ে CSV পাঠাবে এবং browser Console/Network-এর error-টিও পাঠাবে।

## গুরুত্বপূর্ণ: যে SQL চালানো যাবে না

`supabase/HOSTEL_LIFE_FEATURE_RECOVERY_V1.sql`-কে এই প্যাকেজের অংশ হিসেবে পুনরায় চালাবে না। লাইভ snapshot-এ বিদ্যমান `private.notify_period_managers(...)` function `integer` ফেরত দেয়, কিন্তু ওই পুরোনো script `void` ফেরত দেওয়ার চেষ্টা করে; এতে `42P13` হতে পারে। এই প্যাকেজ সেই function drop বা replace করে না।

## ইনস্টল করার আগে

1. তোমার বর্তমান local project folder-এর আরেকটি backup ZIP বানাও।
2. এই ZIP extract করে project-এর বর্তমান folder-এর সঙ্গে replace/merge করো; `.env.local` বা অন্য credential file এই archive থেকে পুনরায় তৈরি করার চেষ্টা করবে না।
3. Supabase account-history SQL উপরের নির্দেশ অনুযায়ী চালাও।
4. নিচের `HOSTEL-LIFE-FRONTEND-RECOVERY-V1-TEST-CHECKLIST-BN.md` অনুসরণ করে feature test করো।

## পরীক্ষার সীমাবদ্ধতা

- ৪৯টি `.js/.jsx` source file TypeScript transpiler parser দিয়ে syntax-level parse করা হয়েছে; parser diagnostics পাওয়া যায়নি।
- `npm ci --offline` dependency cache না থাকায় ব্যর্থ হয়েছে; এই কারণে Vite production build চালানো/সফল বলা যাচ্ছে না।
- কোনো live Supabase write, browser session বা end-to-end UI test এই environment থেকে চালানো হয়নি।
- Market add/edit-এর root cause এই প্যাকেজে নিশ্চিতভাবে fixed বলে দাবি করা হচ্ছে না; তার জন্য বাস্তব runtime error দরকার।
