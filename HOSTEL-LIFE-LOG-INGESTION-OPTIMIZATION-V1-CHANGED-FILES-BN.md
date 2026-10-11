# Changed Files — Log Ingestion Optimization V1

1. `src/features/dashboard/DashboardPage.jsx` — cache-update fetch loop সরানো; initial vs realtime fetch path; in-flight guard; ১৫ সেকেন্ড auto-refresh limiter; hidden/unfocused অবস্থায় load বন্ধ।
2. `src/hooks/useDashboardOffline.js` — cache writer থেকে duplicate dashboard RPC সরানো; meal bundle reuse ও failed refresh-এ পুরোনো cache সংরক্ষণ।
3. `src/hooks/useRealtimeRefresh.js` — visible+focused+online subscription only; hidden/blur/offline-এ unsubscribe; event coalescing ও rate limiting।
4. `src/hooks/useMealOffline.js` — hook mount-এ online RPC sync বন্ধ; IndexedDB hydration স্বয়ংক্রিয়, server sync explicit caller-এর দায়িত্ব।
5. `src/app/AppShell.jsx` — notification polling সরানো; one-time load ও realtime refresh; duplicate in-flight unread fetch আটকানো; stable close handler।
6. `src/features/menu/MenuPages.jsx` — All Members polling সরানো; page entry/resume/realtime load এবং in-flight deduplication।
7. `src/features/dining/DiningPage.jsx` — Manager Meal Requests পাঁচ মিনিট polling সরানো; realtime refresh এবং in-flight load coalescing।
8. `src/hooks/useManagementContext.js` — simultaneous focus/visibility refresh-এর in-flight guard ও ১৫ সেকেন্ড cooldown।
9. `src/contexts/AuthContext.jsx` — token-only refresh-এ পুনরায় তিনটি identity RPC চালানো বন্ধ; একই initial session থেকে duplicate reload কমানো; persistent storage request একবার/user; background tab-এ online event থেকে identity refresh বন্ধ।
10. `public/service-worker.js` — cached hashed assets background re-fetch বন্ধ; HTML actual navigation-এ network-first ও offline fallback।

Database / SQL: কোনো পরিবর্তন নেই।
