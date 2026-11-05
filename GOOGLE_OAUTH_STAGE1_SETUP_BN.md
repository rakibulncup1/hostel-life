# Hostel Life — Google OAuth প্রস্তুতি (ধাপ ১)

**রিভিউ তারিখ:** ৪ নভেম্বর ২০২৬  
**এই প্যাকেজের উদ্দেশ্য:** Google Sign-In চালুর আগে ওয়েবসাইটের public identity, Privacy Policy, Terms of Service, domain readiness এবং Google Cloud/Supabase configuration প্রস্তুত করা।  
**গুরুত্বপূর্ণ:** এই ধাপে Google Login-এর বোতাম বা OAuth code যোগ করা হয়নি। বর্তমান email/password login অক্ষত থাকবে। Google Sign-In চালু হবে পরবর্তী ধাপে।

---

## ১. বর্তমান প্রজেক্টে যা পাওয়া গেছে

কোড পর্যালোচনায় বর্তমান সাইটে নিচের বিষয়গুলো পাওয়া গেছে:

- বর্তমান প্রকাশিত ওয়েব ঠিকানা: `https://hostellife-bd.vercel.app/`। এটি Vercel-এর shared subdomain; আপনার নিজস্ব DNS domain নয়।
- `/` রুটে unauthenticated visitor-কে Login-এ পাঠানো হয়। এটি একা Google-এর Production homepage requirement পূরণ করে না।
- আগের Privacy Policy ও Terms page authenticated app-এর ভেতরে ছিল; নতুন visitor সরাসরি খুলতে পারত না।
- Supabase Auth-এ email/password login এবং signup আছে। Signup metadata-তে নাম, ফোন নম্বর এবং প্রয়োজন হলে Permission Code যায়।
- একই মেসের সদস্যদের মধ্যে membership, meal, market, deposit, expense, monthly হিসাব ও সংশ্লিষ্ট কিছু তথ্য role/permission অনুযায়ী দৃশ্যমান।
- Supabase IndexedDB-তে সীমিত identity snapshot ও dashboard snapshot রাখা হয়; theme/UI preference Local Storage-এ থাকতে পারে।
- security event-এ IP/technical request data থাকে; ব্যর্থ login/registration-এর event-এ HMAC identity reference ব্যবহার করা হয়, raw password সংরক্ষণ করা হয় না। ৯০ দিনের পুরোনো security event পরবর্তী event লেখার সময় cleanup হয়। Activity/Login History-এর আলাদা স্বয়ংক্রিয় retention মেয়াদ বর্তমান কোডে নেই।
- Telegram সংযোগ ঐচ্ছিক। সংযোগ করলে Telegram chat/user ID এবং notification title/body Telegram-এ যেতে পারে।
- Hostel Life কোনো payment gateway বা টাকা স্থানান্তরকারী সেবা নয়; অ্যাপটি মেসের দেওয়া তথ্যের হিসাব ও সারসংক্ষেপ দেখায়।
- বর্তমান registration flow-তে ১৮ বছরের কম বয়সী ব্যবহারকারীর guardian consent স্বয়ংক্রিয়ভাবে যাচাই করা হয় না। অপ্রাপ্তবয়স্কের তথ্য নেওয়ার আগে উপযুক্ত guardian-consent ও safeguarding ব্যবস্থা চালু করা বাধ্যতামূলক pre-launch কাজ।

এই প্যাকেজে তিনটি public document page যুক্ত হয়েছে:

| পেজ | Production URL path | কাজ |
|---|---|---|
| পরিচিতি / Homepage | `/about` | পণ্যের বাস্তব কাজের পরিচিতি এবং Privacy/Terms links |
| Privacy Policy | `/privacy-policy` | ডেটা, Google User Data, providers, retention ও rights |
| Terms of Service | `/terms-of-service` | অ্যাপ ব্যবহারের শর্ত |

এগুলো Vercel rewrite, auth page footer link এবং service worker-এর network-only rule দিয়ে প্রকাশের জন্য প্রস্তুত। তবে নিচের placeholder পূরণ না করা পর্যন্ত এগুলোকে চূড়ান্ত বা আইনগতভাবে অনুমোদিত নথি ভাববেন না।

---

## ২. প্রকাশের আগে অবশ্যই যেসব তথ্য পূরণ করতে হবে

`public/privacy-policy.html` এবং `public/terms-of-service.html`-এ হলুদ রঙের placeholder রাখা আছে। Find/Search দিয়ে নিচের তিনটি লেখা খুঁজে প্রকৃত তথ্য বসান:

1. `[সেবার আইনগত পরিচালনাকারীর পূর্ণ নাম/প্রতিষ্ঠান]` — সেবার প্রকৃত আইনগত owner/controller কে, তা দায়িত্বশীল প্রাপ্তবয়স্ক/আইনগত পরিচালনাকারী নিশ্চিত করবেন। Footer-এ থাকা developer নাম দেখে নিজে থেকে legal owner ধরে নেবেন না।
2. `[বাস্তব Privacy/Support ইমেইল]` এবং `[বাস্তব Support ইমেইল]` — যে inbox নিয়মিত দেখা হয় এবং data access/correction/deletion request গ্রহণ করা হবে। ইমেইল বানিয়ে বসাবেন না।
3. `[Supabase Project Settings থেকে প্রকৃত Region লিখুন]` — Supabase Dashboard → Project Settings → Infrastructure/General (Dashboard UI অনুযায়ী) থেকে প্রকৃত database region যাচাই করুন। অনুমান করে Bangladesh বা অন্য কোনো দেশ লিখবেন না।

**আরও একটি pre-launch blocker:** যদি অ্যাপটি ১৮ বছরের কম বয়সী সদস্যদের ব্যক্তিগত তথ্য নেবে, guardian consent সংগ্রহ ও যাচাইয়ের যথাযথ ব্যবস্থা যোগ করতে হবে। বর্তমান registration form-এ সেটি নেই। শুধু নীতিমালায় লাইন লিখলেই আইনি সম্মতি-ব্যবস্থা তৈরি হয় না। বাংলাদেশের Personal Data Protection Act, 2026-এর ধারা ৯ এই বিষয়ে বিশেষভাবে প্রাসঙ্গিক। প্রযোজ্য বয়স, consent flow ও safeguarding একজন দায়িত্বশীল প্রাপ্তবয়স্ক/আইনজীবীর সঙ্গে যাচাই করুন।

---

## ৩. Domain বিষয়ে সবচেয়ে গুরুত্বপূর্ণ বাধা

Google Production Brand Verification-এর জন্য Homepage, Privacy Policy, Terms, Authorized JavaScript Origins ও redirect-related domain-গুলো এমন domain-এ হতে হবে যেগুলোর ওপর আপনার/আপনার প্রতিষ্ঠানের নিয়ন্ত্রণ ও যাচাইযোগ্য ownership আছে। Google Search Console-এ সেই domain verify করার জন্য Google Cloud project-এর Owner/Editor account-কে property owner হিসেবে যুক্ত করতে হয়।

বর্তমান `hostellife-bd.vercel.app` Vercel-এর shared subdomain; `vercel.app`-এর root DNS আপনার নিয়ন্ত্রণে নেই। তাই Google-এর DNS/domain ownership verification-এ এই ঠিকানা দিয়ে Production Brand Verification সম্পন্ন হবে—এমন নিশ্চয়তা দেওয়া যায় না। Google নিজেই shared hosting domain-এর বদলে নিজের domain map করার পরামর্শ দেয়।

**সুপারিশ:**

- প্রথমে বর্তমান Vercel URL দিয়ে development/test deployment-এ public page ও Supabase OAuth integration পরীক্ষা করা যেতে পারে, যদি Google Console domain validation অনুমতি দেয়।
- Production verification-এর আগে একটি নিজস্ব domain বেছে নিয়ে Vercel-এ connect করা এবং DNS নিয়ন্ত্রণ নিশ্চিত করা সবচেয়ে নিরাপদ পথ। Domain registration সাধারণত free নয়; তাই কোনো কেনাকাটা বা subscription নেওয়ার আগে দায়িত্বশীল প্রাপ্তবয়স্ক owner-এর অনুমতি নিন।
- Supabase-এর default callback সাধারণত `PROJECT_REF.supabase.co` domain ব্যবহার করবে। Google OAuth Client-এর `Authorized redirect URIs`-এ Supabase Dashboard থেকে পাওয়া callback হুবহু দিতে হবে; সেটিকে app domain দিয়ে প্রতিস্থাপন করা যাবে না। Google Console যদি এই shared provider domain-কে আলাদা করে Authorized Domains-এ verify করতে বলে বা বাধা দেয়, তখন Console-এর exact error ও Supabase support documentation দেখে সিদ্ধান্ত নিন। Supabase custom Auth domain (যেমন `auth.example.com`) ঐচ্ছিকভাবে ব্যবহার করা যায়, কিন্তু প্রথম Google Sign-In test-এর জন্য এটি আবশ্যক নয়। Custom Auth domain plan/pricing নির্ভর হতে পারে; Free plan-এ এটি ধরে নিয়ে সেটআপ করবেন না। প্রথমে default Supabase callback দিয়ে test করুন; Google verification বা branded redirect-এ domain-related বাধা এলে তবেই custom Auth domain-এর availability ও খরচ যাচাই করুন।
- GitHub repository URL Google Homepage বা Privacy Policy URL-এর বিকল্প নয়। Google যে URL চায় তা deployed, public webpage হতে হবে।

---

## ৪. Google Cloud Console — প্রথমবারের সেটআপ

Google Cloud/আইনগত account-এর মালিকানা ও Terms গ্রহণ দায়িত্বশীল প্রাপ্তবয়স্ক/প্রতিষ্ঠানের নিয়ন্ত্রণে থাকা উচিত। আপনি প্রয়োজন হলে তাদের অনুমোদিত সীমিত project access নিয়ে কাজ করতে পারেন। কোনো বয়সসীমা বা identity verification bypass করবেন না।

### ৪.১ Project তৈরি

1. Google Cloud Console খুলুন: `https://console.cloud.google.com/`। আলাদা কোনো “Cloud Console account” লাগে না; একটি নিয়মিত Google Account দিয়ে Console-এ প্রবেশ করা হয়। আইনগত owner, project owner এবং Terms গ্রহণের দায়িত্ব দায়িত্বশীল প্রাপ্তবয়স্ক/প্রতিষ্ঠানের হাতে থাকা উচিত।
2. Project selector → New Project নির্বাচন করুন।
3. Project name দিন: `Hostel Life` অথবা `Hostel Life - Development`।
4. Project তৈরি করে সেটিই নির্বাচিত রাখুন। Project ID নোট করে নিরাপদে রাখুন।
5. শুধু Google Sign-In-এর জন্য আলাদা paid Google API enable করার প্রয়োজন সাধারণত নেই; billing prompt এলে আগে কারণ বুঝে নিন। কোনো অজানা paid service চালু করবেন না।

### ৪.২ Google Auth Platform / Branding

Google Cloud Console-এর Google Auth Platform → Branding অংশে যান (Console-এর UI-তে নাম/মেনু সামান্য বদলাতে পারে)। নিচের তথ্য দিন:

| Field | প্রস্তাবিত তথ্য |
|---|---|
| App name | `Hostel Life` |
| User support email | আপনার প্রকৃত Support inbox; placeholder নয় |
| App logo | `public/icons/icon-512.png` — 512×512 PNG; final brand asset হিসেবে ব্যবহার করার আগে ছবিটি review করুন |
| Application home page | `https://YOUR_OWN_DOMAIN/about` |
| Privacy Policy URL | `https://YOUR_OWN_DOMAIN/privacy-policy` |
| Terms of Service URL | `https://YOUR_OWN_DOMAIN/terms-of-service` |
| Authorized domain | `YOUR_OWN_DOMAIN` — `https://` বা path ছাড়া top/private domain |
| Developer contact email | নিয়মিত দেখা হয় এমন প্রকৃত owner/developer contact inbox |

বর্তমান shared Vercel address দিয়ে কেবল প্রাথমিক পরীক্ষা করতে চাইলে বাস্তব deployed URLs ব্যবহার করুন, কিন্তু domain ownership verification-এর বাধা মাথায় রাখুন। Production-এর জন্য নিজস্ব domain recommended.

**App description (প্রস্তাবিত):**  
`Hostel Life helps shared hostels manage members, meal requests, market records, deposits, expenses and monthly accounts.`

Google Console-এ App Name-এ “Google” শব্দ জুড়ে দেবেন না। Brand name হবে `Hostel Life`। Support email এবং developer contact email বাস্তব হতে হবে।

### ৪.৩ Audience

- **External** নির্বাচন করুন, কারণ ব্যবহারকারীরা আপনার নিজস্ব Google Workspace organization-এর বাইরের সাধারণ Google Account ব্যবহার করবে।
- Internal কেবল তখনই হবে যখন অ্যাপটি একটি নির্দিষ্ট Google Workspace organization-এর সদস্যদের জন্য সীমাবদ্ধ।
- প্রথমে Publishing status `Testing` রাখুন। Test User list-এ শুধু অনুমোদিত tester-এর Google email দিন। Google-এর বর্তমান নির্দেশনায় Testing-এ সর্বোচ্চ ১০০ test user যোগ করা যায়।
- Testing mode-এ authorization expiry সাধারণত ৭ দিন হতে পারে; তবে যদি শুধু `openid`, `userinfo.email`, `userinfo.profile` বা সমতুল্য মৌলিক identity scopes থাকে, Google-এর documented exception আছে। তবু Development test-এ re-consent প্রয়োজন হতে পারে।

### ৪.৪ Data Access / Scopes

শুধু Sign in করার জন্য ন্যূনতম OIDC identity scopes রাখুন:

- `openid`
- `email` (`https://www.googleapis.com/auth/userinfo.email`)
- `profile` (`https://www.googleapis.com/auth/userinfo.profile`)

Google Console-এ যদি scope picker আলাদাভাবে দেখায়, `openid` manually add করতে হতে পারে; `userinfo.email` ও `userinfo.profile` provider setup-এ আগে থেকেই থাকতে পারে। মৌলিক email/profile identity ছাড়া কিছু যোগ করবেন না। নিচের কোনো scope এখন যোগ করবেন না:

- Gmail
- Google Drive
- Contacts
- Calendar
- Photos
- YouTube বা অন্য কোনো Google service data

এই অ্যাপে Google Sign-In-এর উদ্দেশ্য কেবল পরিচয় যাচাই/অ্যাকাউন্টে প্রবেশ। অতিরিক্ত Google API ব্যবহার এই ধাপের অংশ নয়।

### ৪.৫ OAuth Client তৈরি

1. Google Auth Platform → Clients → Create Client নির্বাচন করুন।
2. Application type: `Web application`।
3. Name: `Hostel Life Web - Development` (Production-এর জন্য পরে আলাদা client/project করা উত্তম)।
4. Authorized JavaScript origins-এ যে deployed web origin থেকে sign-in শুরু হবে সেটি দিন, যেমন `https://YOUR_OWN_DOMAIN`। Path দেবেন না।
5. Authorized redirect URIs-এ Supabase Dashboard থেকে কপি করা callback URL হুবহু বসান। অনুমান করে callback বানাবেন না।
6. Create করার পর Client ID ও Client Secret পাওয়া যাবে। Client ID সাধারণত `...apps.googleusercontent.com` দিয়ে শেষ হয়।

**Supabase callback কোথায় পাবেন:** Supabase Dashboard → Authentication → Sign In / Providers → Google। Provider settings-এ callback URL দেখানো থাকে। সাধারণ hosted Supabase format হলো:

`https://YOUR_SUPABASE_PROJECT_REF.supabase.co/auth/v1/callback`

এটি কেবল format উদাহরণ। আপনার প্রকৃত Project Ref দিয়ে Supabase Dashboard যে callback দেখাবে সেটিই কপি করবেন।

---

## ৫. Supabase Dashboard — Google Provider

1. Supabase Dashboard-এ সঠিক Hostel Life project নির্বাচন করুন।
2. Authentication → Sign In / Providers → Google খুলুন।
3. Google provider Enable করুন।
4. Google Console থেকে পাওয়া Web Client ID ও Client Secret paste করুন।
5. Save করুন।
6. Client Secret কখনো GitHub, source code, browser-side `VITE_` environment variable, screenshot বা public chat-এ দেবেন না। এটি শুধু Supabase-এর server-side provider configuration-এ থাকবে।
7. Supabase project ref বা callback নিয়ে সন্দেহ থাকলে Dashboard থেকে কপি করুন; আন্দাজে URL তৈরি করবেন না।

এই Project-এর `.env.example`-এ বর্তমানে কেবল `VITE_SUPABASE_URL` ও `VITE_SUPABASE_PUBLISHABLE_KEY` আছে। Google Client Secret frontend env-এ যোগ করার প্রয়োজন নেই। এই ধাপে কোনো Google credential source file-এ রাখা হয়নি।

---

## ৬. Supabase Auth URL Configuration

Supabase Dashboard → Authentication → URL Configuration:

- Site URL: Production-এ আপনার deployed app-এর root, যেমন `https://YOUR_OWN_DOMAIN/`।
- Redirect URLs: কেবল বাস্তব ব্যবহার করা return path/origin allowlist করুন; প্রয়োজন না থাকলে wildcard ব্যবহার করবেন না।
- Development-এর জন্য `http://localhost:5173/**` বা নির্দিষ্ট local callback আলাদা করে রাখা যায়, কিন্তু Production project-এ অপ্রয়োজনীয় localhost URL রাখবেন না।
- `https://YOUR_OWN_DOMAIN/**` শুধু তখন যোগ করুন যখন আপনার actual frontend route-গুলো ওই domain-এ থাকবে।
- Google OAuth redirect URI আর Supabase app return URL এক জিনিস নয়: Google-এর redirect URI হলো Supabase Auth callback; Supabase URL Configuration-এ থাকবে OAuth শেষে আপনার web app-এ ফেরার অনুমোদিত URL।

Google Sign-In-এর code পরবর্তী ধাপে যোগ করার সময় app-এ redirect target allowlist ও `signInWithOAuth` callback route সঠিকভাবে বাস্তবায়ন করতে হবে। Supabase-এর current JS client `signInWithOAuth({ provider: 'google' })` flow ব্যবহার করবে; unnecessary `provider_token` বা Google API access token সংরক্ষণ/ব্যবহার করা হবে না। এই ধাপে কেবল Console/Provider প্রস্তুতি; button/code নেই।

---

## ৭. Test Plan — Google Login code যুক্ত করার পর

পরবর্তী ধাপে Login পেজে বোতামের label হবে **“Google দিয়ে চালিয়ে যান”** (অথবা “Continue with Google”); শুধু “Google” লেখা নয়। Official Google Identity Services button/pre-approved asset ব্যবহার করতে হবে; Google-এর G logo নিজের মতো recolor বা reshape করা যাবে না এবং button-এর size/visual weight অন্য sign-in options-এর সঙ্গে সামঞ্জস্যপূর্ণ রাখতে হবে।


1. অনুমোদিত test Google account দিয়ে sign-in সফল হয় কি না।
2. Cancel করলে app নিরাপদে Login page-এ ফেরে কি না।
3. Google email আগে থেকে Password account-এ থাকলে duplicate account তৈরি না করে identity linking-এর নিরাপদ নীতি অনুসরণ হয় কি না।
4. একই Google account দিয়ে একাধিকবার login করলে duplicate profile/hostel membership তৈরি হয় কি না।
5. Email/name/profile image অনুপস্থিত বা private হলে graceful fallback দেখায় কি না।
6. Supabase session restore, logout, session limit এবং protected routes ঠিক থাকে কি না।
7. Google Client Secret browser bundle, Network response বা GitHub-এ প্রকাশিত হয়নি কি না।
8. Mobile Chrome/Android এবং desktop Chrome/Firefox/Safari-তে OAuth redirect কাজ করে কি না।
9. ভুল/অননুমোদিত redirect URL প্রত্যাখ্যাত হয় কি না।
10. App privacy page-এ Google user data ব্যবহার ব্যাখ্যা দেখা যায় কি না।

---

## ৮. Brand Verification ও Production Publish

Google-এর Production Brand Verification-এ কেবল Sign-In-এর মৌলিক identity scopes থাকলেও Branding review প্রয়োজন হতে পারে। Production-এর আগে:

- Homepage public হতে হবে; Login-only page নয়।
- Homepage-এ app-এর বাস্তব কাজের বর্ণনা এবং Privacy Policy link থাকতে হবে।
- Privacy Policy homepage-এর একই domain-এ থাকবে, public হবে, এবং Google Console-এ দেওয়া Privacy URL-এর সঙ্গে হুবহু মিলে যাবে।
- Terms link-ও homepage ও Console branding-এ একই URL হবে।
- App name, logo, support email ও developer contact বাস্তব ও সামঞ্জস্যপূর্ণ হবে।
- Authorized domains-এর প্রতিটি domain Google Search Console-এ ownership verification পাস করবে। Google Cloud project-এর Owner/Editor account-ই Search Console ownership-এ যুক্ত থাকবে।
- ওয়েব origins ও redirect URI HTTPS হবে।
- Google Branding Verification-এ Submit/Verify Branding করুন এবং Google-এর ইমেইলে আসা প্রশ্নের উত্তর দিন। Approval নিশ্চিত নয়; Google অতিরিক্ত তথ্য চাইতে বা সংশোধন চাইতে পারে।

**সতর্কতা:** Homepage/privacy/terms-এর placeholder, অনুপস্থিত owner identity, অকার্যকর Support email, ভুল domain ownership, বা অপ্রাপ্তবয়স্কের guardian-consent ব্যবস্থা না থাকা review ও আইনগত প্রস্তুতিতে সমস্যা তৈরি করতে পারে। এই নথি প্রস্তুত করলেই Google approval নিশ্চিত হয় না।

---

## ৯. Google Authenticator — ভবিষ্যৎ নিরাপত্তা ধাপ

Google Login এবং Google Authenticator দুইটি আলাদা বিষয়। Google Login হলো OAuth identity provider; Google Authenticator হলো TOTP code তৈরি করার app। পরে Supabase Auth MFA ব্যবহার করে TOTP যুক্ত করা যাবে। Supabase-এর TOTP MFA API বর্তমানে free এবং QR code enrollment → challenge → verify flow সমর্থন করে। তবে কেবল QR code দেখালেই নিরাপত্তা চালু হয় না: login-এর পর AAL level পরীক্ষা, challenge/verify এবং প্রয়োজনীয় sensitive action-এ AAL2 enforcement-ও implement করতে হবে। এটি পরবর্তী পৃথক ধাপ; এই প্যাচে MFA চালু করা হয়নি।

---

## ১০. এই ধাপে যা করা হয়নি

- Google OAuth button বা auth callback code যোগ করা হয়নি।
- Supabase Provider enable করা হয়নি।
- কোনো Google Client ID/Secret তৈরি বা সংরক্ষণ করা হয়নি।
- কোনো Database migration বা Edge Function deploy করা হয়নি।
- Live Production-এ কোনো পরিবর্তন করা হয়নি।

এই প্যাচটি public disclosure pages ও setup documentation প্রস্তুত করে। Google Console-এর account/domain/legal তথ্য মালিক/প্রাপ্তবয়স্ক দায়িত্বশীল ব্যক্তির মাধ্যমে যাচাই করে, placeholder পূরণ করে, development deploy পরীক্ষা করে তবেই পরবর্তী ধাপে যাবেন।

---

## ১১. অফিসিয়াল রেফারেন্স

- Google OAuth 2.0 Policies: https://developers.google.com/identity/protocols/oauth2/policies
- Google Brand Verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- Google Cloud Branding: https://support.google.com/cloud/answer/15549049
- Google OAuth Testing / Audience: https://support.google.com/cloud/answer/15549945
- Google Search Console ownership: https://support.google.com/webmasters/answer/9008080
- Supabase Google Sign-In: https://supabase.com/docs/guides/auth/social-sign-in/auth-google
- Supabase Custom Domains: https://supabase.com/docs/guides/platform/custom-domains
- Supabase MFA/TOTP: https://supabase.com/docs/guides/auth/auth-mfa/totp
- Bangladesh Personal Data Protection Act, 2026: https://bdlaws.minlaw.gov.bd/act-details-1692.html?lang=en

*এই নথি টেকনিক্যাল সেটআপ গাইড ও প্রকাশের উপযোগী প্রথম খসড়া। এটি আইনগত পরামর্শ বা Google approval guarantee নয়। Production প্রকাশের আগে আইনগত পরিচালনাকারী/দায়িত্বশীল প্রাপ্তবয়স্কের review প্রয়োজন।*
