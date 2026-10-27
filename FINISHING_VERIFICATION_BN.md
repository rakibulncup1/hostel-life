# Hostel Life — Finishing verification report

## যাচাইয়ের ফলাফল

- Automated Node test suite: **65/65 passed**.
- TypeScript parser-based syntax scan: **80টি JS/JSX/TS/TSX ফাইল স্ক্যান, 0 syntax error**.
- SQL migration files in the ZIP are identical to the standalone SQL downloads.
- ZIP integrity is checked after packaging.

## যেগুলো এখানে চালিয়ে যাচাই করা যায়নি

- `npm run build` চালাতে গিয়ে `vite: not found` এসেছে; এই কাজের পরিবেশে `node_modules` নেই। তাই এটিকে successful production build বলা হচ্ছে না।
- Live Supabase SQL execution বা real account/period integration test করা হয়নি। Migration সফল হয়েছে কি না তা Supabase SQL Editor-এ চালিয়ে, এরপর `supabase/migrations/20261027_finishing_reliability_postflight.sql`-এর ফল দেখে নিশ্চিত করতে হবে।

## Migration চালানোর ক্রম

1. Database backup নিন। `20261027_open_ended_running_period.sql` আগে সফলভাবে চালানো না থাকলেই চালান; সফল হয়ে থাকলে আবার চালাবেন না।
2. `20261027_finishing_reliability.sql` সম্পূর্ণ ফাইল একবারে চালান। পুরোনো Master SQL পুনরায় চালিয়ে এই ধাপ প্রতিস্থাপন করবেন না।
3. এরপর read-only `20261027_finishing_reliability_postflight.sql` চালান। সব `installed` মান `true` হওয়া উচিত। কোনোটি `false` বা SQL error এলে থামুন এবং পুরো error সংরক্ষণ করুন।
4. Frontend deploy/refresh করে প্রথমে test hostel/account-এ রাত ১০টার cutoff, late request, correction approval, month reopen, permanent notification/hostel delete এবং retention list যাচাই করুন।

স্থায়ী ডিলিট irreversible; live data-তে পরীক্ষা করার আগে backup ও confirmation phrase সাবধানে যাচাই করুন।
