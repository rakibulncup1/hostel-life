# Hostel Life — Run42 UI Refinement Candidate

এই Candidate তৈরি হয়েছে Run41 UI Refresh Candidate-এর ওপর আলাদা Working Copy-তে। মূল `Hostel Life(4).zip` অপরিবর্তিত।

## এই সংস্করণে

- Login ও Registration পেজের mobile brand header 37px brand mark-এ নামানো হয়েছে; উপরের instruction/marketing copy mobile-এ লুকানো। Desktop layout অক্ষত রাখা হয়েছে।
- OTP Verification ধাপকে email + একটি six-digit code field + verify action + compact resend countdown + Inbox/Spam/Promotions note + registration-এ ফেরার action-এ সীমিত করা হয়েছে।
- OTP screen-এর email ও registration context একই browser tab-এর `sessionStorage`-এ সর্বোচ্চ 30 মিনিট রাখা হয়, Gmail-এ গিয়ে ফিরে এলে বা reload হলে ধাপ ও absolute resend deadline restore করার জন্য। Password, confirmation password বা OTP code সংরক্ষণ করা হয় না। OTP সফল হলে বা Registration-এ ফিরে গেলে saved flow পরিষ্কার হয়।
- সাধারণ Menu পেজের PageHeader/InfoPanel copy সংক্ষিপ্ত করা হয়েছে: Members, Khala Money, Rankings, Help, Privacy/Terms intro, How-to, Hostel Notice, Archive ও Archive Edit। Privacy/Terms-এর পূর্ণ নীতিমালা সংক্ষিপ্ত করা হয়নি।
- Manager pages-এর নতুন মাস, মাস বন্ধ, Manager handover, Assistant Manager, Hostel Settings, Join Request, Member Management, Khala Money, Archive, Meal Sheet ও Report guidance সংক্ষিপ্ত করা হয়েছে। প্রয়োজনীয় সময়সীমা ও financial/permission warning রাখা হয়েছে।
- Dining-এর প্রতিটি প্রধান flow—Meal Request, History, Market, Final Meal Audit, Personal Meal, Override, Manager Review, Late/Manual Request, Deposit ও Other Expense—এর instruction copy ও entry option description সংক্ষিপ্ত করা হয়েছে।
- Ranking copy-তে বাজারকারী ও এন্ট্রিকারীর পার্থক্য সংক্ষিপ্তভাবে রাখা হয়েছে।
- Telegram connection privacy/guidance এবং App Download fallback copy সংক্ষিপ্ত করা হয়েছে।
- নতুন theme-native `ui-polish-v42.css` যোগ করা হয়েছে: InfoPanel ও helper text-এর compact styling, responsive spacing, mobile auth brand header এবং verification-card styling।
- প্রয়োজনীয় সময়সীমা ও operational warning অক্ষুণ্ণ রাখা হয়েছে।

## পরিবর্তনের সীমা

Run41-এর তুলনায় এই Candidate-এ পরিবর্তিত/যোগ হওয়া ফাইল:

- `src/features/auth/AuthPage.jsx`
- `src/features/menu/MenuPages.jsx`
- `src/features/menu/AppDownloadPage.jsx`
- `src/features/manager/ManagerPages.jsx`
- `src/features/dining/DiningPage.jsx`
- `src/features/telegram/TelegramConnectionPage.jsx`
- `src/main.jsx`
- `src/styles/ui-polish-v42.css` (নতুন)
- `tests/nov1_followup_contract.test.js` (সংক্ষিপ্ত Manager copy-এর contract update)
- `tests/run42MenuAndAuthUx.test.js` (নতুন UI regression tests)
- `RUN42_UI_CHANGELOG_BN.md` (এই নোট)

কোনো Supabase SQL Migration, Edge Function, database query, service API, permission/RLS বা production setting পরিবর্তন করা হয়নি। এই Run42 সংস্করণের জন্য নতুন Migration প্রয়োজন নেই।

## যাচাই

- `node --test`: 577 মোট; 574 পাস; 3 ব্যর্থ। ওই 3টি Run41 Baseline-এও ব্যর্থ ছিল: Stage-one OAuth guide file expectation, Backup local restore picker contract, Password re-authentication login metric contract।
- পরিবর্তিত 7টি JS/JSX source file: TypeScript transpile diagnostics-এ কোনো syntax error নেই।
- `src/styles/ui-polish-v42.css`: PostCSS parse পাস।
- পূর্ণ Vite Production Build চালানো যায়নি, কারণ Working Copy-তে Vite executable/dependencies ইনস্টল ছিল না।
- Production Database/Cloudflare/Edge Function-এ কোনো পরিবর্তন বা deployment হয়নি।

## ব্যবহারের সতর্কতা

এটি Candidate ZIP। মূল প্রজেক্টের ওপর সরাসরি Paste/Replace করবেন না। আলাদা ফোল্ডারে Extract করে staging/local test ও বাস্তব responsive UI review করে তারপর merge/deploy সিদ্ধান্ত নেবেন। Run39/Run40-এর পুরোনো Migration ফাইলগুলো inherited project content; Run42 UI Candidate-এর জন্য সেগুলো পুনরায় চালানোর নির্দেশনা নয়।
