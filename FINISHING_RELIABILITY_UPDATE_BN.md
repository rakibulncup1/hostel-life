# Hostel Life — Finishing Reliability Update

এই আপডেটটি আগের `Hostel_Life_Archive_UI_Open_End_Period_Fix_v2` সোর্সের ওপর তৈরি। এটি পূর্ণ Master SQL নয়; বিদ্যমান Pro Master + Module B + Open-ended running-period migration প্রয়োগ করা ডেটাবেসের জন্য একটি সীমিত incremental update।

## এই সংস্করণে

- ভুলবশত বন্ধ হওয়া **চলতি ক্যালেন্ডার মাসের সর্বশেষ period** পুনরায় চালু করার জন্য server-side নিরাপত্তা-শর্ত ও UI permission response মিলানো হয়েছে। অন্য period চলমান থাকলে, পরবর্তী period তৈরি হয়ে গেলে, বা অন্য মাস হলে reopen হবে না। আগে বাতিল হওয়া ভবিষ্যৎ অনুরোধ নিজে থেকে পুনরুজ্জীবিত করা হয় না।
- ম্যানেজারের **মিল অনুরোধ** স্ক্রিন প্রথমে server-backed running period যাচাই করে। মাস না থাকলে অনুরোধের পুরোনো তালিকা পরিষ্কার করে “কোনো চলমান মাস নেই” দেখায়।
- খালার টাকার ইতিহাসে `created_by_name` ফেরত আসে এবং UI-তে “এন্ট্রি করেছেন” লাইন দেখা যায়।
- Super Admin-এর মেস স্থায়ী ডিলিটের আগে Module 02-এর `hl_period_summary_snapshots` ও বিচ্ছিন্ন `hl_archived_final_summaries` পরিষ্কার হয়, যাতে `ON DELETE RESTRICT/NO ACTION`-এর known blocker না থাকে। অ্যাকাউন্ট ডিলিট অপশন চালু থাকলেও অন্য কোনো মেসে ব্যবহৃত একই লগইন অ্যাকাউন্ট রাখা হয়।
- Notification-এর একক/সবগুলো নিজের inbox থেকে মুছলে এখন সার্ভারে বাস্তব `DELETE` হবে। এই migration চালানোর সময় আগের `deleted_at IS NOT NULL` soft-deleted notification row-গুলোও স্থায়ীভাবে মুছে ফেলা হবে। **এটি ইচ্ছাকৃত এবং ফিরিয়ে নেওয়া যায় না**—চালানোর আগে ব্যাকআপ নিন। অন্য সদস্যের active inbox row bulk-delete করা হয় না।
- Retention পেজের তিনটি RPC-র মধ্যে কোনো একটি ব্যর্থ হলেও সফল policy/expired-archive/saved-summary তালিকা আলাদাভাবে দেখানো হয়। মেয়াদোত্তীর্ণ তালিকা server-side retention policy থেকেই আসে; source month মুছতে এখনও explicit save-summary → manual verify → typed confirmation লাগে।
- সহকারী ম্যানেজার নির্বাচনকার্ড, নির্বাচিত কাউন্ট, মোবাইল লেআউট, প্রোফাইল ফটো নির্বাচন ও file MIME fallback উন্নত হয়েছে। প্রোফাইল ফরম্যাটের সাহায্য-লেখা এখন শুধু JPG/PNG/WEBP বলে; compression-এর প্রতিশ্রুতি দেখায় না।

## প্রয়োগ

1. Supabase backup/export নিন।
2. শুধু `Hostel_Life_Finishing_Reliability_Migration.sql`-এর সম্পূর্ণ content Supabase SQL Editor-এ একবার চালান। একই SQL-টি `supabase/migrations/20261027_finishing_reliability.sql`-এও রাখা আছে যাতে source/SQL একসাথে থাকে।
3. `COMMIT` পর্যন্ত সফল হলে Supabase schema cache পুনরায় লোড হওয়ার জন্য কিছুক্ষণ অপেক্ষা করুন/পেজ রিফ্রেশ করুন।
4. Super Admin দিয়ে (ক) ভুলবশত বন্ধ হওয়া চলতি মাসে Reopen, (খ) no-running-month request page, (গ) Khala entry creator, (ঘ) dummy/test hostel permanent delete, (ঙ) test notification hard delete, এবং (চ) retention eligible archive flow পরীক্ষা করুন। আর্থিক/বাস্তব মেসে প্রথম পরীক্ষা করবেন না।

## জানা সীমাবদ্ধতা

এই source-only পরিবেশে live Supabase-এ migration বা actual user-row deletion চালানো হয়নি। `npm run build` চালানোও সম্ভব নয় যদি Vite/node_modules ইনস্টল না থাকে। তাই স্বয়ংক্রিয় test ও syntax scan পাস করলেও production-এ চালানোর পর উপরোক্ত smoke test আবশ্যক।
