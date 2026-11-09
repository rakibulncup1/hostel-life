# Hostel Life — Run43 UI Refinement

## এই Candidate-এর ভিত্তি
- Base: `HostelLife_Run42_Menu_Auth_UI_Candidate.zip`
- এই Candidate কেবল Finance UI, Auth brand header, এবং Email Verification presentation উন্নত করে।
- এটি Production-এ গ্রহণ করা Baseline নয়; ব্যবহারকারী পরীক্ষা ও অনুমোদন না দেওয়া পর্যন্ত Candidate হিসেবেই থাকবে।

## কী পরিবর্তন হয়েছে

### হিসাব ও Finance ফিচার
- New Month, Close Month, Khala Money, Archive Management, Meal Sheet, Reports, Ranking এবং Previous Months পেজের নির্দেশনামূলক InfoPanel-গুলোকে বড় কার্ড থেকে ছোট inline guidance-এ রূপান্তর করা হয়েছে।
- Close Month ও Archive-এর গুরুত্বপূর্ণ সতর্কতার warning color/meaning বজায় রেখে একই minimal presentation ব্যবহার করা হয়েছে।
- History পেজের উপরের বড় colored information card-কে শান্ত, text-led hint করা হয়েছে।
- আর্থিক হিসাব, Permission, Query, RPC, Service বা Data flow পরিবর্তন করা হয়নি।

### Login ও Registration Brand Header
- `HOSTEL LIFE` এবং `MESS MANAGEMENT · MADE SIMPLE` ইংরেজি submark সরানো হয়েছে।
- Brand wordmark এখন বাংলায় `হোস্টেল লাইফ`।
- `হিসাব ও ব্যবস্থাপনা, এক জায়গায়` sparkle badge সরানো হয়েছে।
- BrandMark-এর চারপাশের অতিরিক্ত card/border/shadow সরিয়ে একটিমাত্র মূল mark রাখা হয়েছে।
- Desktop-এ ছোট, সংযত Bengali brand presentation; মোবাইলে শুধু mark ও Bengali wordmark—কোনো instruction text নয়।

### Email Verification
- Verification header থেকে একই কথা বারবার দেখানো toolbar label সরানো হয়েছে।
- Email card, one-time code input, resend timer, Spam/Promotions hint ও Back action অক্ষুণ্ণ রেখে তাদের visual hierarchy উন্নত করা হয়েছে।
- Authentication API, OTP validation, resend rate limit, sessionStorage behavior বা registration logic পরিবর্তন করা হয়নি।

## পরিবর্তিত ফাইল
1. `src/features/auth/AuthPage.jsx`
2. `src/features/history/HistoryPage.jsx`
3. `src/features/manager/ManagerPages.jsx`
4. `src/features/menu/MenuPages.jsx`
5. `src/main.jsx`
6. `src/styles/ui-polish-v43.css` (new)
7. `tests/run43FinanceAndAuthVisualRefinement.test.js` (new)

## যাচাই
- Run42 baseline full suite: 577 tests; 574 passed, 3 failed.
- Run43 full suite: 582 tests; 579 passed, 3 failed.
- Run43 newly added UI tests: 5/5 passed.
- একই 3টি পুরোনো failure Run42 baseline-এও ছিল: missing Google OAuth stage-one README, existing backup picker contract expectation, and existing password re-authentication metric expectation.
- TypeScript transpile syntax check: পাঁচটি modified JS/JSX file passed.
- PostCSS parse: new `ui-polish-v43.css` passed.
- Vite production build not run: `vite` executable is not installed in this working copy.
- Production Supabase/Edge Functions untouched; no migration or SQL file added/changed.

## নিরাপদ ব্যবহারের নির্দেশনা
- ZIP আলাদা ফোল্ডারে extract করে পরীক্ষা করুন; পুরোনো Production folder-এর ওপর সম্পূর্ণ project copy/paste করবেন না।
- UI পরিবর্তনগুলো যাচাই করে অনুমোদন না দেওয়া পর্যন্ত এই Candidate-কে Production baseline হিসেবে গণ্য করবেন না।
