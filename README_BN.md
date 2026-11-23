# Run118 — ব্যক্তি-ভিত্তিক Final Meal: চলমান মাসের দিন দেখানোর সংশোধন

## কেন ০ দিন দেখাচ্ছিল

চলমান মাসের `end_date` Database-এর far-future sentinel গোপন করার জন্য অ্যাপের period normalizer ইচ্ছাকৃতভাবে `null` করে। কিন্তু ব্যক্তি-ভিত্তিক Final Meal loader `end_date` না থাকলে খালি তালিকা ফেরত দিচ্ছিল। তাই মাসে দিন ও রেকর্ড থাকা সত্ত্বেও UI-তে `০ দিন` দেখা যাচ্ছিল।

## কী পরিবর্তন হয়েছে

- চলমান period-এর `end_date` null হলে Bangladesh time zone অনুযায়ী আজকের তারিখকে calendar-এর end date হিসেবে ব্যবহার করা হবে।
- Period-এ বৈধ নির্দিষ্ট end date থাকলে সেটি আগের মতোই ব্যবহার হবে।
- ওই start/end range দিয়েই existing manager-scoped `manager_get_member_final_meal_month` RPC এবং `daily_meal_days` read চলবে।
- প্রতিদিনের Breakfast/Lunch/Dinner-এর existing final → actual → planned priority অক্ষত।
- প্রতিদিনের existing `hl_get_final_meal_audit` log button/flow অপরিবর্তিত।
- কোনো SQL Migration প্রয়োজন নেই; Run96 RPC আগেই প্রয়োগ করা থাকলেই হবে।

## প্রয়োগ

এই প্যাচটি Run117-এর ওপর তৈরি। বর্তমান Run117-সমন্বিত প্রজেক্টে ZIP Extract করে একই Path অনুযায়ী নিচের ফাইল Replace করুন:

- `src/features/dining/DiningPage.jsx`
- `src/utils/period.js`

`tests/run118_member_final_meal_open_period.test.mjs` শুধু Regression Test-এর জন্য।

## যাচাই

প্রজেক্ট Root থেকে:

```powershell
node --test tests/run118_member_final_meal_open_period.test.mjs
npm run verify:styles
npm test
npm run build
```

এই প্যাচে নতুন SQL Migration নেই। Database, RPC, RLS, audit writer, request logic, CSS, About page, Auth, PDF বা অন্য কোনো feature পরিবর্তন করা হয়নি।
