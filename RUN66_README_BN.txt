HOSTEL LIFE — RUN66 PATCH
Dashboard, Exception Editor, Help Layout & Light Theme Rollout

এই প্যাচটি Run65-এর পরের Run66 refinement। এটি Run64/Run65-এর উপর তৈরি বর্তমান প্রজেক্টের জন্য। পূর্ণ প্রজেক্ট ZIP নয়; শুধু পরিবর্তিত ফাইল আছে।

যে পরিবর্তনগুলো আছে
1. নতুন মিল অনুরোধের বারভিত্তিক ব্যতিক্রম Editor ছোট স্ক্রিনে আর তিনটি সরু Stepper এক সারিতে গাদাগাদি করে না; পূর্ণ-প্রস্থে আলাদা সারিতে দেখায়। Save/Cancel ও weekday selection logic অপরিবর্তিত।
2. Dashboard-এর Today Meal detail ও Late Request detail-এর উপরের summary tiles-কে নিচের member/detail card-এর একই side inset-এ আনা হয়েছে। Upcoming seven-day card-এর বিদ্যমান container padding বজায় রাখা হয়েছে, অতিরিক্ত double padding নেই।
3. How-to Use পেজের চারটি সময়-কার্ডে যথাযথ gap, line-height, wrapping ও responsive 4/2-column grid দেওয়া হয়েছে। লেখা একে অপরের উপর পড়ে না।
4. Light হলো rollout default। ব্রাউজারে আগের theme preference থাকলেও Run66-এর marker প্রথমবার না থাকলে একবার Light-এ বদলাবে। এরপর ব্যক্তিগত Theme chooser দিয়ে পছন্দ বদলালে সেটি সংরক্ষিত থাকবে এবং পরবর্তী app load-এ আর overwrite হবে না।
5. Super Admin-এর global Default Theme tab ও save control সরানো হয়েছে। সদস্যরা Profile এবং Entry Theme Switcher থেকে নিজের পছন্দের Light/System/Dark/Blue বেছে নিতে পারবেন।
6. ছোট SQL migration platform_settings.default_theme-এর server default ও existing singleton setting Light করে এবং পুরোনো global theme setter RPC থেকে PUBLIC/anon/authenticated EXECUTE permission সরায়। অন্য কোনো table, account, membership, meal বা finance data পরিবর্তন করে না।

ইনস্টল করার আগে
- বর্তমান Project ZIP এবং Supabase database backup রাখুন।
- নিশ্চিত করুন আপনার প্রজেক্টে Run49, Run63, Run64 ও Run65-এর কার্যকর পরিবর্তনগুলো আগে থেকেই আছে।
- ZIP-এর ভিতরের path ধরে Project Root-এ ফাইলগুলো Replace করুন।
- Frontend build/test এবং deploy করুন।
- Deploy হওয়ার পরে Supabase SQL Editor-এ supabase/migrations/Run66_light_default_theme_rollout.sql একবার চালান। Migration আবার চালাবেন না।
- এরপর supabase/verify/Verify_Run66_light_default_theme_rollout.sql চালিয়ে যাচাই করুন:
  column_default = 'light'
  default_theme = 'light'
  authenticated_can_set_global_theme = false
  anon_can_set_global_theme = false

Theme rollout কীভাবে কাজ করে
- প্রথমবার Run66 code লোড হলে localStorage rollout marker পরীক্ষা হয়। Marker না থাকলে সেই browser/device-এর পুরোনো preference একবার Light হয় এবং marker সেট হয়।
- পরবর্তীতে user Profile বা Entry Theme Switcher থেকে নিজের theme বেছে নিলে তা রাখা হবে; প্রতি login বা reload-এ Light চাপিয়ে দেওয়া হবে না।
- fresh browser/device-এ কোনো saved preference না থাকলে default Light হবে।
- বর্তমান app-এর theme preference browser/device-local; এই migration এটিকে server-side account profile-এ রূপান্তর করে না।

পরীক্ষা
- Run66 focused tests: 7/7 passed.
- Full Node test suite: 834/844 passed. বাকি 10টি ব্যর্থ test pristine Run65 baseline-এও একইভাবে ব্যর্থ হয়েছে; Run66 নতুন failure যোগ করেনি।
- Browser localStorage simulation: legacy Dark -> first load Light; later user-selected Blue -> subsequent load Blue.
- Vite production build এই কাজের environment-এ চালানো যায়নি, কারণ project-এর node_modules/Vite dependency ইনস্টল করা নেই। Deploy-এর আগে আপনার পরিবেশে npm run build চালান।

এই প্যাচে নতুন Meal Mode, Notification, Telegram, join, approval, finance বা meal accounting logic পরিবর্তন করা হয়নি।
