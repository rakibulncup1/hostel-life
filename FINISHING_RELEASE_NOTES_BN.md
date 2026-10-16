# Hostel Life — Post SQL finishing (সমন্বিত ZIP)

বেস: `Hostel_Life_Post_SQL_Finishing_Batch.zip` — পূর্ববর্তী সব সংশোধন অক্ষত রেখে কাজ করা হয়েছে।

## নতুন
- Super Admin সদস্য তালিকায় পরিচয় ম্যানুয়ালি যাচাই করে Temporary Password তৈরির UI। পাসওয়ার্ড শুধু একবার দেখায়, frontend localStorage-এ রাখে না।
- অস্থায়ী পাসওয়ার্ড ব্যবহারকারীকে দেওয়ার পর প্রথম লগইনে বাধ্যতামূলক নতুন পাসওয়ার্ড ফর্ম; Backend `app_metadata.must_change_password` ভিত্তিতে অ্যাপের বাকি অংশ আটকে দেয়।
- দুইটি Edge Function অন্তর্ভুক্ত: `admin-temporary-password` ও `complete-temporary-password`; service-role secret শুধু সার্ভারে থাকবে।
- Super Admin মোবাইল recovery panel layout উন্নত।

## Deployment prerequisites
Supabase-এর Project-এ দুইটি Edge Function আলাদাভাবে Deploy করতে হবে; এগুলো SQL Editor-এ চালানো যাবে না। JWT verification enabled রাখুন। `SUPABASE_SERVICE_ROLE_KEY` কখনো `VITE_` environment variable বা GitHub-এ দেবেন না।

## Safety & limitations
- এই ZIP frontend deploy করলে সাধারণ Dashboard/Manager/History আগের মতো চলার কথা; নতুন Password Recovery UI কেবল Edge Function Deploy হলে কাজ করবে।
- Live Database-এ কোনো কোড চালানো হয়নি। Static tests পাস করলেও production build ও browser integration পরীক্ষা করা যায়নি।
- Archive Deletion স্থায়ী: Backup ছাড়া এটির ব্যবহার পরীক্ষা করবেন না।
- Frontend-এ নতুন SQL প্রয়োজন নেই; নতুন Feature-এর জন্য আলাদা Supabase Edge Function deploy অপরিহার্য।
- পরিচয় যাচাই ম্যানুয়াল এবং Super Admin-এর নিজস্ব অ্যাকাউন্ট password reauthentication আগেই আছে।
