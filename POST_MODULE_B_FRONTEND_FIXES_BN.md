# Hostel Life — Post Module B Frontend Fixes

এটি `Hostel_Life_Privacy_Finishing_Update.zip`-এর ওপর incremental frontend আপডেট। আগের পরিবর্তনগুলো সংরক্ষিত। বর্তমান SQL সফলভাবে চালানোর পরে আলাদা SQL লাগার কথা নয় এই নির্দিষ্ট পরিবর্তনগুলোর জন্য।

## বাস্তবে সংশোধিত
- Archive Manager: manager archive, `hl_b_list_closed_months`, এবং History-তে ব্যবহৃত `get_previous_months` তিনটি আলাদা RPC থেকে মাস আনা হয়; একটি ব্যর্থ হলে সব মাস হারিয়ে যায় না। একই period duplicate হয় না। **শুধু manager RPC** edit/reopen authorization দিতে পারে। অন্যান্য উৎসের period read-only।
- Archive Manager: member directory লোড ব্যর্থ হলে মাসের তালিকা লুকায় না; manual refresh যোগ। selected month state-এর circular reload dependency বাদ।
- Mobile request history: compact day-card-এর breakfast/lunch/dinner controls এক কলামে পূর্ণ-প্রস্থে রাখা, plus/minus overlap রোধ।
- Khala history: 'এন্ট্রি করেছেন' বদলে 'পরিশোধ করেছেন'। নাম backend-এর `created_by_name` থেকে আসবে।
- Notifications: আগের individually ৫০টি RPC-এর বদলে বিদ্যমান SQL `delete_all_my_notifications` একবার ব্যবহার করা হয়েছে। ব্যর্থ হলে UI মুছে গেছে বলে দেখাবে না। Backend soft delete হওয়ায় storage সঙ্গে সঙ্গে মুক্ত হবে এমন দাবি নেই।

## যেগুলো এখনও live যাচাই করা দরকার
- Manager archive-এ কোনো মাস read-only দেখা গেলে `get_archive_management_items()` ওই মাসের authorized metadata দিচ্ছে না। শুধু frontend দিয়ে Reopen/Edit authorization তৈরি করা নিরাপদ নয়।
- Dashboard ৯টার finalization-এ zero total bug: ফলাফল সরাসরি ডেটাবেজ থেকে পরীক্ষা ছাড়া হিসাবের সংখ্যা বদলাইনি।
- Supabase Storage privacy এবং Super Admin password/hostel deletion: server configuration/Edge Functions যাচাই দরকার।
- আগের notification body-তে নাম না থাকলে frontend দিয়ে সত্যিকারের নাম উদ্ধার করা যায় না; নতুন notification trigger-এর তথ্য দেখতে হবে।

## পরীক্ষা
- node --test: 29/29 passed
- Production build: dependencies না থাকায় করা যায়নি
- Live Supabase testing: করা হয়নি

Deploy করার আগে আগের কাজ করা ZIP ব্যাকআপ রাখো। Preview যদি একই Supabase database ব্যবহার করে, mutation সরাসরি আসল ডাটায় যাবে। Archive delete বা permanent delete পরীক্ষার জন্য ব্যবহার কোরো না।
