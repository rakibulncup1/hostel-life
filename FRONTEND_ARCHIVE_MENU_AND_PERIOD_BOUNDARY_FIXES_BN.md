# Hostel Life — Frontend Archive & Period Boundary Fixes (বাংলা)

## এই ZIP-এ কী বদলেছে

> **নতুন নিয়ম:** এই নথির নির্দিষ্ট শেষ-তারিখ মেরামতের অংশ (৬–৮) পরবর্তী `OPEN_ENDED_PERIOD_AND_ARCHIVE_UI_FIX_BN.md` নথি দ্বারা প্রতিস্থাপিত। চলমান মাসের শেষ তারিখ আর ক্যালেন্ডার মাসের শেষ দিনে সেট করবেন না; বর্তমান মাস বন্ধ করার দিনটিই প্রকৃত শেষ দিন হবে। নতুন migration-এর নির্দেশ অনুসরণ করুন।

1. থ্রি-লাইন মেনুতে এখন একটিই `আর্কাইভ` অপশন। আগের আলাদা `আর্কাইভ সম্পাদনা` মেনু-আইটেম সরানো হয়েছে; পুরোনো URL এলে সেটিও একই Archive পৃষ্ঠার দিকে যাবে।
2. সাধারণ সদস্য Archive থেকে বন্ধ মাসের তালিকা ও রিপোর্ট দেখতে পারবেন; সংশোধনের বাটন নেই।
3. ম্যানেজার Archive-এ আগে সব বন্ধ মাসের তালিকা দেখবেন; একটি মাস খুললে তার রিপোর্ট ও Correction Mode দেখা যাবে। প্রথমে খালি/ড্যাশভরা ফর্ম দেখায় না।
4. Module 2-এর Correction RPC অনুপস্থিত থাকলে Archive রিপোর্ট-only থাকবে এবং পরিষ্কার সতর্কবার্তা দেখাবে। পুরোনো `reopen_archived_period` বা archive permission RPC-কে edit fallback হিসেবে ব্যবহার করে না।
5. Final meal, market, deposit, other expense ও khala money-এর সংশোধন-বাটন কেবল Correction RPC থেকে বাস্তব ডেটা পাওয়া গেলে দেখায়। Market item একাধিক/শূন্য হলে total-only edit বন্ধ থাকে।
6. মিল Request-এর তারিখ এখন running period-এর `start_date` ও `end_date`-এর বাইরে পাঠানো যায় না; start/end date field-এও `max=end_date` রাখা হয়েছে।
7. কোনো split period (যেমন October Part 2) মাসের মাঝখান থেকে শুরু হলেও ভুল করে `end_date` শুধু start day-তে শেষ হয়ে থাকলে, একই মাসের শেষ দিনের মধ্যে অনুরোধের তারিখ পড়লে UI mismatch শনাক্ত করবে। বর্তমান প্রধান ম্যানেজার নিশ্চিত করলে বিদ্যমান `manager_set_running_period_end_date` RPC দিয়ে শুধু চলমান period-এর end date ক্যালেন্ডার মাসের শেষ দিন করা হবে। কোনো closed period, financial row, বা period status পরিবর্তন করার সরাসরি SQL/REST কল নেই।
8. সাধারণ সদস্যকে period boundary নিজে পরিবর্তন করতে দেওয়া হয় না; তাঁকে বর্তমান প্রধান ম্যানেজারকে জানাতে বলা হয়।

## গুরুত্বপূর্ণ Backend নির্ভরতা

- Archive edit চালাতে `hlc_get_archive_correction_bundle(uuid)` এবং `hlc_apply_archive_correction(uuid,text,uuid,jsonb,text)` অবশ্যই Database-এ থাকতে হবে এবং অনুমোদিত current-primary-manager access দিতে হবে। না থাকলে Archive শুধুমাত্র রিপোর্ট দেখাবে।
- Part 2 period boundary সংশোধনের জন্য বিদ্যমান `manager_set_running_period_end_date(date,boolean)` RPC থাকতে হবে। এটি না থাকলে UI error দেখাবে; direct table update করা হবে না।
- এই ZIP কোনো SQL Migration চালায় না এবং Database schema/data পরিবর্তন করে না।

## Validation

- `node --test tests/*.test.js`: 36/36 passed.
- TypeScript parser/transpiler দিয়ে src/tests-এর 72টি JavaScript/JSX ফাইলের syntax scan: কোনো syntax diagnostic পাওয়া যায়নি।
- Production Vite build এই environment-এ চালানো যায়নি, কারণ ZIP-এ `node_modules` রাখা হয়নি এবং environment-এ Vite executable উপলব্ধ ছিল না।
- Live Supabase ও মোবাইল visual test করা হয়নি।

## Deploy Notes

আগের Frontend ZIP-এর বদলে এই সম্পূর্ণ প্রজেক্ট ZIP ব্যবহার করুন। SQL পুনরায় চালানোর দরকার নেই এই Frontend পরিবর্তনের জন্য। যদি Archive-এ “Correction SQL module installed নয়” দেখা যায়, তাহলে correction RPCs Database-এ নেই—সে ক্ষেত্রে পুরোনো SQL জোর করে পুনরায় চালাবেন না; SQL guard/version review আলাদাভাবে করতে হবে।
