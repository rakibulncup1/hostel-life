# Hostel Life — Background Sync / Supabase Log Ingestion Optimization V1

## উদ্দেশ্য

অ্যাপের background polling ও duplicate RPC request কমানো, hidden/unfocused tab থেকে automatic sync বন্ধ রাখা, এবং offline cache অক্ষত রাখা। এই প্যাকে কোনো database schema/function পরিবর্তন বা SQL migration নেই।

## কোডে পাওয়া প্রধান সমস্যা

`src/features/dashboard/DashboardPage.jsx`-এ dashboard load সফল হওয়ার পরে `syncOfflineSnapshot(normalized)` IndexedDB snapshot লিখে React state আপডেট করত। একই সঙ্গে dashboard loading effect-এর dependency তালিকায় `cachedDashboard` ছিল। ফলে cache snapshot বদলালেই effect আবার `loadDashboard()` চালাত। প্রতিটি load-এ dashboard RPC, running-period RPC, member-directory RPC এবং offline meal bundle RPC চলতে পারত। একই cache update আবার effect trigger করতে পারত—এটি অপ্রয়োজনীয় API call/log volume-এর সবচেয়ে গুরুত্বপূর্ণ সম্ভাব্য loop ছিল।

এর পাশাপাশি Dashboard ১০ মিনিট অন্তর polling করত; notification badge, All Members এবং manager request inbox ৫ মিনিট অন্তর polling করত। Focus ও `visibilitychange` event একই সময়ে আসতে পারায় একই query একাধিকবার চালু হতে পারত। Realtime channel hidden/offline অবস্থাতেও খোলা থাকত। Service worker cached asset ফেরত দেওয়ার পাশাপাশি background-এ সেগুলো আবার fetch করত।

## কী পরিবর্তন হয়েছে

1. Dashboard effect-এ `cachedDashboard` dependency থেকে network-fetch trigger সরানো হয়েছে। Offline cache hydration এখন local-only; cache update নতুন dashboard RPC শুরু করে না।
2. Dashboard initial load-এ প্রয়োজনীয় fallback-safe reads রাখে। পরের realtime refresh-এ প্রথমে শুধু `get_dashboard_data` RPC চলে; response-এ period/member structure না থাকলে তবেই period ও directory fallback queries চলে।
3. একই Dashboard request চলাকালীন নতুন load হলে in-flight promise reuse হয়। Automatic realtime/focus refresh ১৫ সেকেন্ডের মধ্যে সীমিত; স্পষ্ট retry button ব্যবহারকারীকে আবার চেষ্টা করতে দেয়।
4. Offline dashboard sync আর নিজে থেকে dashboard RPC করে না। Page ইতিমধ্যে পড়া dashboard data-ই cache-এ লিখে। Meal bundle আগের cache থেকে ধরে রাখা হয়; initial/resume/meal-related changes-এ refresh হয়। নতুন bundle fetch ব্যর্থ হলেও ভালো পুরোনো bundle নষ্ট হয় না।
5. Realtime refresh একাধিক row event-কে একত্র করে; প্রতি active page-এ automatic table-event refresh সর্বোচ্চ একবার/১৫ সেকেন্ড। Channel শুধু browser tab visible, window focused এবং online থাকলে subscribe থাকে। Hidden/blur/offline হলে channel সরানো হয়; ফিরে এলে একটি resume refresh হয়।
6. Notification badge, All Members এবং Manager Meal Requests থেকে ৫ মিনিটের polling সরানো হয়েছে। এগুলো page entry, active/resume এবং bounded realtime event-এ refresh হয়। একই সময়ে চলমান load in-flight guard দিয়ে coalesce হয়।
7. Supabase Auth-এর `TOKEN_REFRESHED` event থেকে profile/membership/role-এর তিনটি RPC আবার চালানো বন্ধ হয়েছে; token refresh নিজে identity data বদলায় না। Initial session state একই user হলে অপ্রয়োজনীয় React session update-ও এড়ানো হয়েছে।
8. Service worker cached, content-hashed assets ফেরত দেওয়ার সময় তাদের background re-fetch করে না। HTML user-এর প্রকৃত navigation-এ network-first থাকে, offline হলে cached HTML দেয়।
9. Background refresh failure-এ বারবার `console.warn` লেখার কিছু পথ সরানো হয়েছে। Console log নিজে Supabase database log ingestion নয়; মূল লক্ষ্য ছিল পুনরাবৃত্ত API/RPC traffic কমানো।

## পরিবর্তিত ফাইল

- `src/features/dashboard/DashboardPage.jsx`
- `src/hooks/useDashboardOffline.js`
- `src/hooks/useRealtimeRefresh.js`
- `src/hooks/useMealOffline.js`
- `src/app/AppShell.jsx`
- `src/features/menu/MenuPages.jsx`
- `src/features/dining/DiningPage.jsx`
- `src/hooks/useManagementContext.js`
- `src/contexts/AuthContext.jsx`
- `public/service-worker.js`

## SQL / Supabase Dashboard পরিবর্তন

এই প্যাকে **কোনো SQL চালাতে হবে না**। কোনো table, RPC, trigger, RLS policy, permission বা live data পরিবর্তন করা হয়নি।

## প্রয়োগ করার ধাপ

1. বর্তমান project folder ও deployment-এর backup রাখুন।
2. ZIP আলাদা folder-এ extract করুন; পুরোনো `.env.local` নিরাপদে নিজের project-এ রাখুন। ZIP-এর `.env.example` credentials নয়।
3. Node.js `package.json`-এ নির্ধারিত version requirement পূরণ করছে নিশ্চিত করুন।
4. `npm ci` চালিয়ে dependency install করুন, এরপর `npm run build` চালান।
5. Build সফল হলে hosting-এ deploy করুন। Service worker cache version `v10`; প্রথম online navigation-এ নতুন HTML/worker update হবে।
6. Production-এ browser-এর Network panel ও Supabase Logs ব্যবহার করে request rate এবং log ingestion তুলনা করুন।

## যাচাইয়ের সীমাবদ্ধতা

এই পরিবেশে `src`-এর ৪৯টি JavaScript/JSX ফাইল এবং service worker-সহ মোট ৫০টি JavaScript/JSX ফাইল syntax-parse করা হয়েছে (০ syntax error) এবং relative import paths-এর static check-এ unresolved import পাওয়া যায়নি। `npm run build` চেষ্টা করা হয়েছে, কিন্তু এই working environment-এ `vite` executable / `node_modules` অনুপস্থিত থাকায় build শুরুই হয়নি। Live Supabase-এ কোনো request চালানো বা log-volume reduction পরিমাপ করা হয়নি।

কোডের পরিবর্তন future traffic কমানোর উদ্দেশ্যে করা হয়েছে; এটি আগের Log Ingestion usage মুছে দেয় না এবং নির্দিষ্ট GB reduction-এর নিশ্চয়তা দেয় না। Deploy-এর পর Supabase Logs-এ অন্তত ৩০–৬০ মিনিট পর্যবেক্ষণ করুন। যদি log ingestion এখনও অস্বাভাবিকভাবে বাড়ে, একই সময়সীমার API/Postgres log category এবং top request pattern দেখে পরবর্তী targeted investigation করতে হবে।
