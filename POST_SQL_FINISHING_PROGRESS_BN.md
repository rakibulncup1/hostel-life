# Hostel Life — Post SQL Finishing Batch (2026-10-16)

## ভিত্তি
`Hostel_Life_Post_SQL_Frontend_Integration.zip`-এর পূর্ণ সোর্সকোড ভিত্তি হিসেবে ব্যবহার করা হয়েছে। পূর্ববর্তী Module 01 ও Post-SQL সংশোধন অক্ষত রাখা হয়েছে। Production SQL পুনরায় চালাতে হবে না।

## এই ব্যাচে করা হয়েছে
1. ব্যবহার নির্দেশনা: রেজিস্ট্রেশন, মেস-জয়েন রিকোয়েস্ট, ম্যানেজার একসেপ্ট, নতুন মাস, মিল, লেট রিকোয়েস্ট, বাজার/হিসাব, PDF, archive—পূর্ণ ১০ ধাপের বাংলা গাইড।
2. Archive History Edit Permission: বর্তমান প্রধান ম্যানেজার না হলেও সার্ভার থেকে `get_my_archive_editable_periods`-এ বৈধ অনুমতি পাওয়া closing manager/authorized editor-এর edit controls এখন আর অযথা লুকাবে না। প্রকৃত সংশোধনের অনুমতি এখনও সার্ভার নিয়ন্ত্রণ করে।
3. Notification: বাজার, নতুন মাস, ম্যানেজার/সদস্য পরিবর্তন, মিল অনুমোদন/প্রত্যাখ্যান, retention-এর বাংলা ধরনের লেবেল।
4. নোটিফিকেশন “সব দেখা”: একবারে ৫০টি parallel write না পাঠিয়ে ৪টি করে batched; কোনো ব্যাচ ব্যর্থ হলে সফলগুলো seen এবং ব্যর্থগুলো unread থাকবে। Free-plan resource pressure ও ভুল success indicator কমে।
5. Super Admin Archive: final summary প্রস্তুত না থাকলে verify/delete control নিষ্ক্রিয়; missing summary হলে user-friendly error। Database-এর authorization/verification অপরিবর্তিত।
6. Super Admin: RPC অনুপস্থিত থাকলে পুরোনো `Phase 2 SQL` চালানোর বিভ্রান্তিকর বার্তা পরিবর্তন।

## যাচাই
- `npm test` = 29/29 tests পাস।
- `npm ci --offline` নির্ভরতার একটি package cache-এ অনুপস্থিত থাকায় ব্যর্থ (yallist@3.1.1)। তাই build এবং Browser-এ UI Test এখানে করা যায়নি।
- কোনো Supabase SQL, migration, storage bucket, RLS, account বা data পরিবর্তিত হয়নি।

## ইচ্ছাকৃতভাবে অসম্পূর্ণ / বাস্তব যাচাই প্রয়োজন
- Super Admin থেকে Temporary Password reset: privileged Edge Function deployment এবং first-login forced password change workflow লাগবে; SQL চালানো বা browser থেকে privileged token ব্যবহার নিরাপদ নয়।
- Archive Retention/Deletion: Live SQL confirmation, transaction cleanup ও financial summary audit ছাড়া নিশ্চিত করা যায় না। Production ডেটায় পরীক্ষামূলক deletion করবে না।
- CSS/mobile visuals, printer PDF, month closing, manager notifications: device ও live Supabase integration পরীক্ষা প্রয়োজন।
- স্বয়ংক্রিয় ২+৬-মাস compaction বাস্তবে SQL-এ কতটা আছে তা যাচাই বাকি; code-added status কে feature-verified ধরা যাবে না।

## পরীক্ষার প্রস্তাবিত ক্রম
Login → Dashboard → How to Use → Member joins → Manager archive permission → History edit visibility → Notification bulk mark seen → Retention summary display (delete নয়) → PDF print preview → Mobile viewport.

## চালানোর পদ্ধতি
`package.json`-যুক্ত project folder-এ `.env`-এ বিদ্যমান নিজের Supabase config রেখে `npm ci && npm test && npm run build`। প্রথমে আলাদা preview deployment। পুরোনো স্থিতিশীল ZIP backup রাখবে।
