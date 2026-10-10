# Feature Recovery V1 — Manual QA checklist

প্রথমে migration সফল এবং `npm run build` pass নিশ্চিত করো। Test-এর জন্য সম্ভব হলে একটি test hostel/member account ব্যবহার করো।

## 1. Identity, period, member list
- [ ] Manager/assistant/member-এর পদবি ও action menu যথাযথ।
- [ ] Running period load হয়; period RPC failure হলেও directory failure-এর কারণে পুরো Dining page blank হয় না।
- [ ] Period নেই এমন সময় Dashboard-এ পরিষ্কার “বর্তমানে কোনো রানিং মাস নেই” এবং ০ meal metrics দেখা যায়।

## 2. Meal requests
- [ ] Primary manager ও assistant-এর “আমার মিল” normal member request/history UI ব্যবহার করে।
- [ ] New request member-এর নিজের history-তে দেখা যায়।
- [ ] Manager manual request করলে target member-এর history-তে দেখা যায়।
- [ ] Duplicate date/overlap request backend reject করে।
- [ ] Correction submit → manager/assistant inbox → reject/approve flow কাজ করে।
- [ ] Late request cutoff window-তে submit করলে auto-approved হয় না; notification manager এবং assistant পায়।
- [ ] Approval-এর পরে matching-date Late Request card সব active member-এর Dashboard-এ দেখা যায়।
- [ ] Target date-এর 9 PM finalization-এর পরে card disappears এবং final meal/snapshot update হয়।
- [ ] Finalized day correction approve করলে final row/history update হয় এবং duplicate override তৈরি হয় না।

## 3. Market
- [ ] Normal member নিজের নামে market entry করতে পারে।
- [ ] Manager member directory loaded হলে অন্য active member বেছে entry দিতে পারে।
- [ ] Member-directory RPC fail হলে error/retry দেখায়, period তথ্য আলাদাভাবে থাকে; fallback নিজ সদস্যের নাম ছাড়া অন্য member-কে ভুল করে নির্বাচন করায় না।
- [ ] Save-এর পরে entry history/detail/items/total দৃশ্যমান।
- [ ] Manager existing market detail edit/void করতে পারে, audit/history অক্ষত থাকে।
- [ ] Save fail হলে exact UI error সংরক্ষণ; প্রয়োজনে read-only diagnostic চালানো।

## 4. History, details, account summary
- [ ] Market history: total, member filter, date filter, chronological serial and latest-first display ঠিক।
- [ ] Market detail-এ item/quantity/amount/total ঠিক।
- [ ] Account summary: deposit, market deposit, other expense cards filter করে সংশ্লিষ্ট transactions দেখায়।
- [ ] Khala Money account history-তে অপ্রয়োজনীয়ভাবে মিশে না যায়।
- [ ] Dashboard member card click করলে same-hostel detail RPC থেকে final daily meals, transactions, market entries এবং balance আসে।
- [ ] PDF/print output selected filter বজায় রাখে।

## 5. Offline/real-time
- [ ] Late card/meal data online visit-এর পর offline snapshot-এ থাকে।
- [ ] Realtime change হলে form typing-এর মধ্যে full page unload বা form state loss হয় না।
- [ ] Realtime unavailable হলে fallback refresh কাজ করে এবং browser বারবার reload হয় না।

## 6. Supabase diagnostic
- [ ] `HOSTEL_LIFE_FEATURE_RECOVERY_V1.sql` শেষে `FEATURE_RECOVERY_V1=committed` এবং core RPCs `present` দেখায়।
- [ ] Existing business rows count অপ্রত্যাশিতভাবে কমেনি।
- [ ] এই migration-এর বাইরে কোনো older SQL repeat করা হয়নি।
