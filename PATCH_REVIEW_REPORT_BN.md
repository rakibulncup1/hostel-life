# Hostel Life — Stage 1 Review Report

**পর্যালোচনার তারিখ:** ৪ নভেম্বর ২০২৬  
**পর্যালোচিত বেসলাইন:** মূল `Hostel Life(3).zip` + cumulative UX Refinement Patch v6  
**পর্যালোচনার লক্ষ্য:** Google OAuth-এর আগে public homepage, Privacy Policy, Terms এবং deployment routes প্রস্তুত করা।

## ১. Source audit summary

- Root unauthenticated request Login flow-তে যায়; Google brand review-এর homepage হিসেবে এটি একা যথেষ্ট নয়।
- আগের in-app Privacy Policy/Terms authenticated route-এর মধ্যে ছিল; new user/Google reviewer logged-out অবস্থায় তা পড়তে পারত না।
- Current app uses Supabase Auth email/password; registration sends full name, phone and optional permission code in user metadata.
- `createClient` uses `persistSession: true` and `autoRefreshToken: true`; browser session persists locally.
- IndexedDB stores an identity snapshot and a limited dashboard snapshot. Local Storage stores theme and some UI/release state.
- Profile avatars are uploaded to the `profile-avatars` bucket, which the SQL migration declares public; uploads use a stable per-user object path with upsert. The policy now discloses that an avatar's public URL may be accessible without sign-in.
- Security telemetry stores IP/request technical data and an HMAC identity fingerprint; raw password is not sent to that telemetry function. The Run27 security-event cleanup removes events older than 90 days when a new event is written. Activity/Login History has no separate automatic retention period in the current version.
- Telegram linking is optional and stores Telegram identifiers; notification content may be sent to Telegram.
- Financial information is manually entered/managed by hostel users. The app does not itself act as a bank or payment gateway.
- Current signup does not implement parent/legal guardian consent capture/verification for under-18 users. This remains a pre-launch compliance blocker if minors' data will be processed.
- No Google OAuth code is currently enabled in the source baseline.

## ২. Changes in this patch

- Added three standalone, public Bengali HTML pages under `public/`.
- Added Vercel clean route rewrites before the SPA catch-all.
- Added no-cache revalidation, nosniff and referrer policy headers for those public docs.
- Updated service worker to v18 and made legal/about document navigations network-only. They cannot be cached under the app-shell `/index.html` key.
- Added About/Privacy/Terms links to AuthFrame so logged-out users can find policies.
- Added in-app links to full public Privacy/Terms pages.
- Corrected the old Terms clause: public sharing of the general Hostel Life website URL is allowed; private Join Codes and invitation links must not be publicly shared.
- Added Google Cloud Console + Supabase configuration guide and short README.
- Added eight focused regression tests.

## ৩. Google policy readiness findings

- Google requires a public homepage describing actual app functionality, with a Privacy Policy link; Privacy Policy must be public, on the same domain, linked in the OAuth configuration, and disclose Google data access/use/storage/sharing.
- Domains used for branding/origins/callbacks must meet Google's domain authorization/ownership process. The current Vercel shared subdomain is a material risk for DNS ownership verification; use a domain controlled by the project owner for production branding.
- Basic sign-in only should request `openid`, `userinfo.email`, and `userinfo.profile`; no Gmail/Drive/Contacts/Calendar scopes are appropriate for this app's stated function.
- Supabase's Google provider requires a Web OAuth client and exact Supabase callback URL from the Dashboard; Site URL/Redirect URLs are separate app-return settings.
- Google branding verification is not guaranteed by preparing documents alone. Google's automated/manual review may ask for changes or ownership evidence.

## ৪. Deliberately not changed

- No Google Login button, `signInWithOAuth` call or OAuth callback handler.
- No Google Client ID/Secret.
- No Supabase project settings, auth providers, Storage, RLS, RPC or database migrations.
- No Edge Function deploy or secrets changes.
- No production site/DB changes.
- No TOTP MFA feature; it remains a future independent phase.

## ৫. Verification results

| Check | Result |
|---|---:|
| Node.js tests | 411/411 PASS |
| Python tests | 30/30 PASS |
| Static HTML parse | 3/3 documents parsed |
| Vercel JSON parse | PASS (15 rewrites, 10 header rules) |
| Public icon references | PASS |
| ZIP CRC / SHA-256 | Checked during packaging |
| Vite production build | NOT RUN SUCCESSFULLY — `vite: not found` |
| Live Vercel Preview / Browser | Not tested |
| Live Supabase / Google Cloud Console | Not accessed or changed |

`npm run build` was attempted but the work environment has no installed Vite executable. The test and static checks do not replace an actual Vite production build or a live OAuth round-trip test.

## ৬. Required before public Production

1. Replace all legal owner, Support email and Supabase Region placeholders.
2. Obtain legal review and establish a real data subject request contact/workflow.
3. Decide whether under-18 users are allowed; if yes, implement and verify guardian-consent/safeguarding flow before collecting those users' data.
4. Confirm Supabase project region, processor terms and cross-border data-transfer obligations.
5. Configure a domain owned/controlled by the operator and verify via Google Search Console with a Cloud project Owner/Editor account.
6. Deploy to Development/Preview and manually test public pages, mobile layout, cached/uncached navigation and link consistency.
7. Only then create OAuth client, enable Supabase Google provider and implement Google Sign-In in the next module.

**Conclusion:** Stage 1 public-page and documentation preparation is complete as a source patch. It is not a declaration of legal compliance, Google approval, or Production readiness.
