# Hostel Life — দুই ZIP তুলনা ও সমন্বয় প্রতিবেদন

তারিখ: ১৩ অক্টোবর ২০২৬

## তুলনার সিদ্ধান্ত

**Vercel ZIP-কে মূল ভিত্তি করা হয়েছে**, কারণ সেটিতে বর্তমান period-aware history permission check, বাজার এন্ট্রি edit/void service, RPC compatibility fallback, এবং request-cache invalidation ছিল। লোকাল ZIP-এর মাস-ম্যানেজমেন্ট পেজে পাওয়া কার্যকর আচরণ—`refresh({ force: true })` দিয়ে shared month context আপডেট করা—Vercel কোডে ফিরিয়ে আনা হয়েছে। পুরো লোকাল ZIP হুবহু বসানো হয়নি, কারণ তাতে বাজার edit-এর জন্য দরকারি role-aware history logic ও কিছু নতুন service behavior হারিয়ে যেত।

## যাচাই করে নেওয়া নির্দিষ্ট পার্থক্য

- `src/features/history/HistoryPage.jsx`: Vercel সংস্করণে `isManager` ছাড়াও `operationalRole` এবং বর্তমান period-এর `primary_manager_membership_id` থেকে edit permission যাচাই আছে; এটিই রাখা হয়েছে। Archive edit এখনও আলাদা permission grant ছাড়া খোলা হয় না।
- `src/services/managerService.js`: Vercel সংস্করণের `manager_update_market_entry` RPC call এবং mutation-এর পরে cache invalidation রাখা হয়েছে।
- `src/hooks/useManagementContext.js`: force refresh আর browser focus/visibility gate-এ আটকে থাকে না। management-context RPC-এ period না থাকলে canonical running-period RPC দিয়ে যাচাই করে। verification ব্যর্থ হলে state unknown থাকে।
- `src/features/manager/ManagerPages.jsx`: নতুন মাস/মাস বন্ধ পেজ shared context force-refresh করে; success-এর পর redundant double refresh নেই। unknown month status-এ নতুন মাস শুরু করার বোতাম disable থাকে।
- `src/features/dashboard/DashboardPage.jsx` এবং `src/hooks/useRealtimeRefresh.js`: forced retry stale period cache/focus check-এ আটকে থাকে না; `monthly_periods` realtime update দ্রুত recheck করে।
- `src/app/AppShell.jsx`: অন্য browser/device থেকে মাস বা সদস্যের manager assignment বদলালে header context recheck করার ব্যবস্থা আছে।
- `public/service-worker.js`: app-shell cache version `v11` করা হয়েছে।

## নতুন মেসে বাজার edit সংক্রান্ত গুরুত্বপূর্ণ সতর্কতা

ফ্রন্টএন্ড কোডে বোতাম দেখা এবং backend RPC-এর অনুমতি পাওয়া দুটি আলাদা বিষয়। আপনার তথ্য অনুযায়ী পুরোনো মেসে edit হয় কিন্তু নতুন মেসে হয় না—এটি নতুন মেসের `monthly_periods.primary_manager_membership_id`, active `hostel_memberships.role/status`, period assistant assignment, অথবা logged-in membership/hostel context-এর অসামঞ্জস্যও হতে পারে। বর্তমান বাজার edit function এই backend identity/period check মানে। ফ্রন্টএন্ড নিরাপদভাবে সেই অনুমতি অতিক্রম করবে না।

এই কারণে `diagnostics/READ_ONLY_NEW_HOSTEL_MARKET_EDIT_DIAGNOSTIC_20261013.sql` যোগ করা হয়েছে। এটি কেবল SELECT করে; কোনো migration, update, insert, delete বা policy/function পরিবর্তন করে না। SQL Editor-এর ফলাফল না দেখে আর কোনো migration পুনরায় চালাবেন না। যদি নতুন মেসে RPC সরাসরি permission error দেয়, সেই ফলাফল দিয়ে আলাদা narrow backend repair নির্ধারণ করতে হবে।

## প্যাকেজে কী আছে/নেই

- Vercel baseline থেকে app source, build config, deployment config, tests এবং `.env.example` রাখা হয়েছে।
- Local ZIP-এর `.git` history/working objects ও machine-specific `.env.local` কপি করা হয়নি।
- Production migration SQL folder ইচ্ছাকৃতভাবে বাদ দেওয়া হয়েছে, যাতে এই frontend recovery-কে backend migration ভেবে ভুল করে না চালানো হয়।
- `diagnostics/`-এ কেবল read-only SQL checker আছে।

## পরীক্ষার ফল

- `npm test`: **১৮/১৮ পাস**।
- TypeScript transpile parser দিয়ে JavaScript/JSX source: **৬০টি ফাইল, ০ syntax error**।
- Production Vite build: **এই রানটাইমে যাচাই করা যায়নি**। `npm ci` network/transport timeout হয়েছিল এবং Vite executable পাওয়া যায়নি; তাই build সফল হয়েছে বলে দাবি করা হচ্ছে না। আপনার কম্পিউটারে `npm ci` সফল হলে `npm run build` চালিয়ে যাচাই করতে হবে।

এই প্যাকেজে কোনো live Supabase data বা deployed Vercel app পরিবর্তন করা হয়নি।
