# Hostel Life — Final Feature Update (V4)

এই প্যাকেজটি আগের V3 প্রজেক্টের উপর ভিত্তি করে। সম্পূর্ণ Core migration আবার চালানোর জন্য নয়। ব্যবহারকারী নিশ্চিত করেছেন যে Core ও বর্তমান Super Admin panel চালু আছে।

## কী রয়েছে

- Super Admin UI: মেস/সদস্য search ও filters, Favorite/Trusted flags, block/unblock, suspend/activate, আর exact-phrase confirmation-সহ permanent delete controls।
- Permanent delete account-safety: একজন সদস্য অন্য মেসেও থাকলে তার Auth account মুছতে SQL অপারেশন ব্লক করবে; শুধু target-mess membership ও তার scoped records delete করা যায়। পুরো মেসের সব Auth accounts মুছতেও cross-mess membership/ownership guard আছে।
- Developer photo: Supabase Storage-এর `developer-assets` bucket-এ JPG/PNG/WEBP আপলোড ও URL public settings-এ save করা।
- Registration: phone UI-তে required এবং Auth trigger-এ ৮–১৫ digit validation।
- Generic denial copy: role/অনুমতির internal detail সাধারণ ব্যবহারকারীকে দেখায় না।
- Market History: History UI primary-manager membership identity-র `membership_id` এবং `id` দুই contract-ই শনাক্ত করে; current running period-এর canonical RPC থেকে primary manager/assistant check করে। Archived period এখনও explicit archive-edit permission দ্বারা gated।
- Vercel direct URL rewrite for `/super-admin`.

## Backend SQL চালানো

1. Supabase project-এর backup নিন।
2. নিশ্চিত করুন existing Core এবং Super Admin migrations আগেই successful হয়েছে (তোমার সর্বশেষ status-check-এ সব marker FOUND ছিল)।
3. Supabase → SQL Editor-এ **`supabase/HOSTEL_LIFE_FINAL_ADDITIVE_BACKEND_MIGRATION_V2.sql`**-এর পুরো বিষয়বস্তু একবার চালান। এটি দুইটি additive transaction: Super Admin enhancements তারপর market authorization repair। এটি full Core migration নয়।
4. Script-এর শেষে verification SELECT-গুলো দেখুন। কোনো statement error দিলে পরে বাকি অংশ নির্বিচারে run করবেন না; error এবং failing section সংরক্ষণ করুন।
5. API schema refresh না হলে Dashboard → Settings → API → schema cache reload available থাকলে reload করুন, অথবা এক-দুই মিনিট অপেক্ষা করে আবার চেষ্টা করুন।

## Deploy এবং test

1. ZIP extract করুন; `.env.local` (নিজস্ব Supabase URL ও anon key) নিরাপদে যোগ করুন। কোনো service-role key frontend-এ দেবেন না।
2. `npm ci`
3. `npm test`
4. `npm run build`
5. Deploy করুন। এই source test-এ ১৫টি Node test pass করেছে, সব ৬০টি JS/JSX ফাইল TypeScript transpile syntax-check pass করেছে এবং relative imports resolve করেছে। এই environment-এ `vite` dependency উপস্থিত না থাকায় production build সম্পন্ন হয়নি; তাই নিজের deploy environment-এ `npm ci` ও `npm run build` অবশ্যই চালাতে হবে।

## Live smoke test

- `/super-admin` সরাসরি URL দিয়ে খুলুন; Super Admin account-এ re-auth password prompt pass করতে হবে। সাধারণ account-এ generic denial message হওয়া উচিত।
- একটি test mess-কে suspend করুন, আবার activate করুন।
- একটি test mess ও test member-কে Favorite/Trusted করুন, filter থেকে খুঁজে পান কিনা দেখুন।
- Developer photo upload করুন, settings save করুন, Developer Info section-এ ছবির URL/preview দেখুন।
- নতুন test registration-এ phone ফাঁকা রাখলে frontend ও backend উভয় স্তরে reject হওয়া উচিত।
- Market History-তে running-period primary manager account থেকে edit button দেখতে হবে; একটি test market item-এর নাম/amount edit করে save দিন এবং total verify করুন।
- **Permanent delete শুধুমাত্র test mess/member-এ যাচাই করুন।** এটি irreversible। অন্য মেসেও membership থাকা ব্যক্তির Auth account delete চেষ্টা করলে SQL-কে safety error দিতে হবে; এতে වෙන mess-এর data যেন না মুছে যায়।

## স্থায়ী ডিলিট সম্পর্কে

এই কাজ reversible নয়। Hostel-level delete-এর আগে SQL দুই ধাপে confirmation চায়: browser confirmations এবং exact phrase `DELETE HOSTEL <hostel-uuid>`। Member-level delete exact phrase `DELETE MEMBER <user-uuid>` চায়। Database-ও Super Admin role re-check করে। Hosted account deletion আলাদাভাবে বেছে না নিলে Auth account অক্ষত থাকবে। Cross-host references বা protected accounts থাকলে DB transaction exception দিয়ে rollback করবে।

## Important

- `HOSTEL_LIFE_CORE_FINAL_MIGRATION_ALL_IN_ONE.sql`, পুরোনো Core SQL বা V1 recovery migration পুনরায় চালাবেন না।
- শুধু main additive migration-টাই চালান; আলাদা sub-SQL আবার চালানোর দরকার নেই, যদি main migration সফল হয়।
- SQL-এর স্থায়ী deletion প্রকৃত schema/FK ও লাইভ test data অনুযায়ী সফল কিনা পরীক্ষা করুন; production-এর আসল মেস দিয়ে প্রথমে পরীক্ষা করবেন না।
