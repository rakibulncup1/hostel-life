# Hostel Life — Run119 Patch (বাংলা নির্দেশনা)

এই Incremental Patch টি Run118-সমন্বিত Hostel Life প্রজেক্টের ওপর তৈরি। সম্পূর্ণ প্রজেক্ট ZIP নয়।

## এই প্যাচে যা আছে

1. Final Meal Correction-এর ব্যক্তি-ভিত্তিক ভিউতে মোবাইল স্ক্রিনে Breakfast, Lunch ও Dinner আলাদা সারিতে দেখানোর responsive layout। লেবেল ভেঙে উল্লম্বভাবে না গিয়ে Plus/Minus controls কার্ডের ভেতরে থাকবে।
2. মেস সেটিংসের মধ্যে `সদস্যের ক্রম` সেটিং। ম্যানেজার ও চলমান period-এ অনুমোদিত সহকারী ম্যানেজার সদস্যদের ক্রম উপরে/নিচে সরিয়ে Database-এ সংরক্ষণ করতে পারবেন।
3. সংরক্ষিত ক্রম Dashboard-এর সদস্য তালিকা, সদস্য নির্বাচন/ডিরেক্টরি, Final Meal ও Manual Meal-এর সদস্য তালিকা এবং সাধারণ Live/Archived রিপোর্টে ব্যবহার হবে। Ranking views (যেমন সর্বোচ্চ Deposit বা Meal) এই ক্রম ব্যবহার করবে না।
4. Google Identity Services-এর Public Button Library আগে থেকে লোড হবে যাতে সম্মতির পর অপেক্ষা কম হয়। OAuth preparation, nonce, GIS initialize ও sign-in callback এখনও স্পষ্ট সম্মতির পরেই শুরু হবে।

## গুরুত্বপূর্ণ গোপনীয়তা নোট — Google preload

Google-এর public `gsi/client` script Auth page-এ অবস্থানকালে preload হয়। ফলে সম্মতির আগেই ব্রাউজার Google-এর সাথে সাধারণ script request করতে পারে এবং সেই request-এর স্বাভাবিক network metadata Google দেখতে পারে। তবে OAuth nonce তৈরি, sign-in initialize, popup বা credential পাঠানো সম্মতির আগ পর্যন্ত শুরু হয় না। এ ধরনের public third-party request-ও সম্মতির আগে সম্পূর্ণ বন্ধ রাখতে চাইলে preload effect সরাতে হবে, তবে তখন সম্মতির পর Google button তৈরি হতে বেশি সময় লাগতে পারে।

## প্রয়োগের ক্রম

1. Run118-সমন্বিত বর্তমান প্রজেক্ট ও Supabase Database-এর backup নিন।
2. Supabase SQL Editor-এ `supabase/migrations/Run97_member_order_manager_settings.sql` ফাইলটি একবার চালান। এটি `hostel_memberships.member_order` কলাম, check constraint, index, member-directory/archive-detail RPC update এবং manager-only order-save RPC যোগ/পরিবর্তন করে। SQL transaction-এ আবদ্ধ।
3. Migration সফল হলে ZIP Extract করে প্রজেক্ট Root-এ একই path অনুযায়ী ফাইলগুলো Replace/Add করুন।
4. `npm ci` চালিয়ে dependency install করুন।
5. পরীক্ষা চালান:

```powershell
node --test tests/run119_member_order_and_mobile_meal_layout.test.mjs
npm run verify:styles
npm test
npm run build
```

6. Local app-এ মোবাইল Final Meal card, Manager/Assistant Manager role-এ Member Order setting, Dashboard, সাধারণ report, Manual/Final Meal-এর Everyone list এবং Google consent/sign-in পরীক্ষা করুন। সব ঠিক থাকলে staging/production-এ deploy করুন।

## Database আচরণ ও সীমা

- Migration কোনো আর্থিক amount, meal record, ledger entry, request বা audit row পরিবর্তন করে না।
- Ranking query/service পরিবর্তিত হয়নি।
- `member_order` মেসভিত্তিক এবং সদস্যের membership row-তে সংরক্ষিত হয়।
- Migration-এর সময় বিদ্যমান সক্রিয়/নিষ্ক্রিয়, non-blocked সদস্যদের প্রাথমিক ক্রম বর্তমান alphabetical order অনুসারে বসবে। এরপর ম্যানেজার চাইলে নতুন ক্রম সেট করবেন।
- নতুন সদস্যের order প্রথমে NULL থাকবে; তালিকায় সংরক্ষিত সদস্যদের পরে নামের ক্রমে দেখাবে, যতক্ষণ না ম্যানেজার নতুন সম্পূর্ণ ক্রম সংরক্ষণ করেন।
- `manager_save_hostel_member_order` সম্পূর্ণ মেসের বর্তমান eligible membership ID list চায়; তালিকা পরিবর্তিত/অসম্পূর্ণ হলে save প্রত্যাখ্যান করে।
- Manager/Assistant Manager access backend authorization helper দিয়েও যাচাই করা হয়; শুধু UI guard-এর ওপর নির্ভর করা হয়নি।

## পরীক্ষার সীমাবদ্ধতা

প্যাচ প্রস্তুতের পরিবেশে `node_modules` অনুপস্থিত থাকায় পূর্ণ Vite Production Build করা যায়নি। SQL migration কোনো live Production Supabase Database-এ চালানো হয়নি। Production-এ প্রয়োগের আগে Backup ও staging/local যাচাই বাধ্যতামূলক।
