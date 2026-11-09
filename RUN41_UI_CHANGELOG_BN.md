# Hostel Life — Run41 UI Refresh

## Scope
এই Candidate-এ শুধু User Interface ও User Experience পরিবর্তন করা হয়েছে। Database schema, Supabase migrations, Edge Functions, RPCs, notification delivery, OTP rate limits, authentication service, permission rules এবং business logic পরিবর্তন করা হয়নি।

## পরিবর্তন
1. বিদ্যমান ৩২টি `InfoPanel` এবং একই ধরনের guidance/helper text-এর presentation একীভূত ও উন্নত করা হয়েছে। InfoPanel-এ accessible `role="note"` ও tone metadata যোগ হয়েছে।
2. Login ও Registration-এর brand panel-এ নতুন responsive brand lockup, logo presentation, tagline badge, typography ও spacing যোগ করা হয়েছে।
3. Email OTP Verification ধাপটি আলাদা minimal layout-এ সাজানো হয়েছে। এই ধাপে শুধু একটি ছয়-সংখ্যার verification input থাকে; পাঠানো ইমেইল দৃশ্যমান থাকে। Resend countdown এবং আগের তথ্য/ইমেইল পরিবর্তনের সুযোগ রাখা হয়েছে।
4. Light, Blue, Dark ও System theme-এর token ব্যবহার করা হয়েছে। কোনো forced light/dark theme যোগ করা হয়নি।
5. সব নতুন CSS একটি dedicated stylesheet-এ রাখা হয়েছে এবং শেষে import করা হয়েছে, যাতে বিদ্যমান layout override সীমিত থাকে।
6. UI regression contract-এর জন্য নতুন ৫টি test যোগ করা হয়েছে।

## পরিবর্তিত/নতুন ফাইল
- `src/features/auth/AuthPage.jsx`
- `src/components/InfoPanel.jsx`
- `src/main.jsx`
- `src/styles/ui-polish-v41.css` (new)
- `tests/run41AuthAndGuidanceUi.test.js` (new)

## যাচাই
- Full Node test suite: 570 total, 567 passed, 3 failed.
- The same 3 failures were already present in the Run40 v2 SQLFix Candidate baseline: missing OAuth stage-one guide file, an existing Backup UI contract assertion, and an existing password re-authentication metric assertion.
- New targeted Run41 tests: 5/5 passed.
- Relevant UI/auth regression tests: 19/19 passed.
- JSX/JS syntax transpilation: passed for changed JSX/JS files.
- New CSS PostCSS parse: passed.
- ZIP integrity: to be confirmed after packaging.
- Vite Production Build was not run because Vite dependencies are not installed in this working copy. No claim of production build verification is made.

## Deployment note
এটি একটি UI Candidate; Production Baseline হিসেবে স্বয়ংক্রিয়ভাবে গৃহীত নয়। আগের Run40 v2 SQLFix Candidate-এর Migration ফাইলগুলো একই অবস্থায় রাখা হয়েছে, কিন্তু Run41-এর জন্য নতুন কোনো Migration নেই। UI যাচাইয়ের জন্য আলাদা branch/copy-তে ব্যবহার করুন; পুরোনো Live project folder-এর ওপর সরাসরি extract/overwrite করবেন না।
