# Hostel Life — Run113 Incremental Patch

## এই প্যাচে কী পরিবর্তন হয়েছে

এই প্যাচটি Run112-এর ওপর তৈরি এবং ব্যবহারকারীর অনুরোধ করা দুটি PDF Header পরিবর্তন ছাড়া অন্য কিছু স্পর্শ করে না।

1. **Logo alignment:** প্রকল্পের বিদ্যমান `/icons/hostel-life-mark.svg` লোগোটি ছোট, পরিমিত আকারে `Hostel Life` নামের একই লাইনে বসানো হয়েছে। Canvas-এ অ্যাপের নামের প্রকৃত glyph metrics মেপে লোগোর vertical center নির্ধারণ করা হয়, ফলে লোগো আর Header-এর মাঝামাঝি নিচে ঝুলে থাকে না। নামের বাম পাশে আগের horizontal gap বজায় আছে।
2. **Divider-এর পর ½ ইঞ্চি ফাঁকা:** A4 পৃষ্ঠার top margin এখন 50.8mm। `@top-center`-এ 12.7mm top inset, 25.4mm (এক ইঞ্চি) Header image এবং অবশিষ্ট 12.7mm gap সংরক্ষিত। অর্থাৎ পৃষ্ঠার উপর থেকে ½ ইঞ্চি ফাঁকা → ১ ইঞ্চি Header → divider-এর পরে ½ ইঞ্চি ফাঁকা → মূল রিপোর্টের তথ্য।

## অপরিবর্তিত রাখা হয়েছে

- বাম ও ডান পাশের 12.7mm (½ ইঞ্চি) margin।
- নিচের 38.1mm margin, 25.4mm Footer area এবং বিদ্যমান দুই লাইনের Copyright/Branding।
- Header-এর বাকি সব লেখা, বাংলা/ইংরেজি স্লোগান, manager/contact metadata, period/date-range এবং duplicate subtitle guard।
- রিপোর্টের টেবিল, আর্থিক হিসাব, ডেটা, Supabase, SQL, RPC, Edge Functions ও অন্যান্য UI।

## প্রয়োগের নিয়ম

1. Run112-সমন্বিত বর্তমান প্রজেক্টের ব্যাকআপ রাখুন।
2. ZIP Extract করে project root-এ একই path অনুযায়ী ফাইলগুলো কপি করুন।
3. **অ্যাপ্লিকেশনের জন্য শুধু `src/services/reportService.js` replace করতে হবে।**
4. `tests/` ফাইলগুলো regression test suite-এর আপডেট; এগুলোও project-এর `tests/` ফোল্ডারে কপি করলে আগের layout expectation-গুলো নতুন নির্ধারিত মাপের সঙ্গে সামঞ্জস্যপূর্ণ থাকবে।

## যাচাই

- Run112 period/header regression checks এবং Run113-এর নতুন logo/gap regression checks সহ 9টি targeted test পাস করেছে।
- তিন-পৃষ্ঠার A4 print-layout fixture PDF-এ প্রতিটি পৃষ্ঠায় Header/Footer পুনরাবৃত্তি, ½ ইঞ্চি top inset, ১ ইঞ্চি Header এবং divider-এর পরে ½ ইঞ্চি gap-এর geometry যাচাই করা হয়েছে।
- এই execution environment-এ Chromium headless print সম্পন্ন হয়নি; fixture PDF-টি WeasyPrint দিয়ে তৈরি। তাই Chrome/Edge-এ প্রজেক্টের live report একবার localভাবে যাচাই করে নেওয়া উচিত।
- পূর্ণ Vite production build চালানো হয়নি।

## Base / Patch

- Base: `Hostel_Life_Run112_Report_Header_Fix_Patch.zip`
- Patch: `Hostel_Life_Run113_Logo_Alignment_and_Header_Gap_Patch.zip`
- Patch scope: 1 runtime source file + 7 regression test files + documentation/manifest.
