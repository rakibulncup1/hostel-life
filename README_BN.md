# Hostel Life — Notification Hub, Release Notice & Telegram Patch V9

এই প্যাচটি বর্তমান V8 কোডের ওপর Incremental Patch। এটি সম্পূর্ণ Project ZIP নয়।

## ১. প্যাচের ভিত্তি ও ক্রম

প্রয়োগের ভিত্তি:

`Hostel Life(2).zip → V1 → V2 → V3 → V4 → V5 → V6 → V7 → V8 → V9`

V9-এর নতুন Database Migration হলো `supabase/migrations/Run31_notification_hub_and_telegram_delivery.sql`। এটি Run30-এর পরে প্রয়োগ করতে হবে। আগের প্রয়োজনীয় Migration/patch এখনো প্রয়োগ না করা থাকলে সরাসরি Run31 চালাবেন না।

## ২. কী যুক্ত হয়েছে

### Release Update Notice

- Build সময় ও Commit ID Vite build-এর সময় অ্যাপের মধ্যে embed হয়।
- ব্যবহারকারী প্রতি নতুন Build-এ একবার ছোট Update Dialog দেখেন।
- সময় Asia/Dhaka অনুযায়ী দেখা যায়; Refresh অথবা পরে করার সুযোগ থাকে।
- এ জন্য কোনো নতুন Database table, API request, polling বা log নেই।

### Super Admin বার্তা

- Super Admin একটি নির্দিষ্ট মেসের সব সক্রিয় সদস্য অথবা ওই মেসের নির্বাচিত সদস্যদের বার্তা দিতে পারবেন।
- Database আগে যাচাই করে নির্বাচিত প্রত্যেক প্রাপক ওই মেসের সক্রিয় ও Block না হওয়া সদস্য কি না; একটি ID-ও ভুল হলে কোনো বার্তা insert হবে না।
- বার্তা বিদ্যমান `notifications` Inbox-এ সংরক্ষিত হয় এবং অ্যাপে লগইন/পরবর্তী refresh-এ অগ্রাধিকার Popup দেখায়।
- Global Platform Notice আপডেট হলে সেটিও বিদ্যমান Inbox-এ system notice হিসেবে যায়। Manager Notice-এর বর্তমান pinned আচরণ বজায় থাকে।

### Telegram Notification Provider

- Telegram সম্পূর্ণ ঐচ্ছিক। ব্যবহারকারী নিজে সংযোগ না করলে তার কাছে Telegram বার্তা যাবে না।
- Notification-এর জন্য একটি কেন্দ্রীয় Database hook আছে; ভবিষ্যতের নতুন `notifications` INSERT-ও একই Delivery Layer-এ যাবে। আলাদা আলাদা feature-এ Telegram কোড যোগ করতে হবে না।
- Telegram Chat ID, Telegram User ID ও ঐচ্ছিক Username Server-side private table-এ থাকে। Browser-এ Bot Token/Webhook Secret আসে না।
- সংযোগ Token ৩২ random byte (৬৪ hex character); Database-এ raw token নয়, শুধু SHA-256 hash রাখা হয়; ১০ মিনিটে মেয়াদ শেষ এবং একবার ব্যবহারের পর বাতিল।
- Delivery Outbox-এ শুধু notification ID, recipient ID, status, attempt ও সীমিত error code থাকে—message body, Chat ID বা Bot Token নয়। Outbox/Batch metadata ৭ দিন পর প্রথম দৈনিক Notification INSERT-এর সময় পরিষ্কার হয়। কোনো Cron/Polling দরকার নেই।
- একটি Database INSERT-এ সর্বোচ্চ ১০০ প্রাপকের ID নিয়ে একটি batch হয়; বড় insert একাধিক batch-এ ভাগ হয়। প্রতিটি batch-এ একটি Edge Function invocation লাগে। Telegram API-তে অবশ্য প্রত্যেক opt-in ব্যবহারকারীর জন্য আলাদা `sendMessage` request লাগে।
- Provider setting `disabled` থাকলে নতুন Telegram outbox/batch তৈরি হয় না। In-App Notification স্বাভাবিকভাবে কাজ করে।
- Provider architecture কেন্দ্রীয়; ভবিষ্যতে অন্য Provider যোগ করতে নতুন backend adapter/permission/migration লাগবে—শুধু UI থেকে নাম পাল্টালেই হবে না।

## ৩. Run31 Migration

ফাইল:

`supabase/migrations/Run31_notification_hub_and_telegram_delivery.sql`

এটি নতুন Provider/Channel/Link Token/Outbox/Batch টেবিল, `notifications.notification_kind`, প্রয়োজনীয় RPC, বিদ্যমান notification RPC-এর compatibility update এবং statement-level delivery trigger তৈরি করে। কোনো পুরোনো ব্যবসায়িক হিসাব, মিল, বাজার, সদস্যপদ বা Notification row মুছে ফেলে না। শুধু মেয়াদোত্তীর্ণ একবারের Telegram link token এবং ৭ দিনের বেশি পুরোনো delivery metadata পরিষ্কার হয়।

**Production-এ চালানোর আগে:**

1. তোমার সম্পূর্ণ Database Backup নাও।
2. আলাদা Staging Supabase Project-এ Baseline থেকে প্রয়োজনীয় আগের Migration (বিশেষ করে Run28, Run29, Run30) এবং Run31 ক্রমানুসারে প্রয়োগ করে পরীক্ষা করো।
3. Run31-এর SQL Editor output-এ Error নেই নিশ্চিত করো। এই প্যাচ তৈরির পরিবেশে Postgres Runtime/`psql` ছিল না; SQL Static Review ও Contract Tests হয়েছে, Live DB-তে Run31 execute করা হয়নি।
4. Staging পরীক্ষা সফল হলে Production-এ Run31 একবার চালাও। কোনো Error হলে output দেখে কারণ নির্ণয় না করে একই Migration বারবার চালিও না।

## ৪. Telegram হাতে সেটআপ — একবারের কাজ

Telegram ব্যবহার করতে না চাইলে এই অংশ বাদ দিতে পারো। Telegram Provider ডিফল্টভাবে `disabled`; সেটি চালু না করলে কোনো Telegram Delivery হবে না।

### ধাপ A — Bot তৈরি ও Secret প্রস্তুত

1. Telegram-এর BotFather দিয়ে একটি Bot তৈরি করো এবং Bot Token সংগ্রহ করো।
2. দুটি আলাদা ৩২-byte random hexadecimal secret তৈরি করো:
   - `TELEGRAM_WEBHOOK_SECRET` — Telegram থেকে আসা Bot update যাচাইয়ের জন্য।
   - `NOTIFICATION_DISPATCH_WEBHOOK_SECRET` — Database Webhook থেকে Dispatcher Function-এ অনুরোধ যাচাইয়ের জন্য।
3. এগুলো Supabase Project-এর Edge Function Secrets-এ রাখো:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_SECRET`
   - `NOTIFICATION_DISPATCH_WEBHOOK_SECRET`

**কোনো Token/Secret Frontend `.env`, GitHub, SQL Migration, বা Browser-এ রাখবে না।** আলাদা দুটি Secret একই মানের হবে না।

### ধাপ B — Edge Function Deploy

Project root থেকে PowerShell-এ (নিজের Project Ref বসিয়ে):

```powershell
npx supabase functions deploy telegram-bot-webhook --project-ref <PROJECT_REF> --no-verify-jwt
npx supabase functions deploy telegram-notification-dispatch --project-ref <PROJECT_REF> --no-verify-jwt
```

Functions-এর `verify_jwt=false`; তার বদলে প্রত্যেক Function নিজস্ব Secret Header যাচাই করে।

### ধাপ C — Telegram Webhook সেট

Telegram Bot API-এর `setWebhook`-এ এই URL দেবে:

`https://<PROJECT_REF>.supabase.co/functions/v1/telegram-bot-webhook`

প্যারামিটার:

- `secret_token`: Supabase Secret-এ রাখা `TELEGRAM_WEBHOOK_SECRET`-এর একই মান। Telegram এই মান `X-Telegram-Bot-Api-Secret-Token` Header-এ পাঠায়।
- `allowed_updates`: শুধু `message`।

Telegram-এর নিয়মে `secret_token` ১–২৫৬ অক্ষরের এবং `A-Z`, `a-z`, `0-9`, `_`, `-` অক্ষর ব্যবহার করতে হয়। সংযোগ Token ৬৪ অক্ষরের হওয়ায় Bot Deep Link-এর Start Parameter সীমার মধ্যে থাকে।

### ধাপ D — Supabase Database Webhook সেট

Supabase Dashboard → Database → Webhooks থেকে নতুন Webhook তৈরি করো:

- Name: `hostel-life-telegram-delivery`
- Table: `public.notification_delivery_batches`
- Event: `INSERT`
- Method: `POST`
- URL: `https://<PROJECT_REF>.supabase.co/functions/v1/telegram-notification-dispatch`
- Header `Content-Type`: `application/json`
- Header `x-hostel-delivery-secret`: `NOTIFICATION_DISPATCH_WEBHOOK_SECRET`-এর একই মান

Supabase Database Webhooks `pg_net`-ভিত্তিক asynchronous request ব্যবহার করে; বাহ্যিক HTTP request-এর জন্য মূল Database transaction দীর্ঘক্ষণ আটকে থাকে না। Project-এ Database Webhook/`pg_net` উপলভ্য ও সক্রিয় আছে কি না Dashboard-এ যাচাই করবে।

### ধাপ E — Super Admin থেকে চালু

1. Super Admin → System Settings → Telegram Setup-এ যাও।
2. Bot Username (`@` ছাড়া) লিখো।
3. Secrets, দুইটি Function ও উভয় Webhook সফলভাবে পরীক্ষা করার পর Telegram Delivery চালু করো।
4. Provider বন্ধ করলে নতুন Telegram Delivery বন্ধ হবে; ব্যবহারকারীর পুরোনো সংযোগ মুছে যাবে না।

### ধাপ F — প্রত্যেক ব্যবহারকারীর নিজস্ব সম্মতি

1. ব্যবহারকারী Menu → Telegram সংযোগ খুলবেন, অথবা প্রথমবারের ঐচ্ছিক Prompt থেকে যাবেন।
2. সংযোগ লিংক তৈরি করে Telegram Bot খুলবেন এবং Private Chat-এ **Start** চাপবেন।
3. Hostel Life-এ ফিরে **সংযোগ যাচাই** করবেন।
4. চাইলে একই পেজ থেকে যেকোনো সময় সংযোগ বিচ্ছিন্ন করতে পারবেন।

Telegram Bot আগে থেকে Start না করা ব্যক্তিকে নিজে থেকে প্রথম বার্তা শুরু করতে পারে না। ব্যবহারকারীকে Bot-এর সঙ্গে Private Chat শুরু করতে হবে।

## ৫. Free Plan, সীমা ও খরচ

- Release Popup build-time metadata ব্যবহার করে; কোনো runtime request/log নেই।
- বিদ্যমান Notification Inbox এবং Realtime refresh পুনর্ব্যবহার করা হয়েছে; নতুন polling/Push Service নেই। Telegram Nudge-এর জন্য Provider সক্রিয় থাকলে সংযুক্তি পরীক্ষা করতে একবার authenticated status RPC হয়; এটি polling নয়।
- Telegram সংযোগ না থাকলে Delivery Batch তৈরি হয় না।
- Supabase-এর Free plan-এ Edge Function invocation-এর মাসিক quota বর্তমানে ৫০০,০০০; এটি পুরো Organization-এর সব Project মিলিয়ে usage হতে পারে। নিজের Dashboard-এর Usage পেজে প্রকৃত consumption দেখবে।
- Telegram-এর বিনামূল্যের Bot broadcast সীমা প্রায় ৩০ message/second; একটি chat-এ সাধারণত ১ message/second-এর বেশি না পাঠানোর সুপারিশ আছে। Dispatcher sequential pacing ও HTTP 429 retry ব্যবহার করে; খুব বড়/একসঙ্গে অনেক broadcast হলে Telegram rate-limit-এর কারণে কিছু Delivery দেরি বা ব্যর্থ হতে পারে। Paid Broadcast চালু করা হয়নি।
- In-App notification insert সফল হলেও Telegram Delivery ব্যর্থ হতে পারে; এতে মূল Hostel Life কাজ বা In-App Inbox ব্যাহত হওয়ার কথা নয়।

## ৬. যাচাই কমান্ড

```powershell
npm ci
npm test
npm run build
```

এই প্যাচ তৈরির পরিবেশে `vite` executable অনুপস্থিত থাকায় `npm run build` সফলভাবে যাচাই করা যায়নি। তাই স্থানীয়/ Staging Build সফল না হওয়া পর্যন্ত Production Deploy করবে না।

## ৭. এই প্যাচে যা করা হয়নি

- কোনো Live Supabase Database/Function/Vercel Deploy করা হয়নি।
- Telegram Bot তৈরি, Secret বসানো বা Webhook সেট করা হয়নি; এগুলো Project Owner-কে একবার হাতে করতে হবে।
- Public/Anonymous Hostel Dashboard বা অননুমোদিত ডেটা পড়ার কোনো পথ যোগ করা হয়নি।
- Telegram-এ পুরোনো Notification backfill করা হয় না; সংযোগের পর নতুন Notification পাঠানো হবে।
