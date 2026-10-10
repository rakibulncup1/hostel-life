# Hostel Life — Frontend FIX-03

Version: 0.8.0  
Scope: Month & Manager Operations Hardening  
Baseline: `Hostel-Life-Frontend-Fix-02.zip`

## লক্ষ্য

FIX-03 বর্তমান Month/Manager workflow-কে আরও নির্ভরযোগ্য করে। এটি নতুন database schema তৈরি করে না এবং V2.0.2 backend rules-কে replace করে না।

## প্রধান পরিবর্তন

- `MemberManagementPage`-এ deactivate/reactivate action-এর busy lock যোগ করা হয়েছে, যাতে double-submit না হয়।
- `ManagerPages.jsx`-এ missing `fetchMemberDirectory` import runtime error এড়াতে সংশোধন করা হয়েছে।
- New Month page server-computed default end date দেখায়।
- Close Month page-এ browser-level minimum end date বর্তমান Dhaka আজকের তারিখে সীমাবদ্ধ করা হয়েছে; অতীতের তারিখ select করা যায় না।
- Future end-date scheduling এবং immediate month close-এর confirmation wording আলাদা ও সঠিক করা হয়েছে।
- Manager change action-এ selected target-এর client-side validation যোগ হয়েছে।
- Archive temporary permission-এর expiration past হলে client-side warning দেখায়।
- Month/manager operation-এর existing permission guards অপরিবর্তিত রাখা হয়েছে।

## Database

FIX-03-এর জন্য কোনো নতুন write migration প্রয়োজন নেই।

Do not rerun:
- master SQL
- `HOSTEL_LIFE_REPAIR_MIGRATION_V2_0_2.sql`
- Dashboard Repair V2.1.x SQL
- Module 06 database patch

## Install order

`FIX-02` সফলভাবে apply করা current source-এর ওপর এই package apply করতে হবে।

1. Current project backup/commit রাখুন।
2. ZIP extract করে existing project-এর সঙ্গে merge/replace করুন।
3. `npm install`
4. `npm run build`

তারপর live smoke test:
- Current month context
- Future end date schedule
- Today দিয়ে close
- New month start
- Manager transfer
- Assistant manager set/unset
- Member deactivate/reactivate
- Archive permission grant/revoke

## Rollback

Unexpected behavior হলে আগের FIX-02 baseline-এ ফিরে যান। FIX-03 নিজে কোনো database mutation করে না।
