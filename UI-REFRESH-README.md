# Hostel Life — UI Refresh 1.1

এই ZIP Module 06-এর ওপর বসানোর জন্য তৈরি করা cumulative UI patch। মূল লক্ষ্য mobile-first responsive polish, horizontal overflow removal, cleaner Bengali UI, improved dashboard/member cards, notification outside-click dismissal, and offline Meal Card member details.

## Install
1. ZIP-এর contents `D:\MY PROJECTS\Hostel Life` project root-এ extract করুন।
2. `.env.local` overwrite করবেন না।
3. `npm install`
4. `npm run dev`
5. production build যাচাই করতে `npm run build`

## Notes
- নতুন SQL লাগবে না।
- Offline feature আগের architecture অনুযায়ী শুধু Dashboard Meal Card।
- Meal Card online sync করলে member-wise details-ও offline cache-এ রাখা হয়।
- Developer Info-র ছবি পরে দেওয়া হবে; তাই কোনো placeholder নির্দেশনা লেখা নেই।
