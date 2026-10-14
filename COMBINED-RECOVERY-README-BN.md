# Hostel Life — Combined Frontend Recovery (13 অক্টোবর ২০২৬)

## কোন দুই সংস্করণ কীভাবে মিলানো হয়েছে

এই প্যাকেজের মূল ভিত্তি হলো `hostel-life Vercel Deploy.zip`, কারণ ওই সংস্করণে বাজার ইতিহাসের এডিট/ভয়েড UI, RPC compatibility, session-aware request cache, এবং archive permission guard বেশি সম্পূর্ণ ছিল। লোকালহোস্টের ZIP থেকে মাস-সংক্রান্ত কাজের আচরণ কেন আলাদা ছিল তা মিলিয়ে প্রয়োজনীয় refresh আচরণ পুনরুদ্ধার করা হয়েছে; লোকাল সংস্করণ হুবহু বসিয়ে দেওয়া হয়নি, যাতে Vercel সংস্করণের বাজার-এন্ট্রি সংশোধন ও অন্যান্য পরবর্তী সুবিধা হারিয়ে না যায়।

## সমন্বিত পরিবর্তন

1. **মাসের নাম/চলমান মাস context:** ম্যানেজমেন্ট context-এ explicit force refresh browser focus/visibility gate-এ আটকে থাকবে না। ম্যানেজমেন্ট RPC কোনো period না দেখালে, “মাস শুরু হয়নি” বলার আগে `get_running_period_context` দিয়ে read-only cross-check করা হবে।
2. **মাস শুরু/বন্ধের পরে shared context:** New Month ও Close Month পেজ এখন একই shared `useManagementContext` refresh ব্যবহার করে, যাতে পেজের তথ্য ও অ্যাপের উপরের চলমান মাসের নাম আলাদা হয়ে না থাকে। Mutation-এর পরে একবার জোরপূর্বক context reload হয়; অপ্রয়োজনীয় duplicate reload রাখা হয়নি।
3. **ড্যাশবোর্ডের period status:** explicit retry/fresh period check visibility gate ও stale in-memory period cache এড়াতে পারে। `monthly_periods` realtime event এলে dashboard দ্রুত পুনরায় যাচাই করে।
4. **মার্কেট এডিট:** Vercel সংস্করণের period-aware manager permission logic, `manager_update_market_entry` RPC call, manager role fallback এবং archive-edit grant checks রাখা হয়েছে। এটি সাধারণ member-কে backend permission ছাড়া edit করতে দেয় না।
5. **Service worker:** shell cache version বাড়ানো হয়েছে, যাতে নতুন build পরে পুরোনো app-shell cache অবশিষ্ট না থাকে।

## গুরুত্বপূর্ণ: নতুন মেসে বাজার এডিটের ব্যর্থতা

এই ZIP কেবল ফ্রন্টএন্ডকে সমন্বিত করে; Supabase-এর কোনো function, policy, table, বা business data পরিবর্তন করে না। পুরোনো মেসে edit কাজ করলেও নতুন মেসে না করলে সেটি শুধু UI-র সমস্যা নাও হতে পারে। বর্তমান `manager_update_market_entry`-এর backend permission check-এ মেস/মাসের সঙ্গে লগইন membership, running period-এর `primary_manager_membership_id`, active manager role, অথবা period assistant link মিলে কি না তা গুরুত্বপূর্ণ।

`diagnostics/READ_ONLY_NEW_HOSTEL_MARKET_EDIT_DIAGNOSTIC_20261013.sql` শুধু metadata পড়ে—কোনো INSERT/UPDATE/DELETE/DDL নেই। নতুন মেসে এডিট করার চেষ্টা ব্যর্থ হলে আগে এই ফলাফল সংরক্ষণ করুন; **এই ZIP-এর কোনো SQL migration আবার চালাবেন না**। যদি SQL RPC নিজেই permission error দেয়, frontend merge তা নিরাপদে override করতে পারে না; তখন diagnostic output দেখে আলাদা, narrow backend fix লাগবে কি না সিদ্ধান্ত নিতে হবে।

`diagnostics/HOSTEL_LIFE_RECOVERY_READONLY_VERIFY_20261013.sql`-ও read-only verifier।

## সেটআপ

1. ZIP extract করে প্রজেক্ট ফোল্ডারে যান।
2. `.env.example` কপি করে `.env.local` বানান।
3. আপনার নিজের Supabase project-এর public URL ও publishable/anon key কেবল `.env.local`-এ রাখুন; `service_role` key কখনো frontend-এ দেবেন না।
4. `npm ci`
5. `npm test`
6. `npm run build`
7. আগে local preview/staging-এ বাজার এন্ট্রি create, edit, void, চলতি মাস label, month close, next-month start, primary/assistant manager checks যাচাই করুন। তারপর GitHub/Vercel-এ deploy করুন।

## প্রত্যাশিত যাচাই তালিকা

- [ ] চলমান মাসের label Dashboard ও Header-এ একই
- [ ] নতুন মাস শুরু করার পর Header/dashboard দ্রুত refresh হয়
- [ ] মাস বন্ধের পর stale running-month label থাকে না
- [ ] পরবর্তী মাসের required date পূর্ববর্তী মাসের বন্ধের পরের দিন
- [ ] চলমান মাসের market entry create/edit/void একই active manager দিয়ে কাজ করে
- [ ] archive market edit শুধু explicit archive-edit permission থাকলে দেখায়/অনুমোদিত হয়
- [ ] নতুন মেসে বাজার edit ব্যর্থ হলে UI permission এবং Supabase RPC error আলাদাভাবে নথিভুক্ত করা হয়
- [ ] কোনো live business row পরিবর্তন বা পুরোনো migration পুনরায় চালানো হয়নি

## সীমাবদ্ধতা

এই পরিবেশে লাইভ Supabase account-এ authenticated browser session দিয়ে end-to-end edit/month-close পরীক্ষা করা সম্ভব নয়। Test/build-এর ফলাফল README-র সাথে আলাদাভাবে জানানো হবে; কোনো যাচাই না হওয়া বিষয়কে production-fixed বলা হবে না।
