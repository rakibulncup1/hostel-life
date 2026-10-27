# Hostel Life — Module B চালানোর পর Frontend Integration Review

## ভিত্তি ও পরিবর্তনের পরিসর
সর্বশেষ Module A Stabilization ZIP-কে ভিত্তি করে কেবল Module B-তে যুক্ত Read-only RPC ব্যবহারের জন্য প্রয়োজনীয় অংশ পরিবর্তন করা হয়েছে। আগের PDF, Meal Sheet, Month Guard, Super Admin Layout এবং Edge Functions অপরিবর্তিত রাখা হয়েছে। সফলভাবে SQL চলেছে বলে ব্যবহারকারী জানিয়েছেন; এখানে লাইভ Supabase-এ পরীক্ষা করা হয়নি।

## নতুন ইন্টিগ্রেশন
✅ `hl_b_member_public_profiles()` ব্যবহার করে বিদ্যমান সদস্য ডিরেক্টরির সঙ্গে matching `membership_id` ধরে `avatar_url` যুক্ত; আগের মিল/হিসাব/রোল ডেটা অক্ষত। RPC ব্যর্থ হলেও মূল ডিরেক্টরি চলে। Cached directory-এর সঙ্গে কাজ করে; প্রতি রেন্ডারে API কল নয়।
✅ `hl_b_platform_member_directory(100,0)` থেকে সীমিত পরিচয়/ইমেইল/ছবি জোড়া হচ্ছে শুধুমাত্র Super Admin-এর পুরোনো মেস সদস্য তালিকায় user_id মেলানোর পর। অন্য মেসের সদস্যের তথ্য UI-তে মেশানো হয় না। প্রথম ১০০টি প্রোফাইলের সীমা আছে; বড় প্ল্যাটফর্মে সার্ভার-সাইড hostel scoped query প্রয়োজন হতে পারে।
✅ Super Admin সদস্য তালিকায় Email ও Profile Photo প্রদর্শনের ব্যবস্থা। ছবির URL স্টোরেজে নিষিদ্ধ হলে দেখাবে না; বিদ্যমান initials fallback আছে।
✅ Manager Archive তালিকায় `hl_b_list_closed_months()` থেকে বাদ পড়া বন্ধ মাসগুলো Read-only হিসেবে দৃশ্যমান; গুরুত্বপূর্ণ: নতুন row-তে `can_reopen` ও `can_grant_closer_edit` false রাখা হয়েছে। অপর্যাপ্ত অনুমতি থাকলে অকারণে edit/reopen ক্ষমতা দেওয়া হয়নি।
✅ History Previous Months তালিকায় missing closed period যোগ হয়; আগের detail ও authorization পুরোটাই বজায় থাকে।

## SQL-এর প্রয়োজন আছে কি?
এই **Frontend Integration** কাজের জন্য নতুন SQL দরকার নেই, কারণ সংশ্লিষ্ট চারটি RPC আগের চালানো Module B SQL-এ আছে। তবে নিচের সমস্যাগুলো সম্পূর্ণ সমাধান হয়েছে বলা যায় না:
❌ Archive detail/edit permission বা reopen action প্রকৃত ব্যবহারকারীর ক্ষেত্রে ব্যর্থ হলে বিদ্যমান সংশ্লিষ্ট RPC-এর security/logic সংশোধনে **নতুন incremental SQL প্রয়োজন হতে পারে**। শুধু তালিকায় দেখা মানে সম্পাদনা করা যাবে না।
❌ Permanent Hostel/User Delete-এর ক্ষেত্রে Supabase Auth ও Storage সম্পর্কিত privileged server-side action-এর কাজ/Deployment আলাদা করে যাচাই করতে হবে। শুধু SQL যথেষ্ট নয়।
❌ Temporary Password-এর Edge Functions Deploy, JWT এবং first-login enforcement বাস্তব পরীক্ষায় যাচাই করা হয়নি।
⚠️ ছবি দেখানোর জন্য Storage Bucket/private-image policy/URL বাস্তবে যাচাই করা লাগবে; SQL দিয়ে অনুমান করে সব ছবি public করা হয়নি।
⚠️ মাস বন্ধ ও future meal request-এর end-to-end পরীক্ষা, Finance/reopen guards, PDF visual review এখনো বাকি।

## পরীক্ষা
✅ ২৯টি বিদ্যমান automated tests পাস।
✅ পুরোনো পরিবর্তিত ZIP-এর ওপর সরাসরি সংশোধন; নতুন ব্যাকএন্ড write নেই।
⚠️ `npm ci` নেটওয়ার্ক/ডিপেন্ডেন্সির কারণে শেষ করা যায়নি; তাই Production Build যাচাই করা হয়নি।
❌ লাইভ Supabase, Edge Function, Print ও মোবাইল-স্ক্রিনে end-to-end পরীক্ষিত নয়।

## পরীক্ষা করার নিরাপদ ক্রম
১. প্রথমে Preview Deploy-এ Dashboard avatar, সদস্য তালিকা, History ও Archive list পরীক্ষা।
২. Super Admin-এ নির্বাচিত মেস সদস্যদের ইমেইল/ছবি দেখা যাচ্ছে কিনা যাচাই। বড় ডেটাবেসে first-100 limit খেয়াল করো।
৩. কোনো Archive পুনরায় খোলা বা স্থায়ী ডিলিট করার আগে backup; এই ZIP নতুন delete logic যুক্ত করেনি।
৪. নতুন SQL লিখতে হলে প্রথমে failing RPC name, HTTP response ও user role চিহ্নিত করা। অনুমান করে Master SQL পুনরায় চালাবে না।
