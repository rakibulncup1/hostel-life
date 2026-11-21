# Hostel Life — Run107 Patch

## বেসলাইন

এই প্যাচটি **Run106-এ আপডেট করা বর্তমান প্রজেক্টের উপর** প্রয়োগ করতে হবে। Run104, Run105 ও Run106-এর গৃহীত পরিবর্তনগুলো আগেই প্রজেক্টে থাকা আবশ্যক। এটি পূর্ণাঙ্গ প্রজেক্ট ZIP নয়; শুধু পরিবর্তিত ফাইলগুলো রয়েছে।

## এই প্যাচে করা কাজ

1. **সকল রিপোর্টের PDF ফ্রেম:** সব রিপোর্টের জন্য একই `printReport()` ফ্রেম ব্যবহার করা হয়েছে। Header-এর জন্য প্রতিটি পৃষ্ঠার উপরে আলাদা Page Margin Area (`@top-left`, `@top-right`) এবং Branding/Copyright Footer-এর জন্য নিচে আলাদা Page Margin Area (`@bottom-center`) সংরক্ষিত। রিপোর্টের তথ্য মাঝের নির্ধারিত জায়গায় স্বাভাবিকভাবে পৃষ্ঠা ধরে প্রবাহিত হবে। Portrait ও Landscape দুটোই সমর্থিত; টেবিলের header এবং row pagination-ও রাখা হয়েছে। Run106-এর negative fixed offsets বাদ দেওয়া হয়েছে।
2. **Login:** “এখনো অ্যাকাউন্ট নেই? রেজিস্ট্রেশন” এক লাইনে কেন্দ্রস্থলে এবং “পাসওয়ার্ড ভুলে গেছেন?” তার নিচে কেন্দ্রস্থলে রাখা হয়েছে।
3. **Help / প্রশ্নোত্তর:** FAQ group, প্রশ্ন, summary এবং answer-এর width/min-width/wrapping নিয়ন্ত্রণ করা হয়েছে যাতে ছোট স্ক্রিনে কনটেন্ট বাইরে না যায়।
4. **খালার টাকা History:** সদস্য, তারিখ, বিবরণ, পরিশোধিত অর্থ, স্ট্যাটাস এবং অনুমোদিত edit/cancel action একই card-এর ভেতরে সাজানো হয়েছে। বিদ্যমান permission condition ও action handler অপরিবর্তিত।
5. **সকল সদস্যের বিস্তারিত:** Dashboard ও All Members—দুই জায়গাতেই একই `MemberPeriodDetailsModal` ব্যবহার করা হয়। All Members-এ একই dashboard-specific presentation scope প্রয়োগ করা হয়েছে, ফলে modal-এর summary/card sizing একই হবে।

## পরিবর্তিত ফাইল

- `src/services/reportService.js`
- `src/features/dashboard/DashboardPage.jsx`
- `src/features/menu/MenuPages.jsx`
- `src/features/manager/ManagerPages.jsx`
- `src/styles/run105-requested-ui-polish.css`
- `tests/run105_requested_ui_patch.test.mjs` (পুরোনো print-layout expectation নতুন shared page-margin layout অনুযায়ী আপডেট)
- `tests/run106_focused_followup.test.mjs` (পুরোনো fixed-header/footer expectation নতুন shared page-margin layout অনুযায়ী আপডেট)
- `tests/run107_global_report_and_ui_regressions.test.mjs` (নতুন focused regression test)

## যাচাই

- Focused Run105/Run106/Run107 checks: **24/24 PASS**
- Full Node test suite: **1174 tests; 1150 PASS; 24 FAIL**. এই 24টি ব্যর্থতার নাম Run106 cumulative baseline-এর 24টি ব্যর্থতার সঙ্গে হুবহু মিলে গেছে; Run107 নতুন কোনো failure যোগ করেনি।
- Stylesheet integrity: **PASS**
- সংশ্লিষ্ট JSX/JavaScript parse check: **PASS**
- Chromium PDF pagination: **Portrait sample 9 pages** এবং **Landscape sample 14 pages** তৈরি করে পৃষ্ঠা 1 ও 2 visual check করা হয়েছে; header/footer প্রতিটি পৃষ্ঠায় সঠিক page margin-এ ছিল।
- Responsive viewport check: **320, 360, 390, 768px**-এ FAQ ও Khala card-এর জন্য horizontal page overflow পাওয়া যায়নি।

## সীমাবদ্ধতা ও Production নির্দেশনা

- এই ZIP-এ `node_modules` নেই, তাই Vite production build চালানো হয়নি।
- PDF page-margin boxes আধুনিক Chromium-based print engine-এ পরীক্ষা করা হয়েছে। Production-এ ব্যবহৃত একই browser/version দিয়ে একটি Portrait ও Landscape রিপোর্ট পরীক্ষা করে তারপর deploy করবেন।
- কোনো Supabase SQL, migration, RPC, Edge Function, schema, permission policy, backend data flow বা account permission পরিবর্তন করা হয়নি।
- Production-এ সরাসরি Replace না করে আগে backup এবং staging/local test ব্যবহার করুন।

## প্রয়োগ

1. বর্তমান Run106 প্রজেক্টের ব্যাকআপ রাখুন।
2. ZIP-এর ফাইলগুলো project root-এ extract করে একই path-এর ফাইলগুলো replace করুন।
3. `npm test` এবং `npm run verify:styles` চালান।
4. Local/staging-এ Portrait ও Landscape report, multi-page report, Login, Help FAQ, Khala history এবং All Members member-detail modal পরীক্ষা করুন।
5. সব ঠিক থাকলেই Production-এ deploy করুন।
