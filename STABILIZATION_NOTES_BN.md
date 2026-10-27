# Hostel Life — Stabilization and outstanding backend dependencies

এই সংস্করণের ভিত্তি: Hostel_Life_Archive_UI_Stabilization.zip। আগের পরিবর্তনগুলো বজায় রেখে নিচের সংশোধন যোগ করা হয়েছে।

## পরিবর্তন
- Daily meal card: তিন বেলার গণনা ঠিক থাকা সত্ত্বেও RPC-তে `total` শূন্য বা অসামঞ্জস্যপূর্ণ হলে কার্ডে তিন বেলার যোগফল দেখানো হয়। শুধু প্রদর্শন স্তরে; মাসিক হিসাব/রেকর্ড পরিবর্তন হয় না।
- খালার টাকার এন্ট্রি: `manager_add_khala_money_for_period` RPC-র বিদ্যমান `p_member_id` প্যারামিটার অনুযায়ী সক্রিয় সদস্য নির্বাচন বাধ্যতামূলক করা হয়েছে। তালিকা না এলে কোনো অনুমানভিত্তিক এন্ট্রি হবে না। `memberId` একটি membership UUID, payment creator-এর পরিচয়ের সমান নয়।
- ম্যানেজার পরিবর্তন: UI-তে চলমান মাস ছাড়া বিদ্যমান change_manager RPC-র সীমাবদ্ধতা জানানো হয়েছে; কোনো client-side permission bypass করা হয়নি।
- Super Admin মোবাইল স্ক্রিন: নেভিগেশন, typography, touch targets, cards/layout পরিমার্জন।

## এখনো Backend/Integration-এর কাজ
- মাস বন্ধ থাকা অবস্থায় `change_manager` এখনও মূল SQL-এ চলমান মাস চায়। নতুন **যাচাই করা incremental SQL** দরকার। শুধু UI দিয়ে সমাধান সম্ভব নয়।
- মাস বন্ধ করে পুনরায় চালুর পর রাত ১০টার পরও 'আজকের মিল' দেখানো ও পরদিনের late request-এ date range error: period end_date এবং `get_dashboard_data`, late-meal eligibility RPC-র কার্যকরী ফলাফল পরীক্ষা না করে client-side পরিবর্তন করা হয়নি। কোনো রেকর্ডের তারিখ স্বয়ংক্রিয়ভাবে বাড়ানো হয়নি।
- Dashboard card total display এখন UI-তে হিসাব সামঞ্জস্যপূর্ণ; প্রকৃত server snapshot/summary.total_meals বদলায়নি।
- Production build চালানোর চেষ্টা ব্যর্থ: environment-এ `vite` executable নেই। Automated suite ২৯/২৯ পাস; live Supabase বা visual browser test হয়নি।

## পরীক্ষা
- তিন বেলার সংখ্যা (যেমন 1,0,2) এবং total=0 হলে কার্ডে 3 দেখাবে কিনা;
- খালার টাকার সদস্য নির্বাচন করে নতুন এন্ট্রি ও পুরোনো history অক্ষত;
- ম্যানেজার পরিবর্তন চলমান মাসে আগের মতো কাজ করে কিনা;
- Super Admin মোবাইল 320/375/430 px-এ আকার।

এই সংস্করণে কোনো SQL পরিবর্তন বা record deletion নেই। Production backup ও preview test বজায় রাখুন।
