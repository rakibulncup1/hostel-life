# Hostel Life — Signup OTP ১০ মিনিট সেটআপ

## বর্তমান অবস্থা ও গুরুত্বপূর্ণ পার্থক্য

- Supabase Auth-এর Email OTP-এর ডিফল্ট মেয়াদ ৩৬০০ সেকেন্ড (১ ঘণ্টা)। এই মেয়াদ client-side JavaScript দিয়ে বদলানো যায় না।
- `src/features/auth/AuthPage.jsx`-এর `REGISTER_OTP_FLOW_MAX_AGE = 30 * 60 * 1000` শুধু ব্রাউজার ট্যাব রিলোড/ফিরে আসার সময় OTP screen-এর context সর্বোচ্চ ৩০ মিনিট পুনরুদ্ধার করে। এটি OTP token-এর server expiry নয়।
- UI-তে Resend countdown ১২০ সেকেন্ড। এটি পুনরায় পাঠানোর অপেক্ষা; OTP validity নয়। Edge Function-এর rate limit-ও বহাল থাকবে।

## Hosted Supabase project-এ একবার সেট করুন

1. Supabase Dashboard-এ আপনার Hostel Life project খুলুন।
2. **Authentication → Sign In / Providers → Auth Providers → Email**-এ যান।
3. **Email OTP expiration**-এ `600` seconds দিন (১০ মিনিট) এবং Save করুন।
4. **Authentication → Email Templates → Confirm signup** খুলুন।
5. `supabase/templates/signup-confirmation-10min.html`-এর সম্পূর্ণ HTML template বসান এবং subject দিন: `Hostel Life — ইমেইল যাচাইকরণ কোড`।
6. Save করে একটি পরীক্ষামূলক registration email পাঠান। Inbox না এলে Spam/Junk/Promotions দেখুন।

## Local Supabase

এই Patch-এর `supabase/config.toml`-এ `[auth.email] otp_expiry = 600` এবং `otp_length = 6` রাখা হয়েছে। এটি local Supabase CLI configuration-এর জন্য। Hosted Dashboard setting আলাদাভাবে Save না করা পর্যন্ত production OTP মেয়াদ ১০ মিনিট হয়েছে ধরে নেবেন না।

## কোডে আর কিছু বদলাবেন না

- `REGISTER_OTP_FLOW_MAX_AGE`-কে ১০ মিনিটে নামাবেন না; এটি form/session restoration-এর মেয়াদ, OTP নয়।
- Resend-এর `120` seconds পরিবর্তনের প্রয়োজন নেই।
- `request-signup-otp` Edge Function-এর security quota বা Supabase Auth rate-limit এড়াবেন না।
