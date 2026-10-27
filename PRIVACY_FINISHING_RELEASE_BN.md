# Hostel Life — Privacy & Finishing Update (16 Oct 2026)

এই ZIP সর্বশেষ `Hostel_Life_Module_B_Frontend_Integrated.zip`-এর ওপর তৈরি। পূর্ববর্তী ফ্রন্টএন্ড পরিবর্তনগুলি রেখে নির্দিষ্ট ফাইল সংশোধন করা হয়েছে।

## Frontend-এ যুক্ত/সংশোধিত
- সাধারণ সদস্যের Directory Fetch থেকে `hl_b_member_public_profiles` অতিরিক্ত RPC বাদ দেওয়া হয়েছে; অন্য সদস্যের ছবি Dashboard-এ প্রকাশ করা হবে না। নিজের Account card-এ ছবি থাকবে; Super Admin-এর আগের সার্ভার-অনুমোদিত ছবির ব্যবস্থা অপরিবর্তিত। **সতর্কতা:** অন্য সদস্যের ছবি সত্যিকারভাবে গোপন রাখতে পুরোনো SQL RPC ও Storage Bucket-এর access policy আলাদা করে পরীক্ষা/সংশোধন করা দরকার। কেবল UI থেকে লুকানো পূর্ণ Access Control নয়।
- সাধারণ সদস্যের হিসাব ইতিহাসে শুধু নিজের হিসাব দেখানোর লেখা ও UI; `সবার হিসাব` Button বাদ। Accounting API-এর আগের server-side ownership rule অপরিবর্তিত।
- ছুটির দিনের Badge-এ `বন্ধ`-এর পরিবর্তে `ছুটির দিন`।
- Mobile request/day card overflow রোধের CSS। ডিভাইসের প্রকৃত পরীক্ষা বাকি।
- সব সদস্যের Meal Sheet-এ `1+0+2` বিন্যাস; Period label ও পূর্ণ Date Range আগের মতো header/subtitle-এ আছে।
- খালার টাকার তালিকায় যদি Server response-এ creator name উপস্থিত থাকে, দেখানো হবে। বর্তমান `get_khala_money_history_v2`-এ Creator Name নেই; **এটির পূর্ণ সমাধানে নতুন SQL লাগবে**, তাই মিথ্যা নাম দেখানো হয়নি।
- Ranking-এর শীর্ষ তিনজনের সামনে Trophy Emoji; Top Shopper RPC Load failure এখনো প্রকৃত response/error পরীক্ষা দরকার।
- Privacy Policy থেকে Developer-facing review note সরানো হয়েছে।
- Notification popover-এ `সব ডিলিট`: **শুধু নিজের সামনে লোড করা সর্বোচ্চ ৫০টি notification** ৪টি করে batch-এ `delete_my_notification` RPC দিয়ে মুছে দেয়। Manager-wide deletion ব্যবহার করা হয়নি; অন্য সদস্যদের notification অক্ষত রাখার চেষ্টা। আরো notification থাকলে পরের লোডে আবার মুছতে হবে।
- A4 Print margin 12.7mm (অর্ধ ইঞ্চি) অনুভূমিকভাবে, footer-এর জন্য 15mm নিচে স্থান। Browser-generated URL/print-time/page-header CSS দিয়ে মুছতে পারা যায় না; Chrome Print dialog > More settings > **Headers and footers OFF** করতে হবে।

## এখনো সম্পূর্ণ নয় — কারণ/পরবর্তী কাজ
- খালার টাকা কে জমা করেছেন: বর্তমান SQL RPC creator name দেয় না। এটি সার্ভারে Audit Source নির্ধারণ করে `get_khala_money_history_v2` extend করতে হবে।
- ৯টায় Finalized Late Meal মূল কার্ডে দেখা গেলেও `মোট মিল` ০: Supabase-এর actual `get_dashboard_data` ও finalization response মিলিয়ে server-side calculation পরীক্ষা করতে হবে; Frontend-এ কৃত্রিম সংখ্যা বসাইনি।
- Market Shopper ranking load failure: Network Error Response / RPC Signature যাচাই ছাড়া নিরাপদ পরিবর্তন নেই।
- Manager change / Member Join Notification-এ ব্যক্তির নাম: Database Trigger-এ name bind করতে হবে; Frontend notification text বানিয়ে পরিচয় অনুমান করা হবে না।
- অন্য সদস্যের avatar URL RPC/Storage-এ server-side access: সম্পূর্ণ Privacy Enforcement-এর জন্য SQL/Storage Migration প্রয়োজন।
- ৫০টির বেশি notification-এর জন্য এক-কল bulk-delete RPC ভবিষ্যতে করা যেতে পারে; বর্তমান পদ্ধতি correctness-এর সুবিধায় বিদ্যমান validated RPC ব্যবহার করে।

## Tests
- `node --test tests/*.test.js`: 29/29 passed.
- `npm run build`: হয়নি, `vite: not found` (dependencies locally installed নেই)। Deploy-এর আগে `npm ci && npm run build` চালিয়ে পরীক্ষা করো।
- Browser/Live Supabase testing করা হয়নি। SQL বা original backend migration পরিবর্তন করা হয়নি।
