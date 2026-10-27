# Hostel Life — Module 1: Archive Correction Frontend (SQL এখনো চালানো হয়নি)

## ভিত্তি
সর্বশেষ সফলভাবে চালানো `Hostel_Life_Stabilization_Review.zip` ব্যবহার করা হয়েছে। আগের Function Hash Conflict Migration চালানোর চেষ্টা **করবেন না**।

## এখন কী বদলেছে
- `/app/menu/archive`-এ প্রধান ম্যানেজারের জন্য নতুন সরল Correction Page। পুরোনো Temporary Permission/Reopen ফর্ম বাদ গেছে। History-তে সাধারণ সদস্যের read-only access রয়ে গেছে।
- `/app/menu/archive-edit-access` পুরোনো লিংকও ম্যানেজারের জন্য নতুন পৃষ্ঠায় যায়; সাধারণ সদস্যরা History-তে যায়।
- Closed/Archived মাস নির্বাচন; তারিখ ও Status read-only। Final Meal, Market, Deposit, Other Expense, Khala বিভাগের correction form; পরিবর্তনের কারণ বাধ্যতামূলক, confirmation প্রয়োজন।
- Audit দেখানোর কাঠামো আছে। **Audit লেখা বা Notifications পাঠানো Backend RPC-র দায়িত্ব।**
- Dashboard-এর আগের frontend `getDisplayedDailyMealTotal` তিন বেলার যোগফল ব্যবহার করে; সেই tested source অপরিবর্তিত। সার্ভারের `meal_card.total` নেই—Module 2-তে server response উন্নত করতে হবে।
- Manager handover-এ আগের `change_manager` এখনো ব্যবহৃত; Module 2-তে পরিবর্তন লাগবে।

## Module 2-এর বাধ্যতামূলক Backend RPC Contract
### public.hlc_get_archive_correction_bundle(p_period_id uuid) RETURNS jsonb
উদাহরণ: `{ "period": {"id":"UUID", "status":"closed", "label":"Oct 2026", "start_date":"2026-10-01", "end_date":"2026-10-16"}, "final_meal":[{"id":"UUID", "member_name":"নাম", "meal_date":"2026-10-01", "final_breakfast":1,"final_lunch":0,"final_dinner":2}], "market":[], "deposit":[], "other_expense":[], "khala":[], "audit":[] }`।
যে প্রতিটি এন্ট্রি দেখাবে তার `id` অপরিহার্য। RLS/RPC-তে caller-কে **বর্তমান প্রধান ম্যানেজার** হিসেবে শনাক্ত এবং `p_period_id` একই hostel-এ closed/archived যাচাই করতে হবে। মাসের start/end/status কখনো বদলানো যাবে না।
### public.hlc_apply_archive_correction(p_period_id uuid, p_kind text, p_target_id uuid, p_changes jsonb, p_reason text) RETURNS jsonb
সফল ফল `{ "status": "success" }`; অন্য সব ক্ষেত্রে error।
`p_kind` = `final_meal|market|deposit|other_expense|khala`। UI field-map: `final_meal`→`final_breakfast,final_lunch,final_dinner`; `market`→`total_amount`; বাকিগুলো→`amount`। সব অঙ্ক finite, >=0; কারণ ৮–৫০০ অক্ষর। SQL-কে **old→new audit**, actor ID, timestamp, permission recheck, same-hostel & target-period ownership, locked row & atomic update, member notification, archive summary correctness গ্যারান্টি দিতে হবে। একাধিক এন্ট্রি/মাস bulk rewrite নয়। Financial adjustment-এ বিদ্যমান লেজার relationship/conventions বজায় রাখতে হবে; `other_expense`-এর signed amount বিশেষভাবে যাচাই করবেন। UI-তে পজিটিভ expense amount, DB-তে amount negative থাকলে Backend conversion এবং original display সঠিক করতে হবে।
**RPC না থাকলে UI read-only সতর্কতা দেখায়; কোনো write call যায় না।** পুরোনো reopen RPC fallback নেই।

## অবশিষ্ট কাজ/সীমাবদ্ধতা
- Module 2-তে SQL না আসা পর্যন্ত correction কাজ করবে না; এটিই উদ্দেশ্য, যাতে পুরোনো হিসাব নষ্ট না হয়।
- Ledger signed amount, market subtotal/details, Khala description, existing audit/notification schema দেখে Finance API final করতে হবে। Number inputs step=0.5 প্রদর্শন করা হয়েছে; amount/meal fractional policy SQL-এ পরীক্ষা আবশ্যক।
- `get_dashboard_data()`-এর `meal_card`-এ `total` অনুপস্থিত। আগের Frontend fallback আছে; চালু UI-তে আবার পরীক্ষা দরকার।
- `change_manager()` চলমান মাস ছাড়া কাজ করে না; এই ZIP বদলায়নি।
- Private Postgres + Supabase বাস্তবে চালানো/Build এখানে যাচাই করা যায়নি। Node tests পাস হয়েছে।

## প্রয়োগের অনুক্রম
**এই ZIP শুধু Frontend।** Module 2 SQL তৈরি/প্রয়োগের আগে Archive correction করার চেষ্টা করলে informative warning পাওয়ার কথা। আগে preview deployment-এ layout পরীক্ষা করুন। Frontend+Backend দুটোই প্রস্তুত হলে authorized manager/member tests, stale/edit conflict, closed month accounting and notification testing করুন।
