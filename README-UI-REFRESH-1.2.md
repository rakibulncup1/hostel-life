# Hostel Life — UI Refresh 1.2

এই cumulative update Module 06-এর ওপর UI/UX polish এবং একটি ছোট offline-detail enhancement যোগ করে।

## মূল পরিবর্তন
- Mobile-first responsive containment; horizontal overflow guardrails
- Dashboard member cards এখন My Account card-এর মতো structured
- Active/inactive এবং monthly meal activity badge আলাদা ও পরিষ্কার
- Desktop content width আবার প্রশস্ত করা হয়েছে
- Authentication pages-এর নতুন compact/premium presentation
- Dining/History/Profile/Manager form controls-এর responsive polish
- Notification outside-click + Escape close
- Offline Meal Card-এ cached member-wise details এবং client last-sync time
- Developer Info থেকে অপ্রয়োজনীয় photo placeholder note সরানো
- User-facing Bengali copy আরও সংক্ষিপ্ত/স্বাভাবিক করা
- Service Worker cache version v8

## Database
এই UI refresh-এর জন্য নতুন SQL প্রয়োজন নেই।

## Environment
`.env.local` overwrite বা commit করবে না।

## Test
```powershell
npm install
npm run build
npm run dev
```
