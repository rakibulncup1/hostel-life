# Hostel Life — Module A (Frontend Stabilization)

ভিত্তি: `Hostel_Life_Integrated_Finishing_Release.zip` (সর্বশেষ সফলভাবে চালানো Frontend)। আগের ফিচার/Edge Functions/Services সংরক্ষিত। এই ZIP আগের কোনো আপডেট ZIP-এর ওপর আলাদা করে বসাতে হবে না।

## বাস্তবে কোড পরিবর্তন করা হয়েছে
1. সাধারণ রিপোর্টের A4 margin ১২.৭ মিমি (০.৫ ইঞ্চি); ফুটার ও হেডারের spacing কমিয়ে overlapping ঝুঁকি কমানো।
2. Deposit ও Full Monthly Report-এর জোরপূর্বক Landscape বাদ; Portrait A4 নির্ধারণ।
3. All Members Meal Sheet-এ সদস্য=সারি ও period-এর প্রকৃত দিন=কলাম; প্রতি ঘরে সকাল/দুপুর/রাত। Landscape A4। Individual Meal Sheet আগের দৈনিক টেবিলসহ Portrait A4। Month boundary cross করলে header-এর পূর্ণ তারিখ title-এ রাখা হয়।
4. Assistant Manager selection-এ নামের প্রথম অক্ষরের অপ্রয়োজনীয় অতিরিক্ত glyph বাদ দিয়ে icon।
5. Super Admin-এর মোবাইল ট্যাবগুলো ২-কলামের responsive grid (স্ক্রিনের বাইরে ডানে ঠেলে না দেওয়া)।
6. Dashboard Member Card ও My Account-এ RPC data-তে `avatar_url` থাকলে ছবি; না থাকলে আগের initials। কোনো নতুন Supabase table বা অননুমোদিত profile query করা হয়নি।
7. আগামীকালের নতুন মাস আজই চালু না করার Frontend guard ও সতর্কবার্তা; বাংলাদেশি তারিখ ব্যবহার। এ সীমাবদ্ধতা নিরাপত্তার জন্য Backend-এও লাগবে।

## Backend/Edge Function আপডেট ছাড়া সম্পূর্ণ করা নিরাপদ নয়
- বন্ধ মাসের Pending/Approved ভবিষ্যৎ Meal Request নিষ্পত্তি এবং পূর্ববর্তী দিন/পরবর্তী period-এর record conflict: SQL authoritative rules দরকার।
- Archive Manager list, Closed Period পুনরায় Open, Previous Manager Permission: বিদ্যমান RPC-এর কার্যকর ফল ও authorization যাচাই, প্রয়োজনে Incremental SQL।
- Shared Avatar: RPC-তে avatar_url আসছে কি না, storage object public policy নিরাপদ কি না—যাচাই; কারও ব্যক্তিগত ছবি নতুন permission ছাড়া ছড়ানো হয়নি।
- Same calendar month part numbering: Archived period listing/labels-সহ UI+SQL alignment বাকি।
- Super Admin permanent Hostel/User deletion: irreversible; dependency ও Auth administration যাচাই সাপেক্ষে Server-side handler দরকার।
- Temporary password: Edge Function deployment/authentication বাস্তবে যাচাই করতে হবে।
- Super Admin email/avatar: API read permission ও privacy requirement যাচাই করে করা উচিত।

## পরীক্ষার ফলাফল
- `npm test` : 29 passed, 0 failed.
- `npm ci --offline`: NPM registry cache-এর একটি প্যাকেজ অনুপস্থিত। Online attempt-এ npm নিজস্ব exit-handler error হয়েছে। তাই production `vite build` সফল হয়েছে বলা হচ্ছে না।
- Live Supabase/Browser/Print testing এখানে হয়নি।

## Deployment
- **বর্তমান Production frontend প্রতিস্থাপন না করে Vercel Preview branch-এ প্রথমে টেস্ট করুন।** Preview একই Supabase ব্যবহার করলে mutations আসল ডেটাবেজে প্রভাব ফেলবে।
- Print dialog-এ Paper=A4, browser header/footer বন্ধ এবং scaling যাচাই করে PDF পর্যবেক্ষণ করুন।
- নতুন SQL চালানোর নির্দেশ নেই।
