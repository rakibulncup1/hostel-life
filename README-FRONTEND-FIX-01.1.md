# Hostel Life — Frontend Fix 01.1

এই patchটি `Hostel-Life-Frontend-Fix-01.zip`-এর উপর একটি ছোট targeted follow-up।

## কেন

`Hostel-Life-Dashboard-Repair-V2.1`-এর `get_offline_meal_bundle()` RPC এখন প্রতিটি snapshot-এর `member_details` server-side `snapshot_payload` থেকেই দেয়। আগের frontend offline sync আবার `get_meal_details(date)` দুইবার কল করে সেই data overwrite করছিল।

## কী পরিবর্তন

শুধু `src/hooks/useMealOffline.js`-এ offline sync path এখন `fetchOfflineMealBundle()`-এর ফল সরাসরি IndexedDB-তে cache করে। কোনো অতিরিক্ত per-date detail RPC আর sync-এর সময় চলে না।

Dashboard-এ user নিজে Meal Card-এর details খুললে `get_meal_details(date)` call আগের মতোই থাকবে। এটি পরিবর্তন করা হয়নি।

## Database impact

কোনো SQL/migration পরিবর্তন নেই। Repair V2.0.2, Dashboard Repair V2.1, RLS, month lifecycle, accounting বা existing database data পরিবর্তন করা হয়নি।

## Verification

- relative JS/JSX imports resolve কিনা static check
- Node syntax check for all `.js` files
- `useMealOffline.js` আর `fetchMealDetails` import/call করে না
- Dashboard detail flow এখনও `fetchMealDetails` ব্যবহার করে
- packaged ZIP integrity check
- package-এ `.env.local`, `node_modules` বা secret runtime files নেই

পূর্ণ `npm run build` এই environment-এ করা যায়নি কারণ npm registry/dependency download available ছিল না।
