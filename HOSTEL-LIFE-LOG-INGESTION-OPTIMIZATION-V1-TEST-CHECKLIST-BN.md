# Hostel Life — Log Ingestion Optimization V1 Test Checklist

## Deploy-এর আগে

- [ ] বর্তমান source ZIP ও live database-এর backup রাখা হয়েছে। এই package-এ SQL migration নেই; Supabase SQL Editor-এ কিছু চালাতে হবে না।
- [ ] নিজের `.env.local` / hosting environment variables অক্ষত আছে।
- [ ] `npm ci` সফল হয়েছে এবং `npm run build` সফল হয়েছে (এই পরিবেশে build যাচাই করা যায়নি)।

## Browser / functional tests

- [ ] লগইন করে Dashboard খোলা: প্রাথমিক dashboard/member/period তথ্য একবার লোড হয়; IndexedDB snapshot update হওয়ার কারণে বারবার dashboard RPC চলতে থাকে না।
- [ ] Browser DevTools → Network → Fetch/XHR: Dashboard খোলা রেখে ১০ মিনিট কোনো database change না হলে periodic dashboard/notification/member/request polling দেখা যায় না।
- [ ] Console-এ repeated “Dashboard load failed” বা realtime error spam দেখা যায় না।
- [ ] নতুন market/meal/notification/period change হলে active focused tab-এ realtime update আসে; burst event একসঙ্গে coalesce হয় এবং realtime refresh rate ১৫ সেকেন্ডে সীমিত থাকে।
- [ ] Browser tab বদলালে বা অন্য app-এ গেলে Realtime channel unsubscribe হয়; একই tab-এ ফিরে এলে একটি resume refresh হয়।
- [ ] Internet বন্ধ করলে automatic RPC/realtime sync থামে; আবার internet চালু করে app-এ ফিরলে page data পুনরায় লোড হয়।
- [ ] Dashboard offline cache এখনও দেখা যায়; offline meal bundle fetch সাময়িকভাবে ব্যর্থ হলেও পূর্বের cached bundle হারায় না।
- [ ] Manager Meal Requests page-এ tab পরিবর্তন করলে সঠিক request list লোড হয়; review/approve/reject-এর পর list update হয়।
- [ ] All Members page-এ member list/period সঠিক থাকে; member update হলে realtime refresh কাজ করে।
- [ ] Notification badge initial count এবং নতুন notification / seen state-এর পরে update হয়; notification panel খুললে তালিকা দেখা যায় এবং manual refresh কাজ করে।
- [ ] PWA/service worker নতুন `hostel-life-shell-v10` cache ব্যবহার করছে; online navigation-এ নতুন HTML পাওয়া যাচ্ছে, offline navigation-এ cached shell দেখা যাচ্ছে।

## Supabase logs / traffic পর্যবেক্ষণ

- [ ] Deploy-এর পর একই ধরনের সময়সীমা (কমপক্ষে ৩০–৬০ মিনিট) ধরে আগের তুলনায় API/Database log request volume তুলনা করা হয়েছে।
- [ ] Log Explorer-এ সবচেয়ে বেশি দেখা RPC/endpoint শনাক্ত করা হয়েছে, যদি usage এখনও বেশি থাকে।
- [ ] Historical log ingestion ব্যবহার স্বয়ংক্রিয়ভাবে কমে যাবে—এমন প্রত্যাশা করা হয়নি; নতুন traffic কমে কি না তা আলাদা করে দেখা হয়েছে।

## সীমাবদ্ধতা

এই checklist-এ থাকা বাস্তব browser এবং Supabase checks ব্যবহারকারীর deployment-এ করতে হবে। Static syntax/import checks সফল হলেও production build ও live request rate এখানে যাচাই করা হয়নি।
