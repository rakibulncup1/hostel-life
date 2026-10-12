# Hostel Life — এই ডেলিভারির নির্দেশনা

এই প্যাকেজে তোমার বর্তমান প্রজেক্টের সোর্স, History manager-edit repair, Dashboard current-period state fix এবং Super Admin panel আছে।

## এই তিনটি কাজ

1. **History editing:** History-এর market edit/void এবং deposit/other-expense adjustment UI আগের RPC ব্যবহার করে। `supabase/HOSTEL_LIFE_FIX_HISTORY_MANAGER_EDITS_AND_RUNNING_PERIOD_V1.sql` শুধু `private.can_manage_period(uuid)`-এর active-manager permission path সংশোধন করে এবং বিদ্যমান RPC execute grants যাচাই করে। এটি `manager_adjust_transaction` DROP/CREATE করে না, তাই আগের `42P13` return-type সমস্যাটি এড়ায়।
2. **“মাস শুরু হয়নি” false banner:** Dashboard-এর পুরোনো RPC যদি `has_running_period=false` পাঠায়, code এখন canonical running-period lookup করে; lookup ব্যর্থ হলে “মাস নেই” বলে নিশ্চিত না হয়ে যাচাই-ত্রুটি দেখায়। `monthly_periods` realtime change এলে canonical lookup force করা হয়।
3. **Super Admin:** `/super-admin` UI, password re-authentication, database role enforcement, hostel/user overview, limited member list, suspend/soft-delete, user block, global announcement, developer info এবং gated registration/hostel-creation code UI অন্তর্ভুক্ত। Backend SQL: `supabase/HOSTEL_LIFE_SUPER_ADMIN_PHASE2_V1.sql`. এই Phase 2 migration-এর header অনুযায়ী `HOSTEL_LIFE_CORE_USAGE_AND_FEATURE_FIXES_V1.sql` prerequisite; সেটি আগে থেকেই সফলভাবে apply করা থাকলে আবার চালিও না।

## SQL চালানোর নিরাপদ ক্রম

1. Supabase backup নাও।
2. আগে শুধু `supabase/HOSTEL_LIFE_FIX_HISTORY_MANAGER_EDITS_AND_RUNNING_PERIOD_V1.sql` চালাও। এর শেষে verification rows-এ `OK` আশা করা হচ্ছে। এই SQL-এর জন্য `manager_adjust_transaction`-এর return type বদলানো বা function drop করার দরকার নেই।
3. Super Admin backend এখনো apply না হয়ে থাকলে `supabase/HOSTEL_LIFE_SUPER_ADMIN_PHASE2_V1.sql` চালাও। এটি base Hostel Life schema ও `public.profiles.role`-এর ওপর নির্ভরশীল; audit snapshot-এ `profiles.role` text/default `user` হিসেবে ছিল। আগে সফলভাবে Super Admin Phase 2 চালিয়ে থাকলে আবার চালানোর আগে verification করো।
4. Super Admin account setup শেষ করতে Supabase SQL Editor-এ নিজের authenticated user UUID দিয়ে আলাদা করে চালাও: `UPDATE public.profiles SET role = 'super_admin' WHERE id = '<YOUR_AUTH_USER_UUID>' RETURNING id, role;`. ঠিক একটি row ফেরত এসেছে নিশ্চিত করো। এটি কেবল Project Owner SQL Editor থেকে করবে; কোনো অ্যাপ ফর্মে role সেট করা যাবে না।
5. ZIP Extract করে নিজের `.env.local` নিরাপদে ফিরিয়ে দাও। তারপর `npm ci`, `npm test`, `npm run build` চালিয়ে deploy করো।

## খুব গুরুত্বপূর্ণ

- শুধু এই তিনটি কাজের জন্য `supabase/HOSTEL_LIFE_FINAL_MIGRATION_ALL_IN_ONE.sql` বা আগের 86 KB all-in-one migration চালাবে না। ওই বড় migration-এ `manager_adjust_transaction`-এর return-type conflict আগেই দেখা গিয়েছিল।
- Archive/closed period-এর edit authorization এই targeted patch-এ নতুন করে খোলা হয়নি; এর জন্য বর্তমান `archive_edit_permissions` workflow ব্যবহার হবে।
- Super Admin UI/SQL আছে, কিন্তু live Supabase-এ apply করে test করা হয়নি। Production-এ নিরাপত্তা যাচাই আবশ্যক।
- `npm test`: 10/10 passed. Dependency install/build এই environment-এ npm transport timeout-এর কারণে verify করা যায়নি।
- `.env.local`, service-role key, DB password, access token ZIP-এ দিও না।
