# Supabase Final Finishing Migration — ব্যবহার নির্দেশনা

**আগে backup নিন।**

1. `supabase/migrations/20261027_open_ended_running_period.sql` — কেবল open-ended period migration আগে সফলভাবে চালানো না থাকলে চালান। ইতোমধ্যে সফল হলে পুনরায় চালানোর দরকার নেই।
2. `supabase/migrations/20261027_finishing_reliability.sql` — এই ফাইল একবার চালান। এতে archive reopen, Khala creator name, permanent notification deletion, Super Admin hostel deletion and retention queue, 10 PM normal cutoff, late request validation, direct-edit record syncing, and finalized-day correction approval fixes আছে।
3. SQL সফল হওয়ার পরে Supabase schema refresh করুন, তারপর নতুন frontend deploy করে প্রথমে test account/period-এ যাচাই করুন।

পুরোনো full Master SQL বা আগের failed/obsolete SQL block এর সঙ্গে এ ফাইল মিশিয়ে চালাবেন না। Open-ended period migration আগে ব্যর্থ হয়ে থাকলে, কোনো পরিবর্তন সফলভাবে commit হয়েছে ধরে নেবেন না—PostgreSQL transaction error হলে সেই migration-এর সব পরিবর্তন rollback হয়। Migration-এ error হলে পুরো error text রেখে থামুন; আংশিক কোড কপি করে আবার চালাবেন না। এই পরিবেশ থেকে live database-এ চালানো/যাচাই করা যায়নি।
