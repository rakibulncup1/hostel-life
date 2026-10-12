# Hostel Life — Supabase Usage Audit & Fix V2

এই প্যাকেজে frontend থেকে অপ্রয়োজনীয় Supabase request/log volume কমানোর নিরাপদ পরিবর্তন আছে। এটি কোনো live Supabase project-এ সংযোগ করে পরিবর্তন করে না এবং আগের usage counter মুছে দেয় না। পরিবর্তন deploy করার পর থেকেই ভবিষ্যৎ usage-এ প্রভাব দেখা যাবে।

## এই প্যাকে কী বদলেছে

1. `src/lib/rpcCompatibility.js` নতুন helper: নতুন-version RPC না থাকলে তার PostgREST missing-function/schema-cache error একই browser tab-এ বারবার probe না করে compatible পুরোনো RPC ব্যবহার করে। Permission, validation বা network error-কে version-missing ভেবে fallback চালায় না।
2. `diningService.js`, `historyService.js` এবং `reportService.js`-এর version fallback একই resolver ব্যবহার করে। Report-এর fallback এখন `PGRST202/PGRST203`-সহ পরিচিত missing-RPC error বুঝতে পারে।
3. `useManagementContext.js`-এ richer context RPC অনুপস্থিত থাকলেই কেবল running-period fallback ব্যবহার হয়। আসল permission/server/network error হলে আর দ্বিতীয় RPC অনর্থকভাবে চালায় না। অনুপস্থিত RPC-টিও একই tab-এ পুনরায় probe হবে না। SQL function deploy/update করার পরে নতুন function-টি ধরাতে app tab reload করতে হবে।
4. `useRealtimeRefresh.js`-এ realtime, focus, visibility ও online event—সব automatic refresh একই ১৫-সেকেন্ড throttle মেনে চলে। Browser একই সময়ে একাধিক resume/focus event দিলে ঘন ঘন RPC refresh হওয়ার ঝুঁকি কমে।
5. Node-এর built-in test runner দিয়ে RPC fallback আচরণ যাচাই করার জন্য `tests/rpcCompatibility.test.js` এবং `npm test` script যোগ করা হয়েছে।

আগের Log Ingestion Optimization V1-এ Dashboard cache/fetch loop, background polling, hidden-tab subscription, duplicate refresh ও service-worker static asset fetch-এর যে সংশোধন ছিল, সেগুলোও এই প্যাকেজে রাখা হয়েছে।

## ছবির ছয়টি মেট্রিক কী বোঝায়

- **Egress (1.93/5 GB):** Database/API, Auth, Storage, Realtime, Edge Functions এবং log drain-সহ বিভিন্ন Supabase service থেকে client-এর দিকে পাঠানো নেটওয়ার্ক ডেটা। শুধু database-এর 32 MB storage size দিয়ে Egress হিসাব বোঝা যায় না।
- **Database size (32/500 MB):** database storage consumption; এটি network transfer বা log volume নয়।
- **Monthly active users (9/50,000):** active-user usage metric; অল্প ব্যবহারকারী হলেও request loop থাকলে service usage অনেক হতে পারে।
- **File storage (0/1 GB):** stored files-এর consumption; screenshot-এ এটি বর্তমান প্রধান quota pressure নয়।
- **Log Ingestion (2.20/1 GB):** বর্তমান billing cycle-এ Supabase-এর সব service থেকে ingest হওয়া log data। API/Postgres/Auth/Realtime/Storage/Edge Functions-এর কোন source বেশি log দিচ্ছে, তা Logs Explorer-এ যাচাই করতে হবে।
- **Log Query (19.4/100 GB):** Logs UI, Management API, CLI বা অন্য interface দিয়ে log পড়ার সময় মোট যত log data scan হয়েছে। এটি database query-তে পড়া data-এর পরিমাণ নয়, এবং frontend code বদলালে এই counter আগের মতো বা সঙ্গে সঙ্গে কমে যাবে না।

Supabase-এর বর্তমান নথি: [Manage Logs usage](https://supabase.com/docs/guides/platform/manage-your-usage/logs), [Manage Logs Ingest](https://supabase.com/docs/guides/platform/manage-your-usage/logs-ingest), [Manage Logs Query](https://supabase.com/docs/guides/platform/manage-your-usage/logs-query), [Manage Egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress)। Usage page default-এ একাধিক project-এর total দেখাতে পারে; একটি নির্দিষ্ট project নির্বাচন করে তারিখসীমা মিলিয়ে দেখতে হবে।

## Live Supabase-এ অবশ্যই যে যাচাই করতে হবে

1. Supabase Dashboard → Usage-এ project selector সঠিক project-এ সেট করুন। Date range-এ last 24 hours এবং current billing cycle আলাদাভাবে দেখুন। Screenshot-এর “Current billing cycle” শুধু দেখে এক দিনের হিসাব বলে ধরে নেবেন না।
2. Logs/Explorer-এ আগে ছোট সময়সীমা (যেমন শেষ 10–15 মিনিট) বাছুন। API Gateway events-এ সবচেয়ে বেশি repeat হওয়া path/status এবং Postgres logs-এ একই error বারবার হচ্ছে কি না দেখুন। Auth, Storage, Realtime, Edge Functions category-ও পরীক্ষা করুন।
3. `PGRST202`, `PGRST203`, `42883`-এর মতো missing/ambiguous RPC error থাকলে, ওই function/signature deployment-এ অনুপস্থিত বা schema cache-এ নেই কি না যাচাই করুন। নতুন কোড একই browser tab-এ একই অনুপস্থিত compatibility RPC বারবার চেষ্টা করবে না; তবে প্রথম probe এবং অন্য browser/session-এর probe থাকবে।
4. Postgres logs-এ `Hostel Life archive audit could not write` বারবার থাকলে archive-audit trigger-এর underlying error ঠিক করুন। `Hostel Life realtime table ... could not be added` থাকলে Realtime publication/table configuration যাচাই করুন। Audit warning নির্বিচারে বন্ধ করবেন না—তাহলে audit failure আড়াল হবে।
5. **Log Query কমানোর জন্য** Logs UI-তে প্রতিবার বড় সময়সীমা দিয়ে একই query বারবার চালাবেন না। ছোট সময়সীমা ও সুনির্দিষ্ট filters ব্যবহার করুন। Supabase-এর বর্তমান নথিতে Log Query-কে সরাসরি billed নয়, usage allowance হিসেবে ব্যাখ্যা করা হয়েছে; enforcement/grace-period-এর বর্তমান অবস্থা অফিসিয়াল নথিতে মিলিয়ে নিন।
6. Egress-এর জন্য Usage/custom reports-এ Database API, Auth, Storage ও Realtime egress আলাদা করে দেখুন। API Gateway logs সবচেয়ে বেশি requested path চিহ্নিত করতে সাহায্য করে, তবে এগুলোতে response bytes নাও থাকতে পারে; তাই শুধুমাত্র log row count থেকে Egress-এর সঠিক উৎস নিশ্চিত করবেন না।

## কীভাবে যাচাই ও deploy করবেন

1. বর্তমান live project ও database-এর backup রাখুন। এই প্যাকেজ extract করে নতুন folder-এ পরীক্ষা করুন; পুরোনো folder-এর উপর সরাসরি overwrite করবেন না।
2. আগের প্রকল্পের `.env.local` নিরাপদে কপি করুন। ZIP-এ কোনো live secret থাকার কথা নয়; `.env.example` শুধু placeholder।
3. Node.js `package.json`-এর `>=20.19.0` শর্ত পূরণ করে চালান:

   ```bash
   npm ci
   npm test
   npm run build
   ```

4. সব command সফল হলে hosting-এ deploy করুন। Browser DevTools → Network-এ একই RPC/path ঘন ঘন পুনরাবৃত্ত হচ্ছে কি না দেখুন এবং Supabase Usage/Logs-এর একই time window deploy-এর আগে/পরে তুলনা করুন। অন্তত 24–48 ঘণ্টা বা যথেষ্ট প্রকৃত ব্যবহারের পর trend বিচার করুন।

## যাচাইয়ের সীমা

এই প্যাকেজ তৈরির সময় production Supabase credentials বা live Logs Explorer access ছিল না। তাই কোন service বাস্তবে 2.20 GB log ingest করেছে, কোন endpoint Egress-এর কত অংশ তৈরি করেছে, বা আগের usage counter-এর সঠিক সময়সীমা—কোড থেকে একা নিশ্চিত করা যায় না। `npm ci` এই পরিবেশে npm-এর অভ্যন্তরীণ `Exit handler never called` error-এ ব্যর্থ হয়েছে; Vite executable না থাকায় `npm run build` চালানো যায়নি। তবে `npm test` সফল হয়েছে: ৩টি test passed, ০ failed। TypeScript parser দিয়ে ৫২টি JavaScript/JSX file-এর syntax পরীক্ষা এবং relative import resolution check—দুটিই pass করেছে। Dependency install করে নিজের পরিবেশে `npm run build` চালিয়ে final confirmation করতে হবে।
