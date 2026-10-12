# Hostel Life — History edit ও Current Month fix

এই patch শুধু দুটি সমস্যার জন্য:

1. ম্যানেজার History-তে বাজার, ডিপোজিট ও অন্যান্য খরচ edit/void করতে গিয়ে অনুমতি-সংক্রান্ত error পেলে backend period authorization ঠিক করা।
2. `get_running_period_context` error বা পুরোনো/অপ্রত্যাশিত JSON shape দিলে UI যেন সেটিকে নিশ্চিতভাবে “বর্তমানে কোনো চলমান মাস নেই” না বলে। Frontend এখন RLS-সুরক্ষিত `monthly_periods` table থেকে read-only fallback করে; fallback-ও ব্যর্থ হলে error দেখায়।

## পরিবর্তন

- SQL helper `private.can_manage_period(uuid)` একই মেসের সক্রিয় `role='manager'`-কে running period-এর edit authorization দেয়, এমনকি legacy `primary_manager_membership_id` stale/NULL থাকলেও। Assistant manager-এর existing period assignment থাকে।
- Archived period-এর অনুমতি-নীতি **পরিবর্তন করা হয়নি**: close manager বা বৈধ explicit archive edit permission প্রয়োজন।
- কোনো পুরোনো ledger row delete/overwrite করা হয় না; existing adjustment RPC-ই ব্যবহার হয়। `manager_adjust_transaction` drop/recreate করা হয় না।
- Dining/History period loader error হলে false no-month message দেখানো হবে না। সফলভাবে কোনো running period না পাওয়া গেলেই no-month message দেখাবে।

## ইনস্টল

1. পুরোনো SQL আবার চালাবে না। এই প্যাকেটের `supabase/HOSTEL_LIFE_FIX_HISTORY_MANAGER_EDITS_AND_RUNNING_PERIOD_V1.sql` চালাও।
2. SQL-এ post-migration checks `OK` হওয়া উচিত।
3. নতুন ZIP থেকে deploy/build করার আগে নিজের `.env.local` যোগ করবে; ZIP-এ secrets রাখা হয়নি।
4. `npm ci`, `npm test`, `npm run build` চালাও।
5. ম্যানেজার অ্যাকাউন্টে লগইন করে Dining খুলে দেখো: মাসের তথ্য পাওয়া গেলে “বর্তমানে কোনো চলমান মাস নেই” দেখানোর কথা নয়। সত্যিই running month না থাকলে, no-month message দেখানো সঠিক।
6. History → বাজার ইতিহাস → একটি active market → বিস্তারিত → সম্পাদনা; তারপর History → হিসাব ইতিহাস → একটি `deposit` বা `other_expense` row → বিস্তারিত → সম্পাদনা পরীক্ষা করো। সামান্য test edit করে আবার আসল পরিমাণে adjustment করে দাও, যদি production record-এ পরীক্ষা করতে হয়।

## সীমাবদ্ধতা

Archived period-এ button অনুপস্থিত থাকলে তা archive permission rules-এর কারণে হতে পারে; এই patch ইচ্ছাকৃতভাবে সেই policy bypass করে না। Production Supabase-এ চালানো/বাস্তব UI test করা হয়নি, কারণ live project credentials নেই। SQL Editor-এর postgres owner context-এ `auth.uid()` শূন্য হতে পারে; তাই actual manager permission test অ্যাপের authenticated manager account থেকেই করতে হবে।
