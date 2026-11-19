HOSTEL LIFE — RUN68 PUBLIC SITE / CODE-NATIVE ABOUT PATCH
========================================================

কোন Baseline-এর জন্য
--------------------
এই Patch টি Run67-এ চলমান Project-এর ওপর তৈরি। প্রথমে আপনার বর্তমান Project-এর পূর্ণ Backup রাখুন।

এই Patch-এর কাজের পরিধি
----------------------
1. About/Landing page-এর ৯টি app-screen visual screenshot থেকে HTML/CSS code-native preview-তে রূপান্তর করা হয়েছে:
   - ২টি hero preview
   - ৪টি feature preview
   - ৩টি management/report preview
   প্রতিটি preview নমুনা হিসেবে চিহ্নিত; উদাহরণ সংখ্যা বাস্তব সদস্য বা হিসাবের তথ্য নয়।
2. About page-এর দৃশ্যমান কপিতে stable data-i18n-key, accessibility label-এ data-i18n-aria-label-key এবং meta description/social metadata-তে localization hooks যোগ করা হয়েছে।
3. PUBLIC_ABOUT_LOCALIZATION_KEYS_BN.md-তে key ও বর্তমান বাংলা কপির inventory দেওয়া হয়েছে। এটি ভবিষ্যৎ Language Switch-এর জন্য reference; এই Patch-এ Language Switch চালু করা হয়নি।
4. Privacy Policy ও Terms of Service-কে existing canonical source src/content/legalDocuments.js থেকে generate করার ব্যবস্থা অক্ষুণ্ন রাখা হয়েছে। Generator-generated public pages-এ localization keys যোগ করা হয়েছে এবং visual design responsive করা হয়েছে।
5. Public Login/Registration page-এর Desktop frame সামান্য compact করা হয়েছে। শুধু public auth stylesheet বদলেছে; login/register component, authentication logic বা in-app layout বদলায়নি।

যা পরিবর্তন করা হয়নি
--------------------
- src/content/legalDocuments.js-এর আসল Privacy/Terms copy পরিবর্তন করা হয়নি।
- কোনো SQL migration, database schema, Supabase function বা RPC পরিবর্তন নেই।
- Dashboard, Dining, Meal Mode, Notification, Telegram, Join/Approval বা authenticated app feature পরিবর্তন নেই।
- About page-এ ব্যবহৃত পুরোনো app-screen .webp ফাইলগুলো Project থেকে মুছে দেওয়া হয়নি; About HTML-এ সেগুলোর reference আর নেই। Brand SVG এবং social-share artwork রাখা হয়েছে।

ইনস্টল
------
1. Run67 Project-এর Backup নিন।
2. ZIP Extract করে ভেতরের file/folder-গুলো Project Root-এ একই path-এ Replace করুন।
3. কোনো SQL Migration চালাতে হবে না।
4. আপনার development environment-এ dependencies থাকলে `npm test` চালান।
5. Production build-এর জন্য `npm ci` এবং তারপর `npm run build` চালান। Build সফল হলে Deploy করুন।

Generator
---------
Build script আগে scripts/generate-public-legal-pages.mjs চালায়। Privacy/Terms-এর মূল লেখা ভবিষ্যতে বদলাতে হলে src/content/legalDocuments.js-এ পরিবর্তন করুন; generated public HTML আলাদা করে edit করবেন না। Generator দুইবার চালিয়ে একই HTML output থাকার পরীক্ষা করা হয়েছে।

যাচাইয়ের সারাংশ
---------------
- Focused Run68 tests: 4/4 Passed
- Full Node test suite: 844/854 Passed
- বাকি 10টি ব্যর্থ test-এর নাম Run67 pristine baseline-এর 10টি failure-এর সঙ্গে হুবহু একই; নতুন failure যোগ হয়নি।
- About, Privacy ও Terms HTML parse checks: Passed
- Public CSS এবং public auth CSS parse checks: Passed (tinycss2, no syntax errors)
- Legal page generator idempotency: Passed
- ZIP integrity এবং SHA-256: প্যাকেজ তৈরির পরে যাচাই করতে হবে/করা হয়েছে

গুরুত্বপূর্ণ সীমাবদ্ধতা
---------------------
এই working environment-এ Vite executable/node_modules অনুপস্থিত থাকায় `npm run build` সম্পন্ন করা যায়নি। তাই Deploy-এর আগে নিজের machine/CI-তে `npm ci` ও `npm run build` সফল হওয়া নিশ্চিত করুন।
