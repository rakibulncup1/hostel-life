HOSTEL LIFE — RUN64 RUN49 + RUN63 COMPATIBILITY RECOVERY PATCH

এই প্যাচটি Run49 Meal Mode/UI patch-এর পরিবর্তনগুলো Run63 Frontend/Privacy patch-এর সঙ্গে সঠিকভাবে একত্র করে তৈরি করা হয়েছে। আগের Run63 ZIP-এ Run49-এর পরিমার্জিত কিছু ফাইল baseline সংস্করণ দিয়ে প্রতিস্থাপিত হয়েছিল। এই recovery patch সেই overlap ঠিক করে।

যে গুরুত্বপূর্ণ বিষয়গুলো একসঙ্গে রাখা হয়েছে
- Run49-এর Breakfast/Lunch/Dinner Half/Full Meal Mode: Manager Settings UI, save RPC service, Dashboard-এর meal-count conversion ও helper.
- Dashboard-এর Today Meal এবং Late Request-এ সংখ্যা অপরিবর্তিত রেখে “জন” label.
- Run49-এর Auth, onboarding, manager, menu, Telegram, download ও অন্য UI refinements.
- Run49 এবং Run63—দুই stylesheet-ই main.jsx থেকে load হয়; একটির import দিয়ে অন্যটি প্রতিস্থাপিত নয়.
- Onboarding-এর minimal create-success flow এবং form styling অক্ষুণ্ন.
- Run63-এর shared Privacy/Terms source, public legal pages/generator এবং responsive notice dialog styling.
- Registration email helper copy-ও Run63 test ও UX-এর সঙ্গে মিলিয়ে সংশোধিত.

ইনস্টল
1. বর্তমান production project-এর সম্পূর্ণ backup নিন.
2. ZIP extract করে এর src/, public/, scripts/, tests/ এবং package.json ফাইলগুলো Project Root-এ একই path রেখে Replace/Merge করুন.
3. এই recovery patch-এ কোনো database migration নেই. Run49 migration আগেই চালানো থাকলে সেটি আবার চালাবেন না. বিদ্যমান hostels.meal_count_modes সেটিং ও database data অপরিবর্তিত রাখুন.
4. কোনো Supabase Edge Function, Telegram secret, Run48 Notification migration বা database object এই patch পরিবর্তন করে না.
5. Dependency প্রস্তুত থাকলে `npm test` এবং `npm run build` চালিয়ে তারপর আপনার স্বাভাবিক deployment process অনুসরণ করুন.

যাচাইয়ের ফল
- Run49/Run63 সংশ্লিষ্ট focused tests: ১৪০/১৪০ passed.
- Merge compatibility guard: ৩/৩ passed.
- Full test suite: ৮৩১টির মধ্যে ৮২১টি passed; ১০টি failed. এই ১০টি ব্যর্থ test-এর নাম ও ফল মূল uploaded baseline ZIP-এর ১০টি known failure-এর সঙ্গে হুবহু একই; merge নতুন failure যোগ করেনি.
- ৩০টি JS/JSX/MJS source/test file TypeScript transpile parser দিয়ে syntax check করা হয়েছে; ৩টি CSS file PostCSS parser দিয়ে যাচাই করা হয়েছে.
- Public Privacy/Terms generator পরপর দুইবার চালিয়ে idempotence নিশ্চিত করা হয়েছে.
- Vite executable/node_modules এই runtime-এ অনুপস্থিত, তাই production Vite build চালানো যায়নি; build pass দাবি করা হচ্ছে না.
- Live database-এ কোনো query/migration চালানো হয়নি.

নোট
- Run49-এর SQL migration ZIP থেকে ইচ্ছাকৃতভাবে বাদ রাখা হয়েছে, কারণ সেটি আগে থেকেই চালানো হয়েছে বলে ধরা হয়েছে. এই recovery patch কেবল project files পুনরুদ্ধার/সমন্বয় করে.
- এই ZIP সম্পূর্ণ project archive নয়; এটি overlay patch. ZIP-এর path সরাসরি Project Root-এর সঙ্গে মিলে যাবে.
