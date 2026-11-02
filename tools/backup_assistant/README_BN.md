# Hostel Life Backup Assistant — বাংলা নির্দেশনা

এই Utility-টি Windows কম্পিউটারে Master Backup ও নির্বাচিত মেসের Logical Backup তৈরি করে। Backup ফাইল আপনার কম্পিউটার/USB-তে থাকে; Supabase Storage-এ ফেরত আপলোড করা হয় না। কোনো Restore/Overwrite সুবিধা এই Module-এ নেই। Restore আলাদা Module 2-তে হবে।

## ১. কী কী লাগবে

- Windows 10/11 64-bit
- Python 3.11 বা নতুন সংস্করণ (Tkinter নির্বাচনসহ)
- Node.js 20.19 বা নতুন সংস্করণ এবং `npx` / Supabase CLI
- Docker Desktop চালু থাকতে হবে (Supabase CLI Database Dump-এর জন্য)
- Database Connection String
- Supabase Project URL ও Project Ref
- Storage Object পড়ার জন্য Supabase `sb_secret_...` Key (সুপারিশকৃত) অথবা Legacy `service_role` JWT Key
- কমপক্ষে ১২ অক্ষরের Backup Encryption Password
- ঐচ্ছিক: পুনর্ব্যবহারযোগ্য HMAC/SMTP Secret-এর জন্য আলাদা Text/ENV File

## ২. Supabase CLI একবার Login

প্রথমে Command Prompt/PowerShell খুলে চালান:

```powershell
npx --yes supabase@2 login
```

Supabase-এর Personal Access Token দিয়ে Login সম্পন্ন করুন। CLI সাধারণত Native Credential Storage ব্যবহার করে; সেটি না থাকলে `~/.supabase/access-token`-এ Plain Text Token রাখতে পারে। Backup Utility ওই ফোল্ডার কপি করে না; নিজের Windows Account ও PC সুরক্ষিত রাখুন।

তারপর Docker Desktop চালু করুন। Utility-তে `প্রয়োজনীয় Tool পরীক্ষা` চাপুন।

## ৩. Utility চালু

এই ফোল্ডারের `RUN_BACKUP_ASSISTANT.bat` ডাবল-ক্লিক করুন। প্রথমবার প্রয়োজনীয় Python Package ইনস্টল হবে, এরপর GUI চালু হবে। বিকল্পভাবে `py -3 backup_assistant.py` চালাতে পারেন।

## ৪. Master Backup

1. Supabase Project URL এবং Project Ref দিন।
2. Database Connection String দিন। এটি সাধারণত Supabase Dashboard → Connect থেকে নেবেন। Password-সহ Connection String Utility-তে মাস্ক করা থাকে; কোনো Log বা Backup Manifest-এ লেখা হয় না।
3. Storage পড়ার জন্য `sb_secret_...` Key দিন; Legacy `service_role` JWT-ও সমর্থিত। এটি শুধু স্থানীয় Utility-তে ব্যবহৃত হয় এবং Backup শেষ হলে ফিল্ড পরিষ্কার হয়। Secret Key RLS bypass করে, তাই এটি Website, Chat বা Source Code-এ দেবেন না।
4. আপনার সর্বশেষ Hostel Life Project Folder নির্বাচন করুন। `.git`, `node_modules`, `dist`, `.vercel` এবং `.env` ফাইল বাদ থাকবে; `.env.example`, Source, SQL Migration, Edge Function ও PWA Asset থাকবে।
5. লোকাল/USB Backup Folder নির্বাচন করুন।
6. ১২+ অক্ষরের Backup Password দুইবার দিন। Password হারালে Backup Decrypt করা যাবে না।
7. চাইলে ঐচ্ছিক Reusable Secrets File নির্বাচন করতে পারেন। এতে এমন HMAC/SMTP/অন্যান্য গোপন মান রাখুন যা নতুন Project-এও ব্যবহার করতে চান; পুরোনো Database Password ও Project API Key নতুন Project-এ পুনর্ব্যবহার করবেন না। নির্বাচিত ফাইলটি AES-256-GCM এনক্রিপ্টেড Backup-এর ভেতরে থাকবে।
8. `Full Master Backup তৈরি করুন` চাপুন।

Master Backup-এ আলাদা করে থাকবে:

- Supabase CLI roles/schema/data dump
- Auth `users`, `identities` এবং উপস্থিত থাকলে `mfa_factors`-এর encrypted JSON data (Password Hash-সহ)
- Storage Bucket metadata ও আসল Object File
- Local Website Source, SQL Migration এবং Edge Function Source
- সম্ভব হলে Remote Edge Function Source Snapshot
- Database Extension, Publication, Version ও Table Inventory
- Manual Reconfiguration Checklist
- Manifest ও প্রতিটি ফাইলের SHA-256 Hash

**নিরাপত্তা:** `.env`, `.env.local`, Service/Secret API Key, Database Password এবং CLI Access Token Backup Source Folder থেকে কপি করা হয় না। Auth Password Hash এনক্রিপ্টেড Backup-এর ভেতরে থাকে। কেবল তুমি আলাদা করে Reusable Secrets File নির্বাচন করলে সেটির কন্টেন্ট এনক্রিপ্টেড Backup-এ যাবে। তবে Backup তৈরির সময় নির্বাচিত Drive-এ অস্থায়ী Plaintext Staging ফাইল থাকে; কাজ শেষে Folder মুছে ফেলা হয়, কিন্তু SSD/Windows থেকে Secure Erasure নিশ্চিত নয়। তাই BitLocker-সুরক্ষিত Drive/USB ব্যবহার করুন।

## ৫. Hostel Backup

1. Database URL ও Project URL দিন।
2. `Database থেকে মেসের তালিকা লোড করুন` চাপুন।
3. একটি মেস নির্বাচন করুন।
4. Backup Password ও Destination নির্বাচন করে Backup তৈরি করুন।

Hostel Backup-এ নির্বাচিত মেসের সম্পর্কিত `public`/`private` টেবিলের রেকর্ড এবং সেই মেসের সদস্যদের `profile-avatars` ছবি থাকবে। `hostel_id` এবং Foreign Key সম্পর্ক ধরে নিচের দিকে ডেটা সংগ্রহ হয়। অন্য মেসে উপরের দিকে অনুসন্ধান করা হয় না।

Hostel Backup-এ Auth User Account/Password Hash, Global Settings, Global Audit, Edge Function বা Website Source নেই। এটি একই বা সামঞ্জস্যপূর্ণ Hostel Life Database Schema-তে ভবিষ্যৎ Restore-এর জন্য। সংশ্লিষ্ট Auth User ID Target Project-এ আগে থাকতে হবে।

## ৬. Verify Backup

`Verify Backup` Tab-এ `.hlbackup` ফাইল নির্বাচন ও Password দিন। Utility AES-256-GCM Authentication, ZIP Structure এবং প্রতিটি ফাইলের SHA-256 যাচাই করবে। সফল হলে Backup ফাইলটি অক্ষত আছে বলে নিশ্চিত হওয়া যাবে; এটি কোনো Live Database Restore করে না।

## ৭. Free Plan ও Resource ব্যবহার

- Backup কম ব্যবহার সময়ে নিন।
- Master Backup চলাকালে Database Export একের পর এক হয়, Parallel Dump নয়।
- Storage Object একবারে একটি করে ডাউনলোড হয়; অপ্রয়োজনীয় concurrency নেই।
- Backup সরাসরি Local Disk/USB-তে হয়; Supabase Storage বা Database-এ Backup Row লেখা হয় না।
- Backup তৈরির সময় নির্বাচিত Backup Drive-এ সাময়িক Plaintext Staging ফাইল থাকে; কাজ শেষে Work Folder মুছে যায়। Windows/SSD থেকে Delete হওয়া ফাইল নিরাপদে Overwrite হয়েছে—এমন নিশ্চয়তা নেই। তাই BitLocker/Device Encryption চালু থাকা Drive বা USB নির্বাচন করুন।
- সপ্তাহে একবার Master Backup এবং বড় SQL Migration-এর আগে একটি Backup দিয়ে শুরু করতে পারেন।
- Backup-এর দ্বিতীয় কপি আলাদা USB বা অন্য নিরাপদ জায়গায় রাখুন। শুধু একই কম্পিউটারে রাখবেন না।

## ৮. গুরুত্বপূর্ণ সীমাবদ্ধতা

1. এই Module Backup তৈরি ও যাচাই করে; Restore Module 2-তে হবে।
2. Auth User ও Identity Data অন্তর্ভুক্ত, কিন্তু Active Session/Refresh Token অন্তর্ভুক্ত নয়। নতুন Supabase Project-এ সদস্যদের পুনরায় Login করতে হবে।
3. Supabase Auth/Storage-এর Managed Schema পুরোপুরি নতুন করে তৈরি করা হয় না; নতুন Supabase Project-এর Managed Service Schema ব্যবহার করে প্রয়োজনীয় Data/Customization Restore Module 2-তে হবে।
4. Supabase Site URL, Auth Redirect URL, SMTP, Enabled Provider, Realtime Publication, Edge Function Secret, Vercel Environment Variable, Custom Domain এবং Vault/Encryption Root Key-এর মতো Platform Settings আলাদা করে পুনরায় Configure করতে হতে পারে। Backup-এর ভেতরের `recovery/MANUAL_RECONFIGURATION_CHECKLIST.md` দেখুন।
5. Supabase CLI Login, Docker Desktop এবং Database Connection ঠিক থাকতে হবে।
6. Backup Password হারালে AES-256-GCM Archive উদ্ধার করা যাবে না। Password আলাদা নিরাপদ Password Manager/Offline স্থানে রাখুন।
7. Database ও Storage Backup-এ ব্যক্তিগত তথ্য এবং Password Hash থাকে। Backup ফাইল অন্য কাউকে পাঠাবেন না।
8. Backup History শুধু লোকাল `backup_history.json`-এ থাকে; Cloud বা Web App-এ পাঠানো হয় না।

## ৯. নতুন EXE বানাতে চাইলে

Windows-এ `BUILD_EXE.bat` চালান। PyInstaller প্রয়োজনীয় Package ইনস্টল করে `dist/HostelLifeBackupAssistant.exe` তৈরি করবে। এই Linux development environment থেকে Windows EXE তৈরি করা হয়নি; Windows-এ Build Script চালাতে হবে।

## Official Docs

- Supabase Backup: https://supabase.com/docs/guides/platform/backups
- Supabase CLI Backup/Restore: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- Storage Download: https://supabase.com/docs/guides/storage/management/download-objects
