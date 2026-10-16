# Hostel Life — Module 01 Pre-SQL Handoff

## নিরাপত্তা ও অবস্থা
এই আপডেট আগের Batch 02-এর ওপর তৈরি। আগের সব ফাইল অন্তর্ভুক্ত। ডাটাবেজে কোনো SQL কার্যকর করা হয়নি। Live Database-এ কোনো মুছে-ফেলার কাজ করা হয়নি।

### এই ব্যাচে সম্পন্ন
- Super Admin: মেস ডিরেক্টরির client-side pagination (প্রতি পৃষ্ঠায় ২০টি); সদস্য তালিকার pagination; search ও filter বদলালে প্রথম পৃষ্ঠায় ফেরা। এতে অতিরিক্ত Supabase API call যোগ হয়নি।
- Super Admin: 'ডেটা সংরক্ষণ' নামে আলাদা Tab, বিস্তারিত ও সামারি মাসের নীতি, মেয়াদোত্তীর্ণ আর্কাইভ queue, পৃথক confirmation সহ manual deletion action-এর UI এবং RPC contract।
- SQL না থাকলে retention tab fail-closed: তথ্য মুছে না; বাংলা সতর্কবার্তা দেখায়। RPC প্রয়োগ না হওয়া পর্যন্ত নতুন retention controls কাজ করবে না।
- ডেটাবেজ RPC-এ স্থায়ীভাবে আর্কাইভ মুছতে SQL-এর নিজস্ব super_admin check, মেয়াদ যাচাই, backup/recovery strategy ও transaction isolation অপরিহার্য। Browser confirmation **নিরাপত্তা নয়**।
- Responsive retention ও pagination CSS।

### Module 02-এর RPC Contract (নাম ও payload ঠিক রেখে SQL বাস্তবায়ন)
- `platform_admin_get_retention()` -> JSON object `{detail_months: 2, summary_months: 6}` (summary_months = detailed period-এর পর অতিরিক্ত মেয়াদ)।
- `platform_admin_update_retention(p_detail_months integer, p_summary_months integer)` -> updated policy; server verifies super admin, input ranges and emits notifications to affected hostels.
- `platform_admin_list_expired_archives()` -> rows `[{hostel_id,period_id,hostel_name,period_label,expired_at}]` verified eligible by server-side policy. Never include another hostel's private financial records.
- `platform_admin_delete_expired_archive(p_hostel_id uuid,p_period_id uuid,p_confirmation text)` -> carefully verified manual deletion ONLY for expired archives, and `DELETE ARCHIVE` confirmation. Backend independently authorizes, calculates eligibility, saves audit row and notifies members. Rollback on any failure. No blanket deletes.

### সমন্বয়-পরবর্তী বাকি অপরিহার্য কাজ
- Archive permission and finalized-period write restrictions; next day period opening.
- Other expenses visibility via RLS and accounting RPC responses.
- Notifications triggered on meaningful server-side actions; app badge consumes same feed.
- Global retention policy enforcement; safe summary/archive compaction and optional eligible manual deletion.
- Super Admin blocking lock (manager must not undo); secure identity-verified temporary password provisioning via privileged Edge Function (service role NEVER in browser).
- Storage statistics only if cheap and reliable queries; no continuous time-tracking or extra logging.
- End-to-end testing against **staging** Supabase and real devices. Existing node tests do NOT verify SQL.

### পরীক্ষা
`npm test` = 29/29 pass (existing suite). Production build attempted but unavailable due to missing executable `vite` in supplied/available dependencies; therefore production build is **unverified**.

### Deployment
Use separate Preview/staging deployment. Retention controls are intentionally not live until matching SQL exists. Do not run old master schema on the production database. Take independently restorable backups before migrations.
