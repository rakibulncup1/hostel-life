HOSTEL LIFE — RUN65 PATCH (বাংলা)
==================================

উদ্দেশ্য
-------
এই Overlay Patch-টি Run64-এর উপর ভিত্তি করে তৈরি। Run49-এর Meal Mode এবং Run63-এর UI/Privacy পরিবর্তন অক্ষুণ্ন রেখে Login/Registration-এর পরবর্তী entry window-গুলো—Onboarding, Mess Join/Create, invitation link entry এবং Password Reset—বিশেষ করে Desktop layout-এ পরিমার্জন করা হয়েছে। Registration email label-ও ব্যবহারকারীর নির্দেশ অনুযায়ী পরিবর্তন করা হয়েছে।

এই Patch-এ যা পরিবর্তন
---------------------
1. Registration: ইমেইল ইনপুটের নিচের নির্দেশনাটি সরিয়ে label-এর পাশে “(সঠিক ইমেইল ব্যবহার করুন)” দেখানো হয়েছে।
2. Onboarding: invitation flow-এ একই approval/pending তথ্যের পুনরাবৃত্তি কমানো হয়েছে; pending request-এর refresh/status action এবং approval flow অক্ষত।
3. Join Mess: কোডের উপরের অতিরিক্ত নির্দেশনা ও duplicate wording কমানো হয়েছে; existing 12-character validation, RPC এবং server-side security checks অপরিবর্তিত।
4. Create Mess: form heading/label-এর পুনরুক্তি সরল করা হয়েছে; create এবং initial-month flow অপরিবর্তিত।
5. Desktop + Mobile: Onboarding, join/create form, invitation-entry এবং password-reset screens-এর responsive spacing, width, typography ও card layout উন্নত করা হয়েছে।
6. Run49 Meal Mode, Run63 legal/privacy content এবং বিদ্যমান CSS imports অক্ষুণ্ন রাখা হয়েছে।

যে ফাইলগুলো অন্তর্ভুক্ত
--------------------
 - src/features/auth/AuthPage.jsx
 - src/features/onboarding/OnboardingPage.jsx
 - src/main.jsx
 - src/styles/run65-entry-windows.css
 - tests/v16_auth_market_notice.test.js
 - tests/v19_auth_onboarding_theme.test.js
 - tests/publicEntryVisualExperience.test.js
 - tests/internalExperiencePolish.test.js
 - tests/run63-focused-followup.test.mjs
 - tests/run65EntryWindows.test.mjs
 - supabase/migrations/Run49_hostel_meal_count_modes.sql
 - supabase/verify/Verify_Run49_hostel_meal_count_modes.sql


ইনস্টল
------
1. বর্তমান কার্যকর Project-এর সম্পূর্ণ Backup নিন।
2. ZIP Extract করে Project Root-এ একই folder structure বজায় রেখে ফাইলগুলো Replace/Merge করুন।
3. এরপর আপনার প্রজেক্টের স্বাভাবিক dependency install থাকলে `npm test` এবং `npm run build` চালান।
4. এই Patch-এর জন্য নতুন SQL Migration চালানোর দরকার নেই।

গুরুত্বপূর্ণ — Run49 SQL ফাইল
----------------------------
`Run49_hostel_meal_count_modes.sql` এবং `Verify_Run49_hostel_meal_count_modes.sql` এখানে Run49 migration history ও test-suite compatibility অক্ষুণ্ন রাখার জন্য অন্তর্ভুক্ত। এগুলো নতুন migration নয়। Run49 আগে apply করা হয়ে থাকলে Migration আবার চালাবেন না। Verification SQL-ও শুধুমাত্র প্রয়োজন হলে/আপনার migration state যাচাইয়ের জন্য ব্যবহার করবেন।

সুরক্ষা ও Scope
---------------
- কোনো নতুন database schema বা RPC পরিবর্তন করা হয়নি।
- কোনো Edge Function, Telegram Notification বা authentication business logic পরিবর্তন করা হয়নি।
- Join request, invite approval, mess creation, initial-month creation এবং password-reset backend flow অপরিবর্তিত রাখা হয়েছে।
- পরিবর্তন সীমাবদ্ধ entry-window UI, copy/duplicate wording এবং সংশ্লিষ্ট regression tests-এ।

পরীক্ষার ফল
-----------
- Full test suite: 837 tests; 827 passed; 10 failed.
- এই 10টি failure মূল `Hostel Life(1).zip` baseline-এও একই test name-সহ ব্যর্থ ছিল; Run65 নতুন test failure যোগ করেনি।
- Run49 + Run63 + Run65 সংশ্লিষ্ট focused regression tests: 140/140 passed.
- JS/JSX/MJS parsing: 93 source files, 0 parse errors.
- CSS parsing: 36 files, 0 parse errors.
- এই কাজের পরিবেশে Vite dependency অনুপস্থিত থাকায় `npm run build` চালানো যায়নি; তাই production build সফল হয়েছে বলে দাবি করা হচ্ছে না।

Run নম্বরের ধারাবাহিকতা
-----------------------
Run নম্বরগুলো development revision, delivered ZIP-এর সংখ্যা নয়। বর্তমান source tree-তে Run50, Run52, Run53, Run54 এবং Run61-এর file/test artifacts আছে। Run49-এ Meal Mode, Run63-এ public/in-app UI ও legal content refinement, Run64-এ Run49+Run63 compatibility recovery হয়েছে। এই Patch সেই ধারাবাহিকতার পরবর্তী scoped refinement — Run65।

Patch type: Overlay only (সম্পূর্ণ Project ZIP নয়)।
