Hostel Life — Run104 UI Patch
তারিখ: ২১ নভেম্বর ২০২৬

এই প্যাচে শুধু দুটি অনুরোধকৃত UI পরিবর্তন করা হয়েছে:
1) লগইন পেজে “পাসওয়ার্ড ভুলে গেছেন?” অ্যাকশনটি শিরোনাম থেকে সরিয়ে নিচের
   “এখনো অ্যাকাউন্ট নেই? রেজিস্ট্রেশন” লাইনের ডান পাশে রাখা হয়েছে।
   “আবারও স্বাগতম” পরিচিতি/শিরোনামের আগের বিন্যাস পুনরুদ্ধার করা হয়েছে।
2) Dashboard-এর সদস্যভিত্তিক বিস্তারিত মডাল প্রশস্ত ও কেন্দ্রীভূত করা হয়েছে;
   বড় স্ক্রিনে ছয়টি সারাংশ-কার্ড ৩ কলাম × ২ সারিতে এবং কম উচ্চতায় থাকবে।
   ছোট ফোনে পাঠযোগ্যতার জন্য ২ কলাম রাখা হয়েছে।

পরিবর্তিত ফাইল:
- src/features/auth/AuthPage.jsx
- src/styles/run103-about-login-precision.css
- tests/run103_about_login_precision.test.mjs (শুধু টেস্ট আপডেট)

প্রয়োগ:
- ZIP-এর ভেতরের ফোল্ডার স্ট্রাকচার প্রজেক্ট রুটে রেখে ফাইলগুলো replace করুন।
- চাইলে PATCH.diff দেখে/প্রয়োগ করে পরিবর্তন নিতে পারেন।
- production-এ প্রয়োগের আগে staging/local-এ login, forgot-password navigation,
  member details modal, desktop/mobile ও dark theme পরীক্ষা করুন।
- এই প্যাচে কোনো SQL, Supabase schema/RPC, auth service, হিসাবের লজিক,
  Edge Function, deployment config বা unrelated ফাইল পরিবর্তন করা হয়নি।

যাচাই:
- Run103 UI tests + সম্পর্কিত Run89/Run100/Run101 tests: 51 passed.
- Stylesheet source integrity: passed.
- JSX এবং CSS parse: passed.
- পূর্ণ test suite: 1,150টির মধ্যে 1,126 passed, 24 failed। ব্যর্থ টেস্টগুলো
  প্যাচের পরিবর্তিত তিনটি ফাইলের বাইরের বিদ্যমান/অন্য feature-এর বিষয়।
- ZIP-এ node_modules না থাকায় Vite production build চালানো যায়নি।
