# UI Refresh 1.2 — Testing Checklist

## Mobile first
- 320px/360px/390px width-এ Dashboard-এ horizontal scroll নেই।
- Meal Card, Summary, My Account, Member Card screen-এর বাইরে যায় না।
- History tab/page ডানে-বামে টানে না।
- Dining form/table mobile layout ভাঙে না।
- Login/Register pages স্বাভাবিকভাবে fit করে।

## Dashboard
- Member Card: নাম → status → monthly activity → 4 stats → balance bar।
- বর্তমান user-এর card ভুল করে member list-এ duplicate হয় না।
- Meal Card online click করলে details খুলে।

## Offline meal
1. Online অবস্থায় Dashboard খুলুন।
2. Meal Card sync শেষ হতে দিন।
3. Internet বন্ধ করুন।
4. Dashboard খুলুন।
5. Meal Card + Last Sync দেখা যাবে।
6. Cached member details থাকলে Card-এ tap করে বিস্তারিত খুলবে।
7. অন্য section-এ internet required দেখাবে।

## Notification
- Bell tap → popup।
- Popup-এর বাইরে tap → popup বন্ধ।
- Escape → popup বন্ধ।

## Desktop
- 1024px+ এবং 1200px+ width-এ content অযথা সরু নয়।
- Cards তিন-column layout-এ সুন্দর থাকে।

## Important
UI refresh-এ নতুন Supabase SQL নেই। Existing database/RLS/cron অপরিবর্তিত।
