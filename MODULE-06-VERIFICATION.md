# Module 06 Verification

## Static verification completed
- JavaScript/JSX syntax/transpile check: PASS for all 43 JS/JSX source files.
- All relative source imports resolve to existing files.
- Manager and report service exports match their consumers.
- Module 06 RPC names match the final Master SQL signatures.
- Service worker cache version bumped to `v6`.
- No `.env.local`, service-role key, secret key, `node_modules`, or build cache is packaged.
- ZIP integrity check will be performed after packaging.

## Database patch included
`supabase/MODULE-06-DATABASE-PATCH.sql` safely replaces the manager market edit/void functions so repeated corrections reverse only still-active market-deposit ledger rows. Run this patch once in Supabase SQL Editor before testing Manager market correction/void. Do not rerun the full Master SQL.

## PC runtime verification
Run:

```powershell
npm install
npm run dev
npm run build
```

Then test:
- নতুন মাস শুরু / archive transition
- ম্যানেজার পরিবর্তন
- সদস্য নিষ্ক্রিয় / পুনরায় সক্রিয়
- মেসের নাম / যুক্ত হওয়ার কোড পরিবর্তন
- খালার টাকা যোগ / সম্পাদনা / বাতিল
- আর্কাইভ সম্পাদনার অনুমতি grant / revoke
- হিস্টরি থেকে manager market / ledger / khala correction
- মিল শিট ও রিপোর্ট CSV
- প্রিন্ট/PDF flow
- online/offline restrictions
- PWA installation and Dashboard Meal Card offline cache
