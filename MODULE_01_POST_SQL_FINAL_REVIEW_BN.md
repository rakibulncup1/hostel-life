# Hostel Life — Post-SQL Frontend Integration (পরীক্ষামূলক)

## কাজের ভিত্তি
মূল ভিত্তি: `Hostel_Life_Module_01_Pre_SQL_Handoff.zip`। এর সব আগের পরিবর্তন অক্ষত রেখে কাজ করা হয়েছে। Backend contract তুলনা: `Hostel_Life_Pro_Master_SQL_Audited.zip` এর `01_HOSTEL_LIFE_PRO_MASTER_REVIEWED.sql`।

## এই আপডেটে
- Super Admin Retention: SQL-এর `DELETE <period UUID>` confirmation-এর সঙ্গে UI মিলানো হয়েছে; পুরোনো `DELETE ARCHIVE` বাদ।
- Super Admin: মেয়াদোত্তীর্ণ Archive-এর জন্য তিনটি পৃথক ধাপ: সামারি সংরক্ষণ (`platform_admin_finalize_archive_summary`), নিজে যাচাই (`platform_admin_verify_archive_summary`), স্থায়ী অপসারণ (`platform_admin_delete_expired_archive`)। Server-এর Super Admin ও সময়সীমার যাচাই অপরিবর্তিত। কোনো স্বয়ংক্রিয় deletion নেই।
- Super Admin: সংরক্ষিত সামারির তালিকা (`platform_admin_list_saved_summaries`)।
- History: পূর্ববর্তী মাস পৃষ্ঠায় সদস্যের জন্য Retention নীতি (`get_retention_notice`) ও Final Summary (`get_archived_final_summaries`) দেখানোর read-only UI; RPC ব্যর্থ হলেও মূল History কাজ চালাতে পারবে।
- Mobile: আর্কাইভ কন্ট্রোল বোতাম ও summary layout responsive।

## ইচ্ছাকৃতভাবে অনিষ্পন্ন
- Temporary Password Reset: Audited SQL-তে privileged Edge Function deploy করা নেই। শুধুমাত্র browser থেকে admin password বদলানোর অনিরাপদ ব্যবস্থা তৈরি করিনি। এটি সম্পূর্ণ বলে ধরা যাবে না।
- মেয়াদোত্তীর্ণ archive deletion খুব উচ্চ-ঝুঁকির কাজ। সংরক্ষিত financial summary ম্যানুয়ালি মিলিয়ে এবং স্বাধীন backup নিশ্চিত না করে বোতাম ব্যবহার করবে না।
- SQL-এর `get_archived_final_summaries` শুধু aggregated data দেয়; কোনো বিস্তারিত ব্যক্তিগত লেনদেন এতে ফিরিয়ে আনা যায় না।
- সম্পূর্ণ ২৫টি সমস্যার visual, browser, database integration যাচাই করা সম্ভব হয়নি। এই build production-ready বলে দাবি করা হচ্ছে না।

## পরীক্ষা
- `npm test`: 29/29 পাস।
- `npm ci` সফল হয়নি (dependencies unavailable / npm fetch error)। তাই `npm run build` এবং real-browser testing অপরীক্ষিত।
- Backend লাইভ অ্যাক্সেস করা হয়নি।

## ব্যবহারের আগে
- আগের সফল চালু version backup রাখবে; আলাদা preview-তে চালাবে।
- ZIP root-এর মধ্যে `hostel-life-main/hostel-life-main` ফোল্ডারে `package.json` আছে।
- `npm ci`, `npm test`, `npm run build` এবং Super Admin/History-তে হাতেকলমে পরীক্ষা করবে।
