# Hostel Life Backup Assistant — বাংলা নির্দেশনা

এই Windows Utility-তে চারটি কাজ করা যায়: **Master Backup, Hostel Backup, Backup Verify এবং Restore & Disaster Recovery**। Backup/Restore চালানোর সময় Database ও API-তে কাজ আপনার কম্পিউটার থেকেই হবে। Web Panel কোনো Database Restore চালায় না। `.hlbackup` ফাইল AES-256-GCM এনক্রিপ্টেড।

> গুরুত্বপূর্ণ: Module 2-তে Live Supabase Project-এ বাস্তব Restore চালিয়ে পরীক্ষা করা হয়নি। আগে একটি নতুন Test Project-এ Dry Run ও Restore যাচাই করুন। নিজের একমাত্র/চলমান Project-এ প্রথমবার পরীক্ষা করবেন না।

## ১. কী কী লাগবে

- Windows 10/11 64-bit
- Python 3.11 বা নতুন সংস্করণ, Tkinter নির্বাচনসহ
- `cryptography`, `requests`, `psycopg` Python Package (প্রথমবার `RUN_BACKUP_ASSISTANT.bat` ইনস্টল করবে)
- **PostgreSQL Client Tools (`psql`) — Master Restore-এর জন্য আবশ্যক**। `psql --version` চালিয়ে PATH-এ আছে কি না যাচাই করুন। PostgreSQL Server/Docker ইনস্টল করা বাধ্যতামূলক নয়; Restore-এর জন্য Client Tools-ই যথেষ্ট।
- Node.js 20.19+, `npx` / Supabase CLI এবং চালু Docker Desktop — Master Backup তৈরির জন্য
- Target Project-এর Supabase Project URL, Project Ref, Database Connection String এবং Target Secret/Legacy `service_role` Key
- কমপক্ষে ১২ অক্ষরের Encryption Password
- Restore-এর জন্য পর্যাপ্ত খালি Disk Space; Workspace-এ অস্থায়ী Plaintext ফাইল তৈরি হয়

## ২. Supabase CLI একবার Login

Master Backup তৈরির সময় Command Prompt/PowerShell-এ চালান:

```powershell
npx --yes supabase@2 login
```

Supabase Personal Access Token দিয়ে Login করুন। এরপর Docker Desktop চালু রাখুন। Master Restore-এর জন্য Supabase CLI Login বা Docker দরকার হয় না; কিন্তু `psql` দরকার হয়।

## ৩. Utility চালু

এই ফোল্ডারের `RUN_BACKUP_ASSISTANT.bat` ডাবল-ক্লিক করুন। প্রথমবার Python Package অনুপস্থিত থাকলে ইনস্টল হবে। বিকল্পভাবে:

```powershell
py -3 backup_assistant.py
```

`প্রয়োজনীয় Tool পরীক্ষা` বোতামে Restore-এর জন্য `psql` সহ প্রয়োজনীয় Tool আছে কি না দেখুন। `psql` না থাকলে PostgreSQL-এর Windows Client Tools ইনস্টল করে PATH-এ যোগ করুন; তারপর নতুন Command Prompt খুলে `psql --version` পরীক্ষা করুন।

## ৪. Master Backup

1. Source Project URL ও Project Ref দিন।
2. Source Database Connection String দিন। Dashboard → Connect থেকে নিন।
3. Source Storage পড়ার জন্য ঐ Project-এর `sb_secret_...` Key অথবা Legacy `service_role` JWT দিন।
4. Hostel Life Project Folder নির্বাচন করুন। `.git`, `node_modules`, `dist`, `.vercel` ও `.env` বাদ থাকবে; Source, SQL Migration, Edge Function Source ও PWA Asset থাকবে।
5. Destination Folder ও ১২+ অক্ষরের Encryption Password দিন।
6. প্রয়োজন হলে ঐচ্ছিক Reusable Secrets File নির্বাচন করুন। পুরোনো Project-এর Database Password/API Key নতুন Project-এ পুনর্ব্যবহার করবেন না।
7. `Full Master Backup তৈরি করুন` চাপুন।

Master Backup-এ Database Roles/Schema/Data, Auth Users/Identities, উপলব্ধ MFA Factor, Storage Bucket ও Object, Website Source, SQL Migration, Edge Function Source Snapshot, Database Inventory এবং Manual Recovery Checklist থাকে। Cron Job-এর SQL Command-ও আলাদা Review File-এ থাকে; এটি কোনো Backup-এর ভেতরেই স্বয়ংক্রিয়ভাবে চালানো হয় না।

Source `.env`, `.env.local`, Database Password, API Key ও CLI Access Token কপি হয় না। Auth Password Hash Backup-এ থাকে, তাই `.hlbackup` অত্যন্ত সংবেদনশীল। নির্বাচিত Drive-এ সাময়িক Plaintext Staging তৈরি হয়; কাজ শেষে সরানো হয়, কিন্তু Secure Erasure নিশ্চিত নয়। BitLocker/Device Encryption চালু Drive ব্যবহার করুন।

## ৫. Hostel Backup

1. Source Database Connection String দিন।
2. `Database থেকে মেসের তালিকা লোড করুন` চাপুন।
3. একটি মেস নির্বাচন করুন, Password ও Destination দিন।
4. Backup তৈরি করুন।

এতে নির্বাচিত মেসের সম্পর্কিত `public`/`private` রেকর্ড এবং সংশ্লিষ্ট সদস্যদের `profile-avatars` ছবি থাকে। Auth Account/Password Hash, Global Settings, Global Audit, Edge Function বা Website Source থাকে না। Target-এ সংশ্লিষ্ট Auth User ID আগে থেকেই থাকতে হবে।

## ৬. Verify Backup

`Verify Backup` Tab-এ `.hlbackup` ও Password নির্বাচন করুন। AES-256-GCM Authentication, ZIP Structure এবং Manifest-এর প্রতিটি SHA-256 Hash যাচাই হবে। এটি Target Project-এ সংযোগ করে না এবং কোনো Restore করে না।

## ৭. Restore & Disaster Recovery — Module 2

### Restore-এর আগে

**Web Panel থেকে `.hlbackup` Upload করা হয় না।** Web Panel-এর Backup & Recovery Center থেকে শুধু Windows Assistant ZIP ডাউনলোড হবে। ZIP Extract করে `RUN_BACKUP_ASSISTANT.bat` চালান; তারপর এই Utility-র `Restore & Recovery` Tab-এ `\.hlbackup নির্বাচন করুন` বোতামে চাপ দিয়ে আগে ডাউনলোড করা Backup File নির্বাচন করুন। File-টি Browser বা Supabase Storage-এ Upload করার দরকার নেই—Restore-এর সময় এটি আপনার কম্পিউটার থেকেই পড়া হয়।

- প্রথমে Backup `Verify` করুন।
- Source Project-এর `.hlbackup` ফাইলটিই ব্যবহার করছেন কি না নিশ্চিত করুন।
- Encryption Password ছাড়া Restore সম্ভব নয়।
- Restore Workspace Backup File-এর Folder থেকে আলাদা রাখুন; BitLocker-সুরক্ষিত Drive উত্তম।
- Target Project URL, Ref, Database Connection String ও Key—সবই **Target Project-এর** হতে হবে, পুরোনো Source Project-এর নয়।
- `psql --version` চালিয়ে PostgreSQL Client Tools আছে কি না নিশ্চিত করুন।

### A. Master Restore — কেবল নতুন/খালি Supabase Project

Master Restore একটি নতুন Supabase Project-এ পূর্ণ সিস্টেম ফিরিয়ে আনার জন্য। এটি একই Source Project-এ চলবে না। Target Project-এ আগে থেকে Application Table/View/Sequence, Auth User/Identity, Storage Bucket/Object বা Migration History থাকলে Dry Run/Preflight বন্ধ করবে। কোনো বিদ্যমান Project পরিষ্কার করার চেষ্টা করবে না।

1. `Restore & Recovery` Tab খুলুন।
2. Source `.hlbackup` ও তার Encryption Password দিন।
3. নতুন Target Project-এর সঠিক Project URL, Project Ref, Database Connection String এবং **Target Project-এর** Secret/Service Role Key দিন।
4. আলাদা Local Restore Workspace নির্বাচন করুন। এটি Journal ও অস্থায়ী Plaintext staging রাখবে।
5. Website/Edge Function Source চাইলে একটি আলাদা **খালি Folder** নির্বাচন করুন। না চাইলে ফাঁকা রাখুন।
6. `প্রথমে Dry Run / Target Check` চাপুন। এতে Backup Integrity, Target Project Identity, Target Database-এর শূন্যতা/permission, Storage API Access এবং প্রয়োজনীয় Extension যাচাই হবে। Dry Run কেবল Read-only।
7. Dry Run সফল হলে Confirmation ঘরে ঠিক `RESTORE <Target Project Ref>` লিখুন।
8. `Restore / Resume শুরু করুন` চাপুন এবং শেষ পর্যন্ত Utility খোলা রাখুন।

Database Roles/Schema/Data এক Transaction-এ Restore হয়। তারপর Migration History, Auth Users/Identities এবং Storage Bucket/Object পৃথক ধাপে যায়। Database step-এর marker একই Transaction-এ লেখা হয়। Object Upload-এ `upsert` ব্যবহার করা হয় না; Target-এ একই Object Path-এর ভিন্ন File থাকলে সেটি Overwrite না করে Restore থামবে।

### B. Selected Hostel Restore — বিদ্যমান সামঞ্জস্যপূর্ণ Schema-তে নতুন মেস

এটি বিদ্যমান Hostel Life Project-এ নির্বাচিত মেসের তথ্য যোগ করে। Target-এর Schema/Migration Version সামঞ্জস্যপূর্ণ থাকতে হবে। Target Auth-এ ঐ Backup-এর সব প্রয়োজনীয় User ID আগে থেকে থাকতে হবে। একই Hostel ID আগে থাকলে Restore বন্ধ হবে। Primary Key conflict, missing required column, schema mismatch বা Circular Foreign Key ধরা পড়লে কোনো Tenant Row commit করা হবে না। আগে থেকে থাকা `public.profiles` Row কখনো Overwrite হবে না। এই Backup Auth Account বা Password তৈরি করে না।

1. Target Project URL/Ref, Database Connection String ও Target Storage Key দিন। Source ও Target একই Project হতে পারে, কারণ এটি একটি নতুন, আলাদা Hostel ID যুক্ত করার জন্য।
2. Backup ও Password নির্বাচন করুন।
3. `Dry Run / Target Check` চালান। এটি Hostel ID, Auth Reference, Table/Column, Required Column, Primary Key ও Storage Access Read-only পরীক্ষা করবে।
4. Dry Run সফল হলে `RESTORE <Target Project Ref>` লিখে Restore চালু করুন।

### Interrupted Restore Resume

- একই `.hlbackup`, Password, Target Project এবং একই Workspace ব্যবহার করে আবার Dry Run করুন, তারপর Restore/Resume শুরু করুন।
- Restore Journal-এ Backup SHA-256, Target Ref, Step Status ও Object Hash থাকে; Password, Database URL বা API Key থাকে না।
- Database-এর marker এবং Local Journal মিলিয়ে আগের ধাপ পরীক্ষা হয়। Journal-এ Done কিন্তু Database marker অনুপস্থিত হলে Utility নিরাপত্তার জন্য থেমে যাবে।
- Storage ধাপ Resume-এর সময় প্রতিটি Object আবার Target-এর সঙ্গে Hash মিলিয়ে দেখে। একই Path-এ আলাদা Object থাকলে Overwrite করে না।
- Source Backup, Target Project, বা Workspace বদলালে নতুন আলাদা Workspace ব্যবহার করুন। Journal হাতে Edit করবেন না।

### Restore-এর পরে হাতে যাচাই

Master Restore শেষে `recovery_review` Folder-এ Recovery Checklist, Credential-সদৃশ Literal আড়াল করা Cron Job Command Review Copy এবং Remote Edge Function Source Snapshot পাবেন। মূল Cron Command কেবল এনক্রিপ্টেড Backup-এর ভেতরে থাকে। **Cron Job স্বয়ংক্রিয়ভাবে Enable/চালানো হয় না এবং Edge Function স্বয়ংক্রিয়ভাবে Deploy হয় না।** আগে Code/Secrets/Target URL পরীক্ষা করে হাতে Deploy/Configure করুন। Auth Provider, SMTP, Site URL/Redirect URL, Realtime Publication, non-default Extension, Vercel Environment/Domain, Vault/Encryption Root Key ও Custom Auth/Storage Trigger/RLS হাতে যাচাই করতে হবে। Active Session/Refresh Token ফেরে না; সদস্যদের পুনরায় Login করতে হবে।

## ৮. Restore-এর নিরাপত্তা সীমা

- Master Restore-এ `supabase db reset --linked`, `DROP`, `TRUNCATE` বা Database Reset চালানো হয় না।
- Master Restore-এর Target অবশ্যই Source থেকে আলাদা এবং নতুন/খালি হতে হবে।
- Hostel Restore কেবল একই/সামঞ্জস্যপূর্ণ Schema-তে যোগ করে; Duplicate Hostel বা Primary Key overwrite করে না।
- Restore-এ Target API Key ও Database Password শুধু Utility-র বর্তমান Process-এ থাকে; Journal/Log-এ লেখা হয় না।
- Windows/SSD থেকে Temporary Plaintext File Delete হলে Secure Erasure নিশ্চিত নয়। BitLocker ব্যবহার করুন।
- এই সংস্করণে Live Supabase Project-এ Restore বাস্তবে চালিয়ে পরীক্ষা করা হয়নি। Unit Test ও Mock/Local Logic Test হয়েছে; প্রকৃত Restore-এর আগে নতুন Test Project-এ পরীক্ষা বাধ্যতামূলক।

## ৯. Backup ও Restore-এর সীমাবদ্ধতা

1. Auth Active Session/Refresh Token Restore হয় না।
2. Storage File Content/Path ফেরত আসে; Storage owner ও generated metadata নতুন Upload API অনুযায়ী তৈরি হবে।
3. Auth Provider, SMTP, Redirect URL, Project API/JWT Key, Realtime Publication, non-default Extension, Edge Function Secret/Deploy, Vercel Environment/Domain এবং Vault Root/Encryption Key আলাদা করে Configure করতে হবে।
4. Custom Auth/Storage Managed Schema-এর অতিরিক্ত Trigger/RLS/Function হাতে যাচাই করুন।
5. `supabase_migrations`-এ Target-এ আগে থেকে History থাকলে স্বয়ংক্রিয় Restore বাদ দিয়ে Manual Review warning দেবে।
6. `psql` না থাকলে Master Restore চালানো যাবে না; Hostel Restore-এর জন্য `psycopg` Python Package যথেষ্ট।
7. Windows `.exe` এই Linux পরিবেশে Build করা হয়নি; Windows PC-তে `BUILD_EXE.bat` চালাতে হবে।

## ১০. Free Plan ও Backup অভ্যাস

- সপ্তাহে অন্তত একবার Master Backup এবং বড় Migration-এর আগে Backup রাখুন।
- মাস বন্ধের আগে/পরে প্রয়োজনমতো আলাদা Hostel Backup রাখুন।
- দুটি আলাদা কপি রাখুন: একটি PC-তে, আরেকটি আলাদা USB/নিরাপদ স্থানে।
- Backup Password Password Manager/Offline নিরাপদ স্থানে রাখুন।

## Official Docs

- Supabase Backup/Restore: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- Supabase Storage Download: https://supabase.com/docs/guides/storage/management/download-objects
