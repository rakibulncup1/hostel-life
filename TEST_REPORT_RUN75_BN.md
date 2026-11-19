# Hostel Life — Run75 Test Report

## Targeted Run75 tests

| Result | Count |
|---|---:|
| Passed | 9 |
| Failed | 0 |

নতুন targeted tests যাচাই করেছে: CSS load order, dark-only tokens, English wrapping safeguards, responsive Auth sizing, theme-color metadata, legal page stylesheet links, About screenshot allow-list/disclosure, screenshot translation keys, এবং বিদ্যমান Auth form submit contract।

## Full test suite

| Result | Count |
|---|---:|
| Total | 899 |
| Passed | 889 |
| Failed | 10 |

এই ১০টি failure Run74 Test Report-এ থাকা একই পূর্ববর্তী baseline failure; Run75-এর কারণে নতুন কোনো full-suite failure যোগ হয়নি।

1. Backup UI links the downloaded `.hlbackup` to the local Restore & Recovery file picker.
2. Password re-authentication does not inflate the fresh login-success metric.
3. Market, deposit, Khala, and period notifications use recipient-safe routing and the shared Telegram format.
4. `tests/run40NotificationMealAuditOtp.test.js` suite.
5. Automatic login lockouts use an IP plus HMAC email pair, not a shared IP alone.
6. Super Admin can release a specific account-pair block; a manual global block is explicit.
7. Cold app relaunch returns to Dashboard without persisting a stale subroute or sensitive form state.
8. Telegram dispatch reads provider metadata and builds structured market/deposit/khala messages.
9. Telegram truncation retains the Hostel Life footer and legacy meal-request activity receives a useful category.
10. The app records cold background exit but does not persist sensitive form data.

কিছু পুরোনো test assertion নতুন About screenshot gallery ও Dark Theme browser color-এর সঙ্গে সাংঘর্ষিক ছিল; সেগুলো আপডেট করা হয়েছে। Code-built preview card-গুলো এখনও আলাদা করে যাচাই করা হয় এবং public screenshot allow-list-ও পরীক্ষা করা হয়।

## Static / generator checks

- `node scripts/generate-public-legal-pages.mjs`: Passed; Privacy ও Terms পেজে Run75 stylesheet link অক্ষত থেকেছে।
- `node --check public/language-runtime.js`: Passed.
- `node --check public/landing-assets/public-controls.js`: Passed.
- `node --check src/app/theme.js`: Passed.
- `node --check scripts/generate-public-legal-pages.mjs`: Passed.
- PostCSS parse: `src/styles/run75-finishing.css` valid (152 rules); `public/landing-assets/run75-about-finish.css` valid (189 rules).
- Screenshot references: ৭টি gallery image path project base-এ পাওয়া গেছে; identifiable manager/hostel account screenshots About markup থেকে বাদ।

## Production build limitation

`npm run build` → `sh: 1: vite: not found`.

অর্থাৎ legal-page generation সফল হলেও Vite production bundle এই environment-এ build করা যায়নি, কারণ project dependencies সম্পূর্ণ ইনস্টল নেই। তাই Production Build Verified বা Production Ready দাবি করা হচ্ছে না। Local environment-এ `npm ci`, `npm test` এবং `npm run build` চালিয়ে তারপর Preview Deployment পরীক্ষা করতে হবে।

## Scope

কোনো Supabase/database migration, RPC, RLS policy, authentication handler, business logic বা `.env` পরিবর্তন অন্তর্ভুক্ত নয়।
