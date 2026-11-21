# Hostel Life — Run110 Bilingual Design System Patch

## Baseline
এই প্যাচটি **Run109**-এর ওপর তৈরি। Run109-এর সঙ্গে মিল থাকা বর্তমান প্রজেক্টের Root Folder-এ প্রয়োগ করতে হবে। এটি পূর্ণাঙ্গ প্রজেক্ট ZIP নয়।

## কী পরিবর্তন হয়েছে

1. **Language-aware typography tokens** — `lang`/`data-language` অনুযায়ী বাংলা ও ইংরেজির আলাদা font stack, body line-height এবং inherited tabular numerals।
2. **Bangla type** — Noto Sans Bengali; fallback হিসেবে Windows/system Bengali fonts। বাংলা অ্যাপের line-height 1.62, public About/Legal পেজে 1.68।
3. **English type** — Inter; fallback হিসেবে system sans-serif। ইংরেজি অ্যাপের line-height 1.52, public About/Legal পেজে 1.60।
4. **First-paint language** — saved language preference app ও public About/Privacy/Terms pages-এ CSS render হওয়ার আগেই root `lang`, `data-language` এবং `data-locale`-এ বসে। পরবর্তী language switch-এ একই attributes update হয়।
5. **Super Admin language switch** — role, MFA ও re-authentication checks সম্পন্ন হওয়ার পর authenticated Super Admin header-এ shared local language switcher দেখা যায়। এটি কোনো নতুন database/network request যোগ করে না।
6. **English-only product branding** — Hostel Life নাম, footer copyright/developer credit এবং report tagline ইংরেজিতে থাকে। User-provided hostel/member names অনুবাদ হয় না।
7. **Numbers and currency** — বিদ্যমান `Intl.NumberFormat`/`৳` formatting অপরিবর্তিত; tabular numerals যোগ করা হয়েছে যাতে আর্থিক কলাম স্ক্যান করা সহজ হয়।
8. **Translation coverage** — About inventory keys ও অডিটে চিহ্নিত Google OAuth, member selection, report metadata এবং Super Admin confirmation copy-র ইংরেজি অনুবাদ যোগ/পরিপূর্ণ করা হয়েছে। বয়স-সম্মতি, মাস বন্ধ, স্থায়ীভাবে মুছে ফেলা ও permission/security সতর্কতা রাখা হয়েছে।
9. **PDF typography** — রিপোর্টের body selected locale-এর font stack ব্যবহার করে; product name/tagline ও footer branding Inter stack ব্যবহার করে। Font ready হওয়ার জন্য সীমিত wait আগের মতো থাকে।

## UI preservation
এই প্যাচে Dashboard/card/grid/button-এর `font-size`, `min-height`, padding, grid column, card dimensions বা dashboard colour palette বদলানো হয়নি। Typography tokens ও line-height ছাড়া layout geometry অক্ষত রাখাই ছিল উদ্দেশ্য। About/Legal pages-এ আলাদা language-aware body line-height রয়েছে।

## প্রয়োগ

1. বর্তমান Run109 প্রজেক্টের একটি পূর্ণ ব্যাকআপ রাখুন।
2. ZIP-এর ফাইলগুলো project root-এ Extract করুন এবং একই relative path-এ ফাইলগুলো Replace করুন।
3. `npm ci` চালিয়ে project dependencies install করুন (যদি `node_modules` না থাকে)।
4. `npm run verify:styles` চালান।
5. `npm test` চালান।
6. `npm run build` চালিয়ে local preview-তে Bangla/English, Dashboard, Profile, Super Admin, About/Legal, numbers/currency এবং PDF পরীক্ষা করুন।

## গুরুত্বপূর্ণ সীমাবদ্ধতা

- Inter ও Noto Sans Bengali Google Fonts CDN থেকে লোড হয়। `preconnect` ও `display=swap` initial loading delay কমাতে সাহায্য করে; তবে CDN/Internet না থাকলে system fallback font ব্যবহৃত হবে। FOUT/CLS সম্পূর্ণ শূন্য হবে—এমন নিশ্চয়তা দেওয়া যাচ্ছে না।
- এই কাজের container-এ `node_modules` অনুপস্থিত থাকায় Vite production build চালানো হয়নি। Changed JSX files TypeScript transpile syntax-check, JavaScript syntax-check, stylesheet-integrity check এবং automated tests করা হয়েছে।
- কোনো Supabase schema, SQL migration, RPC, Edge Function, database permission বা business calculation পরিবর্তন করা হয়নি।

## Verification ফলাফল

- Targeted bilingual/report/UI regression tests: **58/58 passed**.
- Stylesheet integrity: **PASS**.
- Full test suite: **1,185 passed / 1,202 total / 17 failed**. এই 17টি ব্যর্থতার প্রতিটিই Run109 baseline-এর 24টি পরিচিত failure-এর subset; Run110-এ নতুন failure যোগ হয়নি এবং আগের 7টি failure এখন pass করছে।
- Vite production build: **Not run** (container project copy-তে `node_modules` অনুপস্থিত)।

## Patch contents

শুধু Run109 baseline-এর তুলনায় পরিবর্তিত 27টি source/test file রয়েছে। `MANIFEST.json`, `SHA256SUMS.txt` ও `PATCH.diff`-এ ফাইল তালিকা, checksum এবং diff দেওয়া হয়েছে।
