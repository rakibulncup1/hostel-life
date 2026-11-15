# Hostel Life — Run49 UI + Meal Count Mode Patch

এই ZIP হলো তোমার আপলোড করা `Hostel Life(1).zip`-এর জন্য **replacement patch**; এটি সম্পূর্ণ project archive নয়। ZIP extract করলে `src/`, `supabase/` ও `tests/`-এর পথ project root-এর সঙ্গে সরাসরি মিলে যাবে।

## কী পরিবর্তন আছে

- Login, registration, phone/email helper text, security badge ও password-reset desktop layout পরিমার্জন।
- Password-reset route guard ঠিক করা, যাতে reset link active-member auto-redirect-এ আটকে না যায় এবং reset flow-তে থাকতে পারে।
- Onboarding-এর welcome/name ও অপ্রয়োজনীয় callout কমানো; join/create form, account-switch placement এবং create-success screen সরল করা।
- Menu, report, archive, help/how-to, Telegram, privacy/terms ও manager pages-এর নির্দিষ্ট header/eyebrow, spacing, color ও mobile layout পরিমার্জন। Landing page পরিবর্তন করা হয়নি।
- Dining back button-এর আকার অপরিবর্তিত রেখে style polish। Market History card-এ শুধু nested total-amount box সরানো; market list/detail flow অপরিবর্তিত।
- Match Settings-এ Breakfast, Lunch, Dinner-এর Half/Full display mode। Default: Breakfast Half; Lunch Full; Dinner Full।

## Meal count mode কীভাবে কাজ করে

এই setting শুধু Dashboard-এর meal-wise people display-কে রূপান্তর করে। Half mode-এ ৫টি stored breakfast meal unit স্ক্রিনে ১০ জন হিসেবে দেখাবে। উদাহরণ: breakfast ১০ জন (half = ৫ meal unit), lunch ১০ এবং dinner ১০ হলে weighted daily total আগের মতো ২৫ meal unit থাকবে।

Raw meal records, meal transactions, market/accounting data, finalized month totals, reports বা deposit হিসাব পরিবর্তন করা হয় না। Setting বদলালে manager-এর explicit Save action-এ একবার RPC চলে; কোনো polling বা background recurring request যোগ করা হয়নি।

Migration-এ `hostels.meal_count_modes` নামে একটি JSONB setting column যোগ হয়। বিদ্যমান `get_my_membership()` function-এ একই পুরোনো logic রেখে শুধু setting field যোগ করা হয়েছে; তার আগের execute permissions অপরিবর্তিত রাখা হয়েছে। নতুন save RPC authenticated manager ছাড়া চালানো যায় না।

## Install করার নিয়ম

1. বর্তমান production project এবং database-এর backup নাও।
2. Project root directory-তে এই ZIP extract করে matching paths overwrite করো। ZIP-এর ভেতরের `src/`, `supabase/`, `tests/` সরাসরি project root-এ merge হবে; আলাদা wrapper folder তৈরি করার দরকার নেই।
3. Supabase SQL Editor-এ `supabase/migrations/Run49_hostel_meal_count_modes.sql` **একবার** চালাও। একই migration দ্বিতীয়বার manually চালিও না।
4. এরপর `supabase/verify/Verify_Run49_hostel_meal_count_modes.sql` চালিয়ে সব readiness/check result প্রত্যাশামতো আছে কি না দেখো।
5. Project-এর lockfile অনুসারে dependencies install করে স্থানীয়ভাবে test/build চালাও; তারপর প্রচলিত deployment process অনুসরণ করো।

Migration চালানোর আগে backup এবং production maintenance discipline অনুসরণ করো। Live database-এ এই migration চালানো হয়নি; verification SQL তোমার Supabase project-এ চালিয়ে ফল নিশ্চিত করতে হবে।

## যেগুলো ইচ্ছাকৃতভাবে বাদ/অক্ষত

- Landing page পরিবর্তন করা হয়নি।
- Run48 Notification migration/verification বা Telegram Edge Function এই patch-এ নেই। তোমার নতুন project ZIP-এ থাকা customized Telegram function অক্ষত রাখতে হবে; আগের v16 ZIP থেকে Edge Function overwrite করার প্রয়োজন নেই।
- Existing feature flows বা database meal rows-এ কোনো নতুন data rewrite যোগ করা হয়নি।

## QA ফলাফল ও সীমাবদ্ধতা

- Test suite: ৮২০টির মধ্যে ৮১০টি passed; ১০টি failed। একই ১০টি failure আপলোড করা baseline ZIP-এও ছিল; এই patch-এর কারণে নতুন failure পাওয়া যায়নি।
- Focused Run49/auth/onboarding regression tests passed।
- Changed JS/JSX source TypeScript parser দিয়ে এবং নতুন CSS PostCSS parser দিয়ে parse করা হয়েছে।
- Vite production build সম্পন্ন করা যায়নি: dependency install network timeout-এ থেমেছে এবং offline cache-এ `yallist` package অনুপস্থিত ছিল; তাই `vite` executable পাওয়া যায়নি। Build passed বলে দাবি করা হচ্ছে না।
- Live Supabase migration/deployment করা হয়নি।
