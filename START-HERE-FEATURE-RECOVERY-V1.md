# Hostel Life — Feature Recovery V1 (HISTORICAL — DO NOT RUN)

> **সতর্কতা:** এই নির্দেশিকা পুরোনো। `supabase/HOSTEL_LIFE_FEATURE_RECOVERY_V1.sql` বর্তমান live snapshot-এর সঙ্গে return-type conflict করে (`integer` বনাম `void`) এবং `42P13` error দিতে পারে। এটি আবার চালাবে না। বর্তমান পরিবর্তনের জন্য `HOSTEL-LIFE-FRONTEND-RECOVERY-V1-README-BN.md` দেখুন।

এই package-টি তোমার সর্বশেষ feature request অনুযায়ী বর্তমান recovery project-এর cumulative copy। এটি Super Admin phase নয়।

## আগে নিরাপত্তা

1. বর্তমান project folder-এর backup রাখো।
2. Supabase dashboard-এ project backup/প্রয়োজনীয় export রাখো।
3. `.env.local` বা অন্য কোনো secret এই ZIP-এ রাখা হয়নি। তোমার local `.env.local` আগের project থেকে আলাদা করে নিরাপদে copy করবে।
4. এই package-এর নতুন SQL একবারের বেশি চালানোর দরকার নেই। SQL Editor-এ error হলে আর পুরোনো recovery SQL চালাবে না; সম্পূর্ণ error message পাঠাবে।

## কোন SQL?

পুরোনো নির্দেশিকার অংশ — বর্তমান live database-এ এটি চালানো যাবে না:

`supabase/HOSTEL_LIFE_FEATURE_RECOVERY_V1.sql`

এটি additive migration: late-request flag, request/member-detail RPC, notification helper, correction review hardening এবং RPC permission refresh যোগ করে। Existing market accounting function-এর body rewrite করে না; existing business rows মুছে বা reset করে না।

এটি এখনো live Supabase-এ চালানো/verify করা হয়নি। চালানোর আগে backup নাও। SQL Editor result-এর সম্পূর্ণ output সংরক্ষণ করবে।

## Frontend install

1. ZIP extract করো।
2. নিজের পুরোনো `.env.local` থেকে `VITE_SUPABASE_URL` এবং `VITE_SUPABASE_PUBLISHABLE_KEY` local working folder-এ রাখো। Secret/service-role key কখনো browser env-এ দিও না।
3. project folder-এ terminal খুলো:

   ```bash
   npm ci
   npm run build
   npm run dev
   ```

4. `npm ci` network error দিলে পুরোনো `node_modules` copy না করে error text রেখে দাও; build pass হয়েছে বলে ধরে নিও না।

## Market Entry সমস্যা থাকলে (ঐতিহাসিক নোট)

Market entry form-এ member-directory RPC fail করলে আগে running-period result হারিয়ে যাচ্ছিল—এটি `Promise.allSettled`-ভিত্তিক load-এ বদলানো হয়েছে। RPC fallback এখন PostgREST `PGRST202/PGRST203` missing/schema-cache errors-ও চেনে। Directory unavailable হলে UI কারণ দেখাবে; নিজের member ID পাওয়া গেলে শুধু নিজের নামে fallback entry বেছে নেওয়া সম্ভব, কিন্তু অন্য সদস্য নির্বাচন করতে directory ঠিক হতে হবে।

পুরোনো diagnostic-এর বদলে বর্তমান প্যাকেজের `supabase/READ_ONLY_MARKET_DIAGNOSTIC_V2.sql` ব্যবহার করবে। এটি শুধু SELECT/metadata inspection, কোনো table/function/data/privilege পরিবর্তন করে না। Error toast-এ যে message আসে সেটিও সংরক্ষণ করবে।

## পুরোনো SQL

এই ZIP-এর পুরোনো recovery SQL-গুলো historical/reference হিসেবে আছে। সেগুলো আবার চালাবে না।
