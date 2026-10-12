# Hostel Life Hotfix V3 — আগে এটি পড়ুন

এই প্যাকেজে দুটি নির্দিষ্ট সংশোধন আছে:

1. `Hostel-Life/vercel.json`: Vercel-এ সরাসরি `/super-admin` URL খুলতে SPA rewrite যোগ করা হয়েছে। এটি কার্যকর করতে নতুন version deploy করতে হবে।
2. `Hostel-Life/supabase/HOSTEL_LIFE_FIX_MARKET_MANAGER_AUTH_V3.sql`: আগের market permission helper-এ চলমান period-এর `primary_manager_membership_id` যাচাই বাদ ছিল। এই patch সেটি যোগ করে; archived period-এর permission পুরোনো helper থেকে নেওয়া হয়।

## প্রয়োগের ধাপ

1. Supabase backup নিন।
2. Supabase SQL Editor-এ `Hostel-Life/supabase/HOSTEL_LIFE_FIX_MARKET_MANAGER_AUTH_V3.sql` একবার চালান। এটি `DROP FUNCTION` বা `CASCADE` ব্যবহার করে না এবং সরাসরি ব্যবসায়িক রেকর্ড মুছে না।
3. এই ZIP-এর প্রজেক্ট Vercel-এ deploy করুন; শুধু SQL চালালে direct URL rewrite ঠিক হবে না।
4. Deploy শেষ হলে `https://YOUR-DOMAIN/super-admin` খুলুন। যদি app পেজ খুলে role denied বলে, SQL Editor-এ আপনার UID দিয়ে চালান:
   ```sql
   SELECT id, email, role FROM public.profiles WHERE id = 'YOUR-AUTH-UUID'::uuid;
   ```
   `role` অবশ্যই `super_admin` এবং এটি আপনার লগইন করা Auth UID-এর সঙ্গে মিলতে হবে।
5. বাজার edit যাচাই: primary manager user দিয়ে History → Market History → non-void entry → Edit → ছোট test change → Save. Error এলে app-এর সঠিক error text সংরক্ষণ করুন।

## Validation

এই source copy-তে `npm test`: 10/10 passed. Production build চালানো যায়নি, কারণ working environment-এ `vite` dependency ইনস্টল নেই (`vite: not found`). আপনার environment-এ ZIP extract করে `npm ci`, `npm test`, `npm run build` চালান। Live Supabase-এ SQL এখনও execute করা হয়নি।
