# Hostel Life — Frontend FIX-02

Version: 0.7.1  
Scope: Core Meal Workflow Hardening  
Baseline: `Hostel-Life-Frontend-Fix-01.1.zip`

## উদ্দেশ্য

FIX-02-এর লক্ষ্য নতুন database feature যোগ করা নয়। বর্তমান meal workflow-কে server-এর daily meal state, cutoff এবং finalization state-এর সঙ্গে আরও নির্ভরযোগ্যভাবে মিলিয়ে দেওয়া।

## এই package-এ যা পরিবর্তন করা হয়েছে

1. Member meal request editor এখন `daily_meal_days` থেকে server-side day state/cutoff পড়ে UI validation করে।
2. নতুন request-এর date input চলমান মাস ও future-date rule অনুযায়ী সীমাবদ্ধ করা হয়েছে।
3. Edit/correction flow এখন শুধু server rule অনুযায়ী উপযুক্ত দিনকে valid ধরে। Finalized day correction হিসেবে দেখানো হয় না।
4. Correction range-এ মাঝখানে অনুপযোগী দিন থাকলে client-side guard দেখাবে, যাতে অসম্পূর্ণ payload পাঠানো না হয়।
5. Hardcoded cutoff wording সরিয়ে server-defined cutoff wording ব্যবহার করা হয়েছে।
6. Manager Meal Entry এখন `final_*` value থাকলে সেটিকে অগ্রাধিকার দিয়ে prefill করে।
7. Manager conflict confirmation-এ সত্যিকারের `force: true` payload পাঠানো হয়।
8. Missing-day state-এ manager save button disable থাকে এবং পরিষ্কার warning দেখায়।
9. Small-screen manager request tabs wrap করে; layout overflow কমানো হয়েছে।
10. `checkManagerMealEntryConflicts`-এর import source corrected to `managerService`।

## গুরুত্বপূর্ণ

- এই FIX-02 package কোনো নতুন Supabase migration চালায় না।
- `Master SQL`, `REPAIR V2.0.2`, বা Dashboard Repair SQL আবার চালাবেন না।
- Existing `supabase/MODULE-06-DATABASE-PATCH.sql` baseline-এর অংশ হিসেবে রাখা আছে; FIX-02-এর জন্য এটি চালাতে হবে না।

## Install

1. বর্তমান working project-এর backup/commit রাখুন।
2. এই ZIP extract করে existing project-এর সঙ্গে merge/replace করুন।
3. Package-এর source files existing project-এ replace করুন।
4. তারপর আপনার normal environment-এ:

```bash
npm install
npm run build
```

## Live smoke test

Build successful হওয়ার পর নিচের workflow পরীক্ষা করুন:

- Member → নতুন মিল রিকোয়েস্ট → future date → save
- Member → request history → approved request → eligible future day edit
- Member → request history → past/cutoff-passed day → correction request
- Correction range-এ unavailable day থাকলে client guard
- Manager → Meal Entry → existing record load → edit → conflict confirmation
- Finalized day → manager entry attempt → server permission/error feedback
- Online/offline header এবং page restrictions আগের behavior অনুযায়ী আছে কিনা

## Rollback

কোনো unexpected behavior হলে নতুন source overwrite না করে backup/current git commit-এ ফিরে যান। Database rollback দরকার নেই, কারণ FIX-02 নিজে কোনো database mutation করে না।
