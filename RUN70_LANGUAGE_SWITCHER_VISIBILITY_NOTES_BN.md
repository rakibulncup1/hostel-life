# Run70 — Language Switcher Visibility Fix

## কেন এই Patch
Run69-এ language runtime এবং switcher component ছিল, কিন্তু authenticated app-এর global Header-এ switcher বসানো ছিল না। ফলে ব্যবহারকারীকে Profile পেজের একটি নিচের card-এ যেতে হতো।

## পরিবর্তন
- সব signed-in app page-এর shared Header-এ compact `EN` / `বাংলা` switcher।
- Menu Drawer-এর footer-এ `ভাষা` label-সহ আরেকটি switcher।
- Standalone Super Admin header-এও compact language control।
- Service Worker cache key `v21` করা হয়েছে, যাতে নতুন UI shell পুরোনো cached shell থেকে আলাদা হয়।
- Profile, Login/Register, Public About/Privacy/Terms-এর বিদ্যমান switcher অক্ষুণ্ন।
- একই `hostel-life-language-v1` local preference এবং `HostelLifeI18n` runtime ব্যবহার; কোনো DB migration/API request যোগ হয়নি।

## ইনস্টল
1. বর্তমানে deployed Run69 source-এর backup নিন।
2. ZIP-এর `Hostel Life/` folder-এর contents project root-এ overwrite করুন।
3. `npm test` এবং `npm run build` চালিয়ে build সফল হলে deploy করুন।
4. Deploy-এর পর cache clear/Hard Reload করুন; PWA install করা থাকলে app close করে পুনরায় খুলুন।

এই Patch শুধু LanguageSwitcher visibility/discoverability-এর জন্য। অনুবাদ dictionary, business logic, SQL, Supabase functions বা notification flow পরিবর্তন করে না।
