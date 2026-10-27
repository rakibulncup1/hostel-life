# Hostel Life — Post SQL finishing (সমন্বিত ZIP)

বেস: `Hostel_Life_Post_SQL_Finishing_Batch.zip` — পূর্ববর্তী সব সংশোধন অক্ষত রেখে কাজ করা হয়েছে।

## নতুন
- Super Admin সদস্য তালিকায় পরিচয় ম্যানুয়ালি যাচাই করে Temporary Password তৈরির UI। পাসওয়ার্ড শুধু একবার দেখায়, frontend localStorage-এ রাখে না।
- অস্থায়ী পাসওয়ার্ড ব্যবহারকারীকে দেওয়ার পর প্রথম লগইনে বাধ্যতামূলক নতুন পাসওয়ার্ড ফর্ম; Backend `app_metadata.must_change_password` ভিত্তিতে অ্যাপের বাকি অংশ আটকে দেয়।
- দুইটি Edge Function অন্তর্ভুক্ত: `admin-temporary-password` ও `complete-temporary-password`; service-role secret শুধু সার্ভারে থাকবে।
- Super Admin মোবাইল recovery panel layout উন্নত।

## Deployment prerequisites
Supabase-এর Project-এ দুইটি Edge Function আলাদাভাবে Deploy করতে হবে; এগুলো SQL Editor-এ চালানো যাবে না। JWT verification enabled রাখুন। `SUPABASE_SERVICE_ROLE_KEY` কখনো `VITE_` environment variable বা GitHub-এ দেবেন না।

## Safety & limitations
- এই ZIP frontend deploy করলে সাধারণ Dashboard/Manager/History আগের মতো চলার কথা; নতুন Password Recovery UI কেবল Edge Function Deploy হলে কাজ করবে।
- Live Database-এ কোনো কোড চালানো হয়নি। Static tests পাস করলেও production build ও browser integration পরীক্ষা করা যায়নি।
- Archive Deletion স্থায়ী: Backup ছাড়া এটির ব্যবহার পরীক্ষা করবেন না।
- Frontend-এ নতুন SQL প্রয়োজন নেই; নতুন Feature-এর জন্য আলাদা Supabase Edge Function deploy অপরিহার্য।
- পরিচয় যাচাই ম্যানুয়াল এবং Super Admin-এর নিজস্ব অ্যাকাউন্ট password reauthentication আগেই আছে।


## Final reliability pass (২৭ অক্টোবর ২০২৬)

- আর্কাইভের month list/detail view, report summary, category filters এবং mobile layout উন্নত করা হয়েছে। ভুলবশত একই বাংলাদেশি ক্যালেন্ডার মাসে বন্ধ হওয়া সর্বশেষ period-কে কোনো running period/পরবর্তী period না থাকলে ফিরিয়ে আনার gated action রাখা হয়েছে।
- চলমান period-এর end date-কে open-ended sentinel হিসেবে ব্যবহার করে UI-তে শেষ তারিখ না দেখানোর নিয়ম রাখা হয়েছে; বন্ধ করার সময় প্রকৃত বাংলাদেশি তারিখ সংরক্ষিত হয়। `Part 2` লেবেল ট্রিগার বজায় আছে।
- ম্যানেজারের meal-request পেজে running period না থাকলে পুরোনো period-এর request list আর দেখানো/পরিচালনা করা হয় না।
- সদস্যের normal request server-side-এ রাত ১০টার পরে বন্ধ; late request রাত ১০টার পরে শুধু পরের দিনের জন্য, running period ও duplicate checks-সহ।
- History থেকে approved normal request-এর পরিবর্তনযোগ্য future day-এ direct edit এবং cutoff/finalized day-এ correction request করা যায়। Direct edit actual daily records-ও আপডেট করে; পুরোনো/finalized দিন বাদ দেওয়া হলে history-preservation rules বজায় থাকে।
- Correction approval RPC-কে এমনভাবে ঠিক করা হয়েছে যাতে finalized day-এর correction manager approve করতে পারেন, কিন্তু শুধু approved parent normal request, running period, matching dates এবং finalized (cancelled নয়) day হলে। Final rows-এর পরিবর্তন `private.apply_request_days`-এর audit flow দিয়ে হয়। Manager request-list RPC-ও running period না থাকলে `[]` ফেরত দেয়, যাতে পুরোনো অনুরোধ সার্ভার থেকে আর প্রকাশ না হয়।
- খালার টাকা history-তে entry creator; notification delete hard-delete; Super Admin hostel purge; expired archive/summary retention queue; assistant-manager selection UI; avatar first-file-picker reset এবং supported-format hint অন্তর্ভুক্ত।
- Retention panel-এর saved-summary RPC JSONB array সরাসরি দেখানোর সংশোধন করা হয়েছে, যেন শুধু প্রথম row রেখে বাকিগুলো হারিয়ে না যায়।
- ভুলবশত বন্ধ মাস পুনরায় চালু করলে দিনগুলোর রাত ৯টার Dhaka cutoff/finalization timestamps পুনর্গঠন হয়; ইতোমধ্যে cancelled day পুনরায় চালু হয় না। Request-history-তে day metadata লোড ব্যর্থ হলে এডিট/সংশোধন লুকিয়ে রাখার কারণ ব্যবহারকারীকে দেখানো হয়।

## SQL deployment sequence

1. Supabase-এর আগে backup নিন এবং Project → SQL Editor-এ `supabase/migrations/20261027_open_ended_running_period.sql` চালান **শুধু যদি open-ended period migration আগে সফলভাবে শেষ না হয়ে থাকে**। যদি ব্যর্থ হয়ে থাকে, error-এর কারণ না বুঝে পুরোনো master SQL আবার চালাবেন না।
2. তারপর `supabase/migrations/20261027_finishing_reliability.sql` একবার চালান। এটি workflow RPC, hard-delete/retention/hostel deletion functions ও archive reopen logic একসঙ্গে আপডেট করে। দুই migration-এর `BEGIN/COMMIT` transaction block অক্ষত রাখুন; আলাদা অংশ কেটে চালাবেন না।
3. Supabase → API/Database schema refresh শেষে অ্যাপ hard refresh/পুনরায় deploy করুন। প্রথমে test hostel/test account-এ normal cutoff, late request, correction request, manager approval, archive reopen, notification permanent delete এবং expired retention queue যাচাই করুন।

## Verification limits

- Automated test suite: **৬৫/৬৫ টেস্ট পাস** (Node test runner)।
- ৮০টি JavaScript/JSX/TypeScript/TSX ফাইলে parser syntax scan: **কোনো syntax error নেই**। এই পরিবেশে `vite`/`node_modules` অনুপস্থিত থাকায় production build এবং live Supabase integration সম্পন্ন করা যায়নি। তাই migration backup নিয়ে বাস্তব test database-এ যাচাই করেই production-এ ব্যবহার করুন।


- বিস্তারিত যাচাই সীমা ও migration চালানোর নিরাপদ ক্রম: `FINISHING_VERIFICATION_BN.md`।
