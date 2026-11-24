# Run121 — Final Meal তিন বেলার রঙের পার্থক্য

## কী পরিবর্তন হয়েছে

শুধু ব্যক্তি-ভিত্তিক Final Meal Correction-এর তিনটি meal control-এ আলাদা, নরম category color যোগ করা হয়েছে:

- Breakfast: হালকা সবুজ
- Lunch: হালকা নীল
- Dinner: হালকা বেগুনি

Dark Theme-এর জন্য একই রঙের উপযোগী dark shade দেওয়া হয়েছে।

## কী পরিবর্তন করা হয়নি

- Card layout, তিন-কলামের বিন্যাস, sizing, spacing, padding ও stepper geometry অপরিবর্তিত।
- অন্য Meal Entry বা Dining section-এর রং/ডিজাইন পরিবর্তন করা হয়নি।
- JavaScript/JSX, Database, SQL, Supabase, RPC, RLS, হিসাব বা business logic পরিবর্তন করা হয়নি।

## প্রয়োগ

বর্তমান Run120-সমন্বিত Project-এর backup রাখুন। ZIP Extract করে `src/styles/dining-experience-v2.css` একই path-এ Replace করুন। Test file ঐচ্ছিকভাবে রেখে চালাতে পারেন:

```powershell
node --test tests/run121_person_final_meal_color_cues.test.mjs
npm run verify:styles
```

এটি CSS-only patch; কোনো SQL Migration বা deployment configuration change প্রয়োজন নেই।
