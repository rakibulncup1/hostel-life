RUN67 — ব্যবহার নির্দেশিকা (বাংলা)

এই প্যাচটি Run66-এর ওপর বসানোর জন্য তৈরি। Run49/Run63/Run64/Run65/Run66-এর আগের পরিবর্তনগুলো ইতিমধ্যে থাকা বর্তমান Project-এ শুধু এই প্যাচের ফাইলগুলো Replace করবে। পুরোনো প্যাচগুলো আবার আলাদাভাবে বসাবে না।

যা পরিবর্তন হয়েছে
1. মেনু → কীভাবে ব্যবহার করব: সময় মনে রাখুন শিরোনাম এবং চারটি সময়ের কার্ডের মধ্যে ফাঁকা জায়গা, বিভাজন, কার্ডের padding ও responsive layout উন্নত।
2. Telegram সংযোগ: শিরোনামের নিচের পুনরাবৃত্ত ব্যাখ্যামূলক লাইন সরানো হয়েছে। Desktop-এ দুই কলামের পরিষ্কার বিন্যাস; মোবাইলে আগের compact single-column অভিজ্ঞতা রাখা হয়েছে। সংযোগ/বিচ্ছিন্ন/যাচাইয়ের business logic অপরিবর্তিত।
3. Join Code: দৃশ্যমান duplicate “যোগদানের কোড” label সরানো হয়েছে; placeholder এবং screen-reader accessible label অক্ষুণ্ন।
4. Invitation link: public invite route এখন authentication loading/login gate-এর আগে render হয়, ফলে WhatsApp/অন্যান্য in-app browser-এ invite page-এর branded light loading shell দেখা যায়। Token validation এবং join request এখনও আগের authenticated server-side RPC/manager approval flow ব্যবহার করে।
5. Initial theme color: HTML first-paint এবং PWA manifest light surface ব্যবহার করে; user পরে অন্য theme বেছে নিলে browser toolbar meta তার থিম অনুযায়ী বদলায়।
6. Service worker shell cache v20 করা হয়েছে, যাতে আগের installed app shell-এর cached index/manifest আপডেট হয়।

ইনস্টল করার ধাপ
1. বর্তমান Run66 Project-এর সম্পূর্ণ backup নাও।
2. ZIP-এর ফাইলগুলো Project Root-এ একই path অনুযায়ী replace করো।
3. কোনো Supabase SQL migration চালাতে হবে না।
4. `npm test` চালাও।
5. `npm run build` সফল হলে deploy করো।
6. Deploy-এর পরে নতুন invitation link একটি incognito browser বা WhatsApp in-app browser-এ পরীক্ষা করো। পুরোনো WhatsApp link preview cache করা থাকতে পারে; preview thumbnail refresh হওয়া এবং লিংক খুললে page theme সঠিক দেখা—দুটি আলাদা বিষয়।

যাচাই
- Run67 targeted regression tests: 6/6 passed.
- Run65 entry-window regression tests: 6/6 passed.
- Full suite: 850 tests; 840 passed, 10 known baseline failures.
- একই Run66 baseline full suite-এও ওই একই 10 test fail করেছিল; Run67 কোনো নতুন failure যোগ করেনি।
- Vite Production Build এই পরিবেশে চালানো যায়নি, কারণ project archive-এ node_modules নেই এবং Vite executable পাওয়া যায়নি। Deploy-এর আগে নিজের environment-এ `npm run build` চালানো আবশ্যক।

সতর্কতা
- এই প্যাচে কোনো SQL file নেই এবং কোনো database schema/data পরিবর্তন নেই।
- Telegram token, invitation token, server-side approval, membership checks বা existing business RPC পরিবর্তন করা হয়নি।
