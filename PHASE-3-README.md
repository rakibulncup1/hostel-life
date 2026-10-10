# Hostel Life — PHASE 3
## Functional Hardening + Offline PWA

এই phase-টি Super Admin ছাড়া মূল application-এর বাকি functional hardening-এর জন্য তৈরি। লক্ষ্য হলো existing healthy data/RPC নষ্ট না করে month lifecycle, request flow, late correction, Khala money visibility, assistant-manager operations, offline snapshot এবং profile upload-কে end-to-end শক্ত করা।

### আগে কী করতে হবে
1. `supabase/HOSTEL_LIFE_PHASE3_BACKEND_FUNCTIONAL_HARDENING_V1.sql` Supabase SQL Editor-এ একবার চালান।
2. Phase 1 আগে থেকেই চালানো থাকতে হবে। Phase 1 আবার চালানোর দরকার নেই।
3. এই project-এর dependencies clean install করুন: `npm ci`
4. তারপর production build: `npm run build`
5. Build সফল হলে deploy করুন।

### Phase 3-এর মূল backend changes
- Member normal meal request save হলে current primary/assistant managers-কে targeted notification তৈরি।
- Correction request save হলে primary/assistant managers-কে targeted notification তৈরি।
- Manager correction approval: locked day হলে 9 PM finalizer pipeline-এ যায়; already-finalized day হলে safe immediate final update করে snapshot refresh করে।
- Running period calendar month-এর natural end-এর বাইরে নেওয়া যাবে না।
- Early close-এর existing future-request cancellation protection রাখা হয়েছে।
- New month start race protection রাখা হয়েছে এবং end date calendar-month boundary enforce করা হয়েছে।
- Historical duplicate/overlap meal requests auto-delete করা হয়নি; শুধু read-only inspection RPC রাখা হয়েছে।
- Profile avatar bucket-এর server-side limit 256 KiB করা হয়েছে যাতে ~190 KiB browser-compressed avatar-এর জন্য headroom থাকে।

### Phase 3-এর মূল frontend changes
- IndexedDB-তে persistent identity + dashboard/meal/late-request snapshot cache।
- Offline dashboard blank/error না দেখিয়ে latest cached snapshot দেখায়।
- Service Worker shell/assets-এর cache-first navigation।
- Online ফিরলে dashboard snapshot background sync হয়।
- General user-এর Khala Money viewer period-wise history ও নিজের entry-first presentation।
- Khala Money page visible থাকা অবস্থায় automatic refresh।
- Manager request panel online থাকলে polling/focus/visibility refresh করে।
- Month close UI calendar-month boundary enforce করে।
- Historical overlap pair close screen-এ readable inspection হিসেবে দেখানো হয়।
- Assistant Manager role header/menu + operational actions support করা হয়েছে।
- Profile avatar browser-side compression করে প্রায় 190 KiB target করে এবং একই user path replace করে।

### Known preserved condition
Forensic snapshot-এ পাওয়া 2টি historical normal meal-request overlap ইচ্ছাকৃতভাবে untouched রাখা হয়েছে। এগুলো delete/cancel করার সিদ্ধান্ত business evidence ছাড়া নেওয়া হয়নি। Close screen-এ exact overlap details দেখার read-only inspector রয়েছে।

### Phase 3-এর বাইরে
- `/super-admin` এবং Super Admin role-management UI এই phase-এ নেই। এটি final phase।

### Recommended smoke-test order
1. Login → dashboard → offline mode → cached dashboard/meal/late request.
2. Member normal meal request → manager/assistant request panel + notification.
3. Correction request after cutoff → manager/assistant receives it → approval → late request/finalization behavior.
4. Manager emergency override after cutoff.
5. Khala Money entry → member viewer on another account → correct period and member visibility.
6. Early close today → future request warning/cancellation → archive.
7. Close → next day new month only → default natural calendar-month end.
8. Same manager → assistant carry-over; changed manager → previous assistant access not carried.
9. Market/deposit/other-expense future date rejection.
10. Profile image >2MB input → compressed upload → same avatar path replaced.

### Verification note
এই environment-এ `npm ci` সম্পূর্ণ হয়নি এবং তাই `vite build` production run সফলভাবে সম্পন্ন করা সম্ভব হয়নি। Static JS/JSX syntax validation, relative-import validation এবং `git diff --check`-এ কোনো error পাওয়া যায়নি।
