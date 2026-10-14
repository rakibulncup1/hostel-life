# Hostel Life — Combined Frontend Recovery

এই ZIP-টি Vercel deploy এবং local-host frontend-এর তুলনা করে তৈরি করা সমন্বিত frontend source package।

**প্রথমে পড়ুন:** `COMBINED-RECOVERY-README-BN.md` — পরিবর্তন, local setup, deployment checklist ও সীমাবদ্ধতা।

**কোড তুলনা:** `COMPARISON-REPORT-BN.md`

**পরীক্ষার ফল:** `TEST-RESULTS-BN.md`

## Local run

1. `.env.example`-এর কপি `.env.local` নামে তৈরি করুন।
2. আপনার Supabase project URL ও public publishable/anon key দিন। `service_role` key কখনো frontend-এ দেবেন না।
3. `npm ci`
4. `npm test`
5. `npm run dev`
6. Production bundle যাচাই করতে `npm run build` চালান।

`diagnostics/`-এ শুধু read-only SQL আছে। এই প্যাকেজে Supabase migration অন্তর্ভুক্ত নয় এবং frontend পরীক্ষা করতে কোনো নতুন SQL চালানোর দরকার নেই। নতুন মেসে বাজার edit-এ database permission error হলে আগে read-only diagnostic চালিয়ে ফলাফল যাচাই করুন; অনুমান করে SQL function/policy পরিবর্তন করবেন না।
