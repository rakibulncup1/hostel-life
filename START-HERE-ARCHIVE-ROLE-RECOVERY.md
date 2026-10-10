# Hostel Life — Archive / Manager Authority Recovery V1

## গুরুত্বপূর্ণ: কোন SQL চালাবেন

এই package-এর জন্য শুধু এই নতুন migration চালাবেন:

`supabase/HOSTEL_LIFE_ARCHIVE_ROLE_AND_PERIOD_SAFETY_V1.sql`

আগের Phase 1, Phase 3, Core Recovery, বা Pre-SuperAdmin V3 SQL আবার চালাবেন না। সেগুলো historical reference হিসেবে project-এ আছে।

## চালানোর আগে

1. চলমান project folder-এর backup রাখুন।
2. Supabase Database Backup/সাম্প্রতিক export আছে নিশ্চিত করুন।
3. SQL Editor-এ নতুন query খুলে উপরের ফাইলের সম্পূর্ণ content একবারে paste করে Run করুন।
4. শেষের `check_name / result` output সংরক্ষণ করুন। Error হলে একই output-এর screenshot ও পুরো error text রাখুন; error হলে আগের migration আবার/অন্য migration চালাবেন না।

## কী বদলাচ্ছে

- আর্কাইভ period-এর `pre_close_end_date` সংরক্ষণ করে ভুলবশত close হলে সীমিত reopen-এর সুযোগ দেয়।
- Archive edit permission শুধু সেই নির্দিষ্ট period-এর closing manager-কে দেওয়া যায়। Current primary manager সময়সীমাসহ grant/revoke করতে পারবেন। Grant/revoke হলে শুধু closing manager-কে targeted notification যাবে।
- Archive-এর বাজার, বাজারের item, ledger, Khala, daily meal/day record ও meal request row পরিবর্তিত হলে actor/time/summary audit record তৈরি হয়।
- Closing manager নিজেই current primary manager থাকলে বা বৈধ temporary permission পেলে তবেই archived-period operational mutations অনুমোদিত হবে।
- চলমান period-এ ঠিক একজন active `role='manager'` membership থাকলে শুধু তখনই stale `primary_manager_membership_id` pointer reconcile হবে। Zero বা multiple manager role পেলে migration অনুমান করে role বদলাবে না; diagnostic output তা দেখাবে।
- সদস্য নিষ্ক্রিয়/পুনরায় সক্রিয় করার RPC বর্তমান primary manager-এর authority যাচাই করে। Running period থাকলে period pointer-ও মিলতে হবে।
- No-running-period অবস্থায় member list/role flags-এর frontend fallback ও header-এর “এখনো মাস শুরু হয়নি” badge বজায় থাকে। Dashboard summary RPC ব্যর্থ হলেও period এবং member directory আলাদাভাবে load করে সদস্য তালিকা ধরে রাখে।
- Manager emergency override খুললে নির্বাচিত দিনের server record আগে load করে form fill হবে, যাতে পুরোনো meal values ভুল করে default দিয়ে overwrite না হয়।
- Assistant Manager-এর “আমার মিল” সাধারণ member-এর meal-request/history/correction flow ব্যবহার করবে; Primary Manager-এর direct meal entry/override আলাদা থাকবে।

## নিরাপত্তা ও data-preservation সীমা

- Migration-এ `DROP TABLE`, `TRUNCATE` বা historical business rows মুছে ফেলার statement নেই।
- `monthly_periods`-এ শুধু `pre_close_end_date` কলাম যোগ হয় এবং running period-এর primary manager pointer কেবল unambiguous single-manager case-এ update হতে পারে।
- Migration archive audit table/trigger ও RPC যোগ/replace করে।
- Accidental reopen কেবল একই calendar month-এর মধ্যে, কোনো running period না থাকলে, পরবর্তী period তৈরি না হলে এবং exact closing manager-এর মাধ্যমে সম্ভব।
- Month close-এর সময় যেসব future meal request cancel হয়ে গেছে, reopen করলে সেগুলো স্বয়ংক্রিয়ভাবে ফিরবে না; প্রয়োজনে নতুন করে request জমা দিতে হবে।
- পুরোনো archive-এর `pre_close_end_date` আগে থেকে না থাকলে reopen fallback calendar month end ব্যবহার করতে পারে।

## Frontend apply

এই ZIP-ই cumulative project copy। আগে নিজের current working folder backup করুন; তারপর ZIP-এর project files ব্যবহার করুন, নিজের `.env.local`/secrets আলাদা রাখুন। `.env.example`-কে real credentials দিয়ে overwrite করবেন না।

## Test order

`ARCHIVE-ROLE-RECOVERY-TEST-CHECKLIST.md` অনুসরণ করুন। Production build এই working environment-এ dependency-network timeout-এর কারণে যাচাই করা যায়নি; local machine-এ `npm ci` এবং `npm run build` চালিয়ে verify করুন।
