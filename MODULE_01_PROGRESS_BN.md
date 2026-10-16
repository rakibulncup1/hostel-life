# Hostel Life · Module 01 · Source review + compatibility fixes

**অবস্থা:** নিরাপদ পরীক্ষামূলক Frontend সংস্করণ। সব ২৫টি সমস্যা সমাধান সম্পন্ন নয়। এটি Production-ready সার্টিফিকেশন নয়।

## এই ZIP-এর ভিত্তি
আগে সরবরাহ করা Hostel_Life_Module_1_Review.zip-এর সম্পূর্ণ Frontend। আগের কার্যকর কল ও routes অক্ষত রেখে ছোট, সুনির্দিষ্ট পরিবর্তন যুক্ত করা হয়েছে। কোনো SQL/লাইভ Database পরিবর্তন করা হয়নি।

## এই পর্যায়ে নতুন পরিবর্তন
- Super Admin overview-এর **প্রমাণিত JSON key mismatch** ঠিক: SQL-এ `hostel_count`, `member_count`, `blocked_user_count`, `suspended_hostel_count` থাকলেও UI ভুল করে `hostels`, `active_memberships`, `blocked_users`, `suspended_hostels` পড়ত। এখন উভয় version সমর্থিত, অনুপস্থিত তথ্য `—` দেখায়, ভুল ০ নয়।
- Profile avatar upload: auth session-এর user ID fallback; প্রোফাইলে ID না এলে নিরব no-op নয়, উপযোগী বার্তা। Password verification-এর সময় Auth email fallback।
- Late-request modal-এর স্ক্রলিংয়ে keyboard focus ও mobile max-height নিয়ন্ত্রণ।
- PDF print table wrapping, heading page break ও print color সামঞ্জস্যে পরিমার্জন। Browser PDF output বাস্তবে বিভিন্ন browser/প্রিন্টার সেটিংসে আলাদা হতে পারে।
- Mobile section headers-এর CSS এবং দীর্ঘ লেখা ভাঙার নিয়মে সীমিত পরিমার্জন।
- নতুন তিনটি overview unit test।

## পুরোনো review ZIP থেকে বহাল থাকা পরিবর্তন
Header, theme, offline dashboard সীমা, page heading, archive helper text, branding, login/register ও late request প্রাথমিক সংশোধন। সেই সংশোধনগুলো আলাদাভাবে end-to-end যাচাই করা হয়নি।

## ২৫টি issue: বর্তমান যাচাইকৃত অবস্থা
১. Section heading/back: আংশিক UI সংশোধন, সমস্ত route manually audited নয়।
২. Archive helper text: আগের review থেকে সংশোধিত; রিগ্রেশন পরীক্ষা বাকি।
৩. Archive limited/full access: Backend authorization ও history actions পর্যালোচনা বাকি; সম্পন্ন নয়।
৪. Menu guide/help: আগের review-এ আংশিক; বিস্তৃত কন্টেন্ট পর্যালোচনা বাকি।
৫. ১৪ তারিখ close → ১৫ তারিখ start: Existing frontend `deriveNextRequiredStartDate` সঠিকভাবে last end+1 নির্ণয় করে, কিন্তু backend-এর বাস্তব context/server behavior যাচাই ও সংশোধন লাগতে পারে; সম্পন্ন নয়।
৬. All-member expense history visibility: Backend permission যাচাই ছাড়া সম্পন্ন নয়।
৭. A4 report: CSS/branding উন্নতি; print preview ও দীর্ঘ রিপোর্টের বাস্তব পরীক্ষা বাকি।
৮. Mobile page headings: CSS আংশিক, সব পেজ device test বাকি।
৯. Super Admin: overview JSON key mismatch ঠিক হয়েছে; বাকি retention/storage/password controls এবং admin-only block permission server-side দরকার।
১০. Archived khala money lock: backend permission অপরিহার্য।
১১. Profile: auth email ও avatar ID fallback ঠিক; Supabase Storage policies/bucket আলাদাভাবে যাচাই করতে হবে।
১২. No-running-month card: অপ্রয়োজনীয় আলাদা summary-note সরানো হয়েছে; সব UI state যাচাই বাকি।
১৩. Blink/splash: running month identity loading states পুনরায় পরীক্ষা বাকি।
১৪. Dashboard cards density: বিস্তারিত redesign বাকি।
১৫. Login/register visual: আগের review-এ আংশিক।
১৬. Activity notification: Backend-triggered audit/notifications অপরিহার্য।
১৭. Market entry mobile item numbering: বিস্তারিত redesign বাকি।
১৮. Dark/light themes: আগের review-এর ওপর CSS; contrast/accessibility audit বাকি।
১৯. Mobile auth full-bleed: আগের review-এ আংশিক, mobile screenshots বাকি।
২০. Assistant manager duplicate initial: সন্দেহভাজন visual, আসল কারণ যাচাই বাকি।
২১. Retention 2+6 month, admin approval: Backend schema/report/notification পরিকল্পনা দরকার; destructive action তৈরি করা হয়নি।
২২. User activity tracking: অতিরিক্ত লগ এখন যুক্ত করা হয়নি (Free plan বিবেচনায়)।
২৩. Request cost: Realtime refresh throttle পূর্বের কোডে আছে; Network profiling বাকি।
২৪. Offline 2 cards: dashboard snapshot সীমিত; Offline state-এ account/member details আর দেখায় না। অন্য IndexedDB store পুনর্বিবেচনা বাকি।
২৫. Late request scrolling: modal CSS ও keyboard scroll পরিমার্জিত; বাস্তব mobile test বাকি।

## যাচাই
`npm test`: ২৯/২৯ পাস। `npm ci --offline` cache-এ dependency না থাকায় ব্যর্থ, তাই `npm run build` চালানো যায়নি। Vercel/Localhost device test ও live Supabase integration test এখানে করা হয়নি।

## চালানোর আগে
১. পুরোনো deploy ও database-এর backup রাখুন। ২. আলাদা git branch/preview deployment-এ নতুন ফাইল বসান। ৩. `.env` থেকে Supabase URL/key নিজে সেট করুন, কখনো secret/service-role key frontend-এ দেবেন না। ৪. Login, profile upload, overview, history, month transition, report print যাচাই করুন। ৫. SQL migration এখনো তৈরি করা হয়নি এবং কিছু feature কাজ করবে না যতক্ষণ backend যুক্ত না হয়।

## Backend migration-এর আগে সংগ্রহযোগ্য
Production DB-এর read-only schema/function inventory ও user-permissions যাচাই দরকার। প্রয়োজন হলে SQL read-only query ব্যবহার করে আগে যাচাই করতে হবে; সরাসরি পুরোনো Master SQL চালানো যাবে না।
