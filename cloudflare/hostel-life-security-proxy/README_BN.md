# Hostel Life — ঐচ্ছিক Cloudflare Worker

এই Worker পুরো ওয়েবসাইটের Firewall বা Authentication Provider নয়। এটি চারটি নির্দিষ্ট Supabase Edge Function-এর জন্য ঐচ্ছিক signed Geo/Proxy layer। Vercel-এ Worker URL না থাকলেও Supabase Direct Mode দিয়ে Login, Registration, OTP এবং Password Reset চলবে। Worker/Geo signature ব্যর্থ হলে Frontend নির্দিষ্ট proxy error-এ সরাসরি Supabase origin-এ retry করবে।

## Worker কী করবে
- Cloudflare `request.cf` থেকে পাওয়া গেলে Country, City, Region ও Region Code সংগ্রহ করবে।
- Client-এর পাঠানো arbitrary IP/Location Header বিশ্বাস করবে না; Worker-এর trusted ingress metadata HMAC দিয়ে sign করবে।
- `/` ও `/health`-এ non-sensitive JSON health response দেবে, যাতে `workers.dev` URL খুললে শুধু “Code Not Allowed” না আসে।
- শুধু Auth/Security-এর চারটি নির্দিষ্ট Function Path proxy করবে; arbitrary URL proxy করবে না।

## পরিষ্কারভাবে সেটআপ
1. `wrangler.toml.example`-কে স্থানীয়ভাবে `wrangler.toml` নামে কপি করুন।
2. `SUPABASE_FUNCTIONS_ORIGIN`-এ `https://YOUR_PROJECT_REF.supabase.co` দিন।
3. `ALLOWED_ORIGINS`-এ শুধু সঠিক Production Vercel Origin এবং প্রয়োজনীয় Localhost দিন।
4. Cloudflare Worker Secret হিসেবে `HOSTEL_GEO_PROXY_HMAC_SECRET` সেট করুন। একই নাম ও একই Secret Supabase Edge Function Secrets-এ থাকতে হবে।
5. `wrangler deploy` দিয়ে Worker Deploy করুন। `workers.dev` চালাতে আলাদা Domain বাধ্যতামূলক নয়; `workers_dev = true` আছে।
6. Worker root URL খুলে JSON-এ `ok: true` ও `service: hostel-life-security-proxy` দেখুন।
7. প্রথম Production Smoke Test Direct Supabase Mode-এ করুন—Vercel-এ `VITE_HOSTEL_SECURITY_WORKER_URL` ফাঁকা রাখুন। Worker আলাদাভাবে যাচাই হওয়ার পরই চাইলে Vercel-এ URL যোগ করুন।

## Secret কোথায় থাকবে
- `HOSTEL_GEO_PROXY_HMAC_SECRET`: Cloudflare Worker Secret এবং Supabase Edge Function Secret—দুই জায়গায় একই মান। SQL, `wrangler.toml`, Git, Frontend বা `VITE_` variable-এ নয়।
- `HOSTEL_SECURITY_HMAC_SECRET`, `PASSWORD_RESET_HMAC_SECRET`, `SUPABASE_SECRET_KEYS`/Service Role: Supabase Edge Function Secrets-এ শুধু।
- Database-এ কোনো HMAC key, Service Role Key, Password বা OTP রাখা হবে না। কেবল HMAC fingerprint এবং private Security Event-এ প্রয়োজনীয় attempted email/IP metadata থাকবে।
- `IPINFO_TOKEN` আর প্রয়োজন নেই; Worker এখন তৃতীয়-পক্ষ Geo API ব্যবহার করে না।
- পুরোনো `HOSTEL_GEO_PROXY_REQUIRED` Secret আর Code-এ পড়া হয় না; Edge Function Deploy ও Smoke Test সফল হওয়ার পর এটি Supabase Secrets থেকে সরানো যাবে।

## Supported Routes
- `/functions/v1/auth-security-gate`
- `/functions/v1/record-auth-event`
- `/functions/v1/request-password-reset`
- `/functions/v1/request-signup-otp`

City/Region পাওয়া Cloudflare `request.cf` metadata-র ওপর নির্ভরশীল। এই তথ্য অনুপস্থিত থাকলেও Authentication, OTP বা Password Reset বন্ধ হবে না।
