# Hostel Life — Google OAuth Readiness Patch (Stage 1)

**তারিখ:** ৪ নভেম্বর ২০২৬  
**ধরন:** Cumulative source patch (v6-এর সব ফাইল + Google OAuth প্রস্তুতি)  
**Database migration:** নেই  
**Edge Function পরিবর্তন:** নেই  
**Google OAuth code/credential:** নেই  
**Production-এ পরিবর্তন:** করা হয়নি

## এই প্যাচের উদ্দেশ্য

Google Sign-In যোগ করার আগে সাইটে public, logged-out অবস্থায় খোলা যায় এমন পরিচিতি, Privacy Policy ও Terms of Service পেজ তৈরি করা এবং Google Cloud Console/Supabase setup-এর জন্য বাংলায় পূর্ণ গাইড দেওয়া। এই প্যাচ OAuth সক্রিয় করে না; পরবর্তী ধাপে বিদ্যমান email/password login অক্ষত রেখে Google Sign-In button ও callback যোগ করা হবে।

## নতুন public পেজ

- `public/about.html` → `/about`
- `public/privacy-policy.html` → `/privacy-policy`
- `public/terms-of-service.html` → `/terms-of-service`

পেজগুলো responsive, Bengali `bn-BD`, accessible navigation-সহ এবং external script/font/analytics ছাড়াই তৈরি। Homepage-এ বাস্তব product functionality এবং privacy/terms links আছে।

## Frontend ও hosting পরিবর্তন

- `vercel.json`: public documents-এর clean routes catch-all SPA rewrite-এর আগে যোগ করা; policy pages-এর cache/revalidation ও basic response headers যোগ।
- `public/service-worker.js`: cache contract v18; public legal pages network-only, যেন `/index.html` app-shell cache-এ ভুল HTML জমা না হয়।
- `src/features/auth/AuthPage.jsx` এবং `src/styles/public-entry.css`: Login/Registration-এর আগে থেকেই visible public About/Privacy/Terms links।
- `src/features/menu/MenuPages.jsx`: authenticated in-app Terms-এ সাধারণ app URL শেয়ার নিষিদ্ধ করার ভুল wording সংশোধন; private Join Code/Invitation Link গোপন রাখার নিয়ম বহাল। Privacy/Terms in-app screen থেকে পূর্ণ public documents-এ লিংক।

## Google Cloud / Supabase guide

- `GOOGLE_OAUTH_STAGE1_SETUP_BN.md`: Google Cloud project, Google Auth Platform Branding, External audience, basic OIDC scopes, Web OAuth client, Supabase provider, redirect allowlist, testing, Search Console/domain verification, production checklist এবং ভবিষ্যৎ TOTP MFA-র পৃথক ব্যাখ্যা।
- `README_GOOGLE_OAUTH_STAGE1_BN.md`: সংক্ষিপ্ত apply order ও pre-launch warning।

## গুরুত্বপূর্ণ placeholder ও compliance blocker

Privacy/Terms-এ তিনটি placeholder ইচ্ছাকৃতভাবে রাখা হয়েছে:

1. প্রকৃত আইনগত সেবা পরিচালনাকারীর নাম/প্রতিষ্ঠান
2. বাস্তব, নিয়মিত দেখা হয় এমন Privacy/Support email
3. Supabase Dashboard-এ যাচাই করা প্রকৃত project region

এগুলো পূরণ না করে public Production deploy বা Google Brand Verification-এ জমা দেবেন না। বর্তমান registration flow-এ under-18 guardian consent verification নেই; ১৮ বছরের কম বয়সী ব্যবহারকারীর তথ্য প্রক্রিয়াকরণের আগে আইনসম্মত guardian-consent ও safeguarding ব্যবস্থা চালু ও review করতে হবে।

বর্তমান `hostellife-bd.vercel.app` একটি shared Vercel subdomain; Google Search Console-এর DNS ownership verification আপনার নিজের domain না হলে বাধাগ্রস্ত হতে পারে। Production Branding-এর আগে নিজস্ব domain-এর ownership ও DNS control নিশ্চিত করা সুপারিশ করা হচ্ছে।

## Credential ও নিরাপত্তা

- কোনো Client ID/Client Secret এই প্যাচে রাখা হয়নি।
- Google Client Secret কখনো `VITE_` variable, browser code, GitHub বা public screenshot-এ দেবেন না; Supabase Dashboard-এর Google provider server-side configuration-এ রাখবেন।
- `.gitignore`-এ `.env` ও local env files উপেক্ষিত থাকে; commit-এর আগে `git status` ও repository secret scan করুন।
- Google scopes কেবল `openid`, `email`, `profile`; Gmail/Drive/Contacts/Calendar/Photos scope নেই।

## Regression test

নতুন `tests/googleOauthPublicInfoPages.test.js` public pages, homepage links, disclosures, route order, service worker behavior, auth footer links ও credential guidance যাচাই করে। পুরোনো Terms ও service-worker version tests নতুন আচরণের সঙ্গে সামঞ্জস্য করা হয়েছে।

## Apply order

1. Original project ও database backup রাখুন।
2. এই ZIP project root-এ extract/overlay করুন; ফোল্ডার কাঠামো অক্ষত রাখুন।
3. Placeholder পূরণ ও দায়িত্বশীল প্রাপ্তবয়স্ক/আইনগত owner-এর review সম্পন্ন করুন।
4. Vercel Preview/Development-এ deploy করে logged-out অবস্থায় তিন public path পরীক্ষা করুন।
5. custom domain, Search Console ও Cloud branding প্রস্তুত করুন।
6. পরবর্তী পৃথক ধাপে Google OAuth code যোগ করুন।

**এই প্যাচে কোনো migration চালানোর প্রয়োজন নেই।**
