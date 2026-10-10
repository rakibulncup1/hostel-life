# Hostel Life — Frontend FIX-04

Version: 0.9.0  
Scope: Money, Market & Accounting Hardening  
Baseline: `Hostel-Life-Frontend-Fix-03`

## গুরুত্বপূর্ণ

FIX-04 অবশ্যই FIX-03 সফলভাবে apply করার পরে apply করতে হবে। এটি একটি cumulative frontend package।

## প্রধান পরিবর্তন

- Account history এখন V2.0.2-এর `get_account_history_v2()` ব্যবহার করে এবং প্রকৃত `entry_date` দেখায়।
- Ledger type-কে frontend-এ consistent Bengali label-এ normalize করা হয়েছে।
- হিসাব history-তে যোগ/বাদ/net summary দেখানো হয়েছে।
- Market history-তে void entry আলাদা status হিসেবে দৃশ্যমান।
- Report-এর market total থেকে void market বাদ দেওয়া হয়েছে।
- Report CSV-তে transaction-এর entry date ব্যবহার করা হয়েছে।
- নতুন market/deposit/other-expense entry শুধু বর্তমান running period-এর তারিখে রাখা হয়েছে; archived correction-এর জন্য History workflow ব্যবহার করা হবে।
- Future date client-level guard করা হয়েছে; server-side hard block আগের মতোই authoritative।
- Deposit/expense success-এর পরে member/account context refresh হয়।
- Small-screen accounting cards stacked হয়।
- Existing market edit/void এবং transaction adjustment flow রাখা হয়েছে; কোনো destructive delete যুক্ত করা হয়নি।

## Database

FIX-04-এর জন্য একটি targeted backend patch আছে। এটি পুরো migration নয়; existing V2.0.2 RPC `get_account_history_v2()`-কে manager-aware করে।

`FIX-04-ACCOUNT-HISTORY-SECURITY-PATCH.sql` একটি targeted `CREATE OR REPLACE FUNCTION` patch; এটি table data পরিবর্তন করে না, তবে সাধারণ সদস্যের account-history scope নিরাপদ করে।
- `FIX-04-READONLY-PREFLIGHT.sql` শুধু function/privilege উপস্থিতি যাচাইয়ের জন্য। এটি data mutation করে না।

Do not rerun master SQL, Repair V2.0.2, Dashboard Repair, or Module 06 patch just for FIX-04.

## Install

1. Current FIX-03 working project-এর backup/commit রাখুন।
2. Supabase-এ `FIX-04-ACCOUNT-HISTORY-SECURITY-PATCH.sql` একবার চালান।
3. এই ZIP merge/replace করুন।
4. `npm install`
5. `npm run build`

## Required live smoke test

- Market: today/past date, zero/invalid item, deposit toggle, success refresh
- Deposit: current running month date, future date blocked, success refresh
- Other expense: description required, future date blocked, success refresh
- History: real entry date, Bengali transaction label, member filter
- Market history: active vs void
- Manager: market edit/void and reason requirement
- Transaction adjustment: deposit and expense target values
- Reports: void market excluded from active total, CSV entry date correct
- Previous/archived month history remains readable

## Rollback

Frontend অংশটি merge করা source থেকে FIX-03 baseline-এ ফিরে যেতে পারবেন। Backend patch-এর কোনো table-data mutation নেই; এটি function definition replace করে। প্রয়োজনে আগের V2.0.2 `get_account_history_v2()` definition পুনঃস্থাপন করতে হবে।
