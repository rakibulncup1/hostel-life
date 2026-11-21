# Hostel Life — Run109 Global Header & Google Sign-in Patch

## বেসলাইন

এই প্যাচটি **Run108-সমন্বিত Hostel Life প্রজেক্টের ওপর incremental update** হিসেবে তৈরি। এটি পূর্ণাঙ্গ প্রজেক্ট ZIP নয়।

## পরিবর্তনের পরিধি

### ১. সব PDF রিপোর্টের Header

- প্রজেক্টের বিদ্যমান `public/icons/hostel-life-mark.svg` লোগো ব্যবহার করা হয়েছে।
- লোগোর ডান পাশে বড় `Hostel Life` নাম, নিচে “সহজ, স্বচ্ছ ও সুশৃঙ্খল ব্যবস্থাপনা”, রিপোর্টের নাম এবং মাসের শুরু–শেষের তারিখ দেখানো হয়।
- মাস চলমান থাকলে শেষের তারিখের জায়গায় “চলমান” দেখায়।
- ডান পাশে ম্যানেজারের নাম ও যোগাযোগ নম্বর একই লাইনে থাকে; নিচে মাস, রিপোর্ট প্রস্তুতকারীর নাম ও তৈরির সময় থাকে।
- Header-এর দুই অংশের লেখা ও divider-এর মধ্যে ফাঁকা জায়গা রাখা হয়েছে।
- তারিখগুলো রিপোর্টের period metadata থেকে আসে; date-only মান UTC ধরে ফরম্যাট করা হয়, যাতে লোকাল timezone-এ একদিন পিছিয়ে/এগিয়ে না যায়।

### ২. সব PDF রিপোর্টের Footer

- আগের দুই লাইনের Copyright/Branding অপরিবর্তিত রাখা হয়েছে।
- Footer divider-এর ঠিক নিচে কপিরাইট লেখা থাকে; আগের তুলনায় উপরে আনা হয়েছে।
- আগের global page-margin কাঠামোই রাখা হয়েছে; body content Header/Footer-এর সংরক্ষিত জায়গায় প্রবেশ করে না।

### ৩. Google sign-in

- Google Identity Services-এর official button-এর supported `filled_blue` theme ব্যবহার করা হয়েছে।
- SDK আসার আগের placeholder/disabled button-এ একই নীল রঙের professional treatment দেওয়া হয়েছে; light/dark theme-এও রং স্থিতিশীল থাকে।
- Google authentication flow, consent, Supabase token exchange বা permission logic পরিবর্তন করা হয়নি।

## প্রয়োগ

1. বর্তমান Run108-সমন্বিত প্রজেক্টের আলাদা ব্যাকআপ রাখুন।
2. ZIP Extract করুন।
3. ZIP-এর ভেতরের `src/` ও `tests/` ফোল্ডারের ফাইলগুলো একই path-এ বর্তমান প্রজেক্টে Replace/Copy করুন।
4. Local environment-এ Final, Deposit, Market, Meal Sheet এবং Member Detail-এর একাধিক পৃষ্ঠার PDF খুলে প্রথম ও পরের পৃষ্ঠা যাচাই করুন।
5. যাচাই সফল না হওয়া পর্যন্ত Production-এ প্রয়োগ করবেন না।

## পরিবর্তিত ফাইলের পরিধি

মোট ১৬টি ফাইল: ৬টি source file এবং ১০টি test file। কোনো SQL migration, Supabase schema, RPC, Edge Function, permission policy, হিসাব বা authentication business logic পরিবর্তন করা হয়নি।

## যাচাই

- সংশ্লিষ্ট/লক্ষ্যভিত্তিক টেস্ট: **৭৭/৭৭ পাস**।
- সম্পূর্ণ টেস্ট স্যুট: **১,১৮৬টির মধ্যে ১,১৬২টি পাস**।
- বাকি ২৪টি ব্যর্থ টেস্টের নাম Run108 বেসলাইনের ২৪টি ব্যর্থতার সঙ্গে হুবহু একই; নতুন ব্যর্থতা যোগ হয়নি।
- `node --check src/services/reportService.js`: পাস।
- `node scripts/verify-stylesheet-integrity.mjs`: পাস।
- `node_modules` অনুপস্থিত থাকায় Vite production build চালানো সম্ভব হয়নি।

## গুরুত্বপূর্ণ

এই প্যাচটি report template ও auth button presentation-এ সীমাবদ্ধ। তবুও লাইভ ডেটা দিয়ে local PDF preview যাচাই না করে production-এ deploy করবেন না।
