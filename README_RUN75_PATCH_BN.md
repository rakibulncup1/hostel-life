# Hostel Life — Run75 Finishing Patch

## Patch-এর ভিত্তি

এই Patch **Run74 সম্পূর্ণভাবে প্রয়োগ করা প্রজেক্টের** জন্য তৈরি। অর্থাৎ Run72 Updated Project + Run73 Patch + Run74 Patch—এই ধারাবাহিকতার পর Run75 প্রয়োগ করতে হবে। Original production folder বা Run72-এর একেবারে পুরোনো copy-তে সরাসরি প্রয়োগ করবে না।

## এই Patch-এ কী আছে

- About landing page-এর typography, spacing, hero, feature/showcase cards ও screenshot gallery-এর refinement।
- আগে তৈরি code-built preview card-গুলো রাখা হয়েছে; তার পাশাপাশি প্রকৃত অ্যাপের ৭টি curated screenshot আলাদা gallery-তে দেখানো হয়েছে।
- আসল মেস/ব্যক্তির নাম দৃশ্যমান ছিল এমন `manager-menu.webp` এবং `manager-requests.webp` public gallery-তে ব্যবহার করা হয়নি।
- screenshot-এর ভেতরের লেখা বাংলা—এই বিষয়টি About page-এ Bengali ও English দুই ভাষাতেই স্পষ্ট করা হয়েছে।
- English mode-এ app-এর flex/grid child sizing, long label, button, member/history row ও heading wrapping উন্নত করা হয়েছে, যাতে লেখা একে অন্যের ওপর না পড়ে।
- Dark Theme-এ graphite/slate layered background, card, raised surface, input, border ও text contrast; রঙিন feature/status fill-গুলোকে muted neutral surface-এ আনা হয়েছে।
- Light Theme-এর app color tokens পরিবর্তন করা হয়নি। About public page-এর নিজস্ব light presentation উন্নত করা হয়েছে।
- Login, Registration, Password Recovery/Reset ও Onboarding-এর spacing/width responsive CSS দিয়ে compact করা হয়েছে; Auth submit/validation/data logic পরিবর্তন করা হয়নি।
- About, Privacy ও Terms পেজে public refinement stylesheet যুক্ত হয়েছে। Legal-page generator চালালেও stylesheet link বজায় থাকে।
- Theme browser metadata নতুন graphite dark background-এর সঙ্গে মিলানো হয়েছে।

## কোন ফাইল Replace / Add হবে

Manifest-এর `REPLACE` ফাইলগুলো আগের ফাইলের ওপর কপি করবে। `ADD` ফাইলগুলো নির্দিষ্ট path-এ নতুনভাবে যোগ করবে। এই Patch-এ screenshot image asset নতুন করে অন্তর্ভুক্ত করা হয়নি; সেগুলো Run72/Run73/Run74 project base-এ আগে থেকেই থাকতে হবে।

## ইনস্টল করার নিরাপদ নিয়ম

1. Run74-সহ বর্তমান test project-এর আরেকটি backup/copy তৈরি করো। Original Production project অক্ষত রাখবে।
2. ZIP-এর ভেতরের folder structure বজায় রেখে files-গুলো Run74 project root-এ Extract করো; Replace prompt এলে শুধু Manifest-এ থাকা ফাইল replace করো।
3. Root directory থেকে চালাও:

```bash
npm ci
npm test
npm run build
```

4. Vercel Preview-তে desktop ও mobile—দুই জায়গায় About, English mode, Light/Dark theme, Login, Registration, Forgot Password ও Password Reset পরীক্ষা করো।
5. সব যাচাই সফল হওয়ার আগে Production deploy করবে না।

## গুরুত্বপূর্ণ নোট

- কোনো Supabase schema, RPC, RLS, database migration, authentication logic বা user data পরিবর্তন করা হয়নি।
- `src/app/theme.js`-এ শুধু browser theme-color meta value Dark Theme-এর graphite surface-এর সঙ্গে মেলানো হয়েছে।
- `src/main.jsx`-এ Run75 CSS import যোগ হয়েছে; কোনো route বা app business logic বদলানো হয়নি।
- English translation user-entered name বা user-authored data-কে rewrite করে না।
- Full source project, `.env`, `node_modules`, `.git` বা database files এই Patch-এ নেই।

## পরীক্ষার সারাংশ

পরীক্ষার বিস্তারিত `TEST_REPORT_RUN75_BN.md`-এ দেওয়া আছে। নতুন Run75 targeted tests ৯/৯ পাস করেছে। Full suite-এ ৮৯৯টির মধ্যে ৮৮৯টি pass এবং Run74-এ নথিভুক্ত একই ১০টি baseline failure রয়ে গেছে। `npm run build` এই environment-এ চালানো যায়নি, কারণ `vite` executable অনুপস্থিত (`vite: not found`)—তাই production build verified বলা হচ্ছে না।
