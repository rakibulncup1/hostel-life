# Hostel Life — Google OAuth, ধাপ ১

এই প্যাকেজে Google Sign-In চালুর আগের public website identity ও legal disclosure প্রস্তুত করা হয়েছে। OAuth button/code বা কোনো credential এখনো যোগ হয়নি।

## ফাইলসমূহ

- `public/about.html` — Google-এর public homepage requirement পূরণে পণ্যের পরিচিতি পেজ
- `public/privacy-policy.html` — ডেটা-ব্যবহার ও ভবিষ্যৎ Google Sign-In disclosure-সহ Privacy Policy draft
- `public/terms-of-service.html` — Terms of Service draft
- `vercel.json` — `/about`, `/privacy-policy`, `/terms-of-service` public route rewrite
- `public/service-worker.js` — public documents-কে SPA app-shell cache-এর বদলে network-only করে
- `src/features/auth/AuthPage.jsx` ও `src/styles/public-entry.css` — login/register পেজে public policy links
- `src/features/menu/MenuPages.jsx` — ভুল করে পুরো website URL public sharing নিষিদ্ধ করা in-app term ঠিক করা হয়েছে; private Join Code/Invitation Link গোপন রাখার নিয়ম রাখা হয়েছে
- `GOOGLE_OAUTH_STAGE1_SETUP_BN.md` — Google Cloud Console, Supabase Provider, Search Console ও test checklist
- `tests/googleOauthPublicInfoPages.test.js` — নতুন regression tests

## প্রকাশের আগে থামুন

Privacy Policy ও Terms-এ আইনগত owner, বাস্তব Support/Privacy email এবং প্রকৃত Supabase region-এর placeholder আছে। এগুলো পূরণ না করে deploy/Google verification-এ জমা দেবেন না। ১৮ বছরের কম বয়সী ব্যবহারকারীদের তথ্য প্রক্রিয়াকরণের জন্য guardian-consent ব্যবস্থা বর্তমান registration flow-তে নেই; প্রয়োজন হলে এই workflow আগে বাস্তবায়ন ও পর্যালোচনা করতে হবে।

## প্রস্তাবিত ধাপ

1. মূল Project ও Database backup নিন।
2. Patch ZIP-এর path অনুযায়ী ফাইলগুলো project root-এ overlay করুন।
3. Placeholder পূরণ ও আইনগত review সম্পন্ন করুন।
4. Development deployment-এ `/about`, `/privacy-policy`, `/terms-of-service` logged-out অবস্থায় খুলে পরীক্ষা করুন।
5. নিজস্ব domain দিয়ে production branding verification প্রস্তুত করুন। বর্তমান `hostellife-bd.vercel.app` shared subdomain; ownership verification নিশ্চিত নয়।
6. Google Cloud Project/Audience/Branding/Web OAuth Client তৈরি করুন; Google Client Secret শুধু Supabase Dashboard-এর Google Provider-এ রাখুন।
7. পরবর্তী পৃথক ধাপে existing email/password login অক্ষত রেখে Google sign-in flow implement করুন।

**No migration. No Edge Function change. No Google credential included. No Production change.**
