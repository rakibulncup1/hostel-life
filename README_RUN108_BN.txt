HOSTEL LIFE — RUN108 GLOBAL REPORT DESIGN PATCH
================================================

বেসলাইন: Run107-সমন্বিত Hostel Life project
উদ্দেশ্য: সব PDF/Print report-এর জন্য একক, পুনরাবৃত্ত Global Header/Footer layout।

এই প্যাচে নির্ধারিত মাপ
----------------------
- A4 Portrait ও Landscape: বাম/ডান পাশে 12.7 mm (0.5 inch) margin।
- প্রতিটি পৃষ্ঠায় উপরে Header-এর জন্য 25.4 mm (1 inch) reserved area।
- প্রতিটি পৃষ্ঠায় নিচে Footer-এর জন্য 25.4 mm (1 inch) reserved area।
- Header: বাম পাশে আসল Hostel Life mark, app name, tagline ও report title; ডান পাশে period/month, manager name/phone, report creator ও generated timestamp।
- Header divider পুরো report content width জুড়ে।
- Footer: বিদ্যমান দুই লাইনের copyright/branding text; divider উভয় পাশ থেকে 12.7 mm করে ছোট, অর্থাৎ মোট 25.4 mm (1 inch) কম এবং centered।
- সব পৃষ্ঠায় header/footer পুনরাবৃত্তি হয়; content স্বাভাবিকভাবে পরের পৃষ্ঠায় প্রবাহিত হয়।

সংশ্লিষ্ট source files
---------------------
- src/services/reportService.js — Global print template, logo inline SVG, page margin boxes, metadata.
- src/features/dashboard/DashboardPage.jsx — Dashboard member report-এ manager/creator metadata.
- src/features/menu/MenuPages.jsx — All Members থেকে একই member detail report context.
- src/features/manager/ManagerPages.jsx — Meal Sheet ও Reports-এ report creator metadata.
- src/features/history/HistoryPage.jsx — History ও archived report creator metadata.
- src/features/archive/ArchiveCorrectionPage.jsx — Archived PDF creator metadata.

Tests
-----
- Run108 global report header/footer contract tests added.
- Existing Run105/106/107 print-margin assertions updated to exact new global dimensions.
- Archived report metadata call expectation updated.

প্রয়োগের নিয়ম
-------------
1. বর্তমান Run107-সমন্বিত project-এর সম্পূর্ণ backup নিন।
2. এই ZIP-এর folder structure অক্ষুণ্ণ রেখে project root-এ extract করুন।
3. শুধু ZIP-এ থাকা ফাইলগুলো replace করুন।
4. Local environment-এ A4 Portrait এবং Landscape report খুলে অন্তত 2-3 পৃষ্ঠার রিপোর্ট পরীক্ষা করুন।
5. প্রথম, মাঝের ও শেষ পৃষ্ঠায় header/footer, টেবিলের পুনরাবৃত্ত heading এবং content overlap পরীক্ষা করে তারপর Production-এ প্রয়োগ করুন।

যা পরিবর্তন করা হয়নি
--------------------
- Supabase schema, SQL migrations, RPC, Edge Functions, RLS/permissions বা business calculation logic পরিবর্তন করা হয়নি।
- অন্য UI/page/feature পরিবর্তন করা হয়নি।
- প্যাচে পূর্ণাঙ্গ project বা dependencies অন্তর্ভুক্ত নয়।

পরীক্ষার ফল
-----------
- Targeted regression tests: 30/30 passed.
- Full suite: 1,180 tests; 1,156 passed; 24 failed.
- Run107 baseline: 1,174 tests; 1,150 passed; 24 failed.
- Baseline ও Run108-এ ব্যর্থ test title-এর সেট হুবহু একই; নতুন কোনো failure যোগ হয়নি।
- WeasyPrint দিয়ে 11-page A4 sample render করা হয়েছে; page 1 ও 2-তে header/footer alignment এবং repetition visually inspected.
- এই runtime-এ Chromium headless চালানো যায়নি; Vite production build-ও করা হয়নি, কারণ node_modules উপস্থিত নেই। তাই Production-এ প্রয়োগের আগে স্থানীয় Chromium/Chrome দিয়ে PDF print preview পরীক্ষা আবশ্যক।
