# Supabase Logs Query — নিরাপদ যাচাই নির্দেশিকা

এই ফাইলটি শুধু Supabase-এর **Logs Query** ব্যবহারের সীমা কম রাখতে সাহায্য করার জন্য। এটি Database query, Database storage, অথবা Logs Ingest-এর বিকল্প মেট্রিক নয়।

## আগে সঠিক মেট্রিক শনাক্ত করুন

Supabase Dashboard → Organization/Project Usage-এ গিয়ে আলাদাভাবে দেখুন:

- **Logs Query:** Logs Explorer-এ ডেটা পড়া/scan করার পরিমাণ। এটি কত Log তৈরি হয়েছে তা বোঝায় না।
- **Logs Ingest:** Postgres, API Gateway, Auth, Storage, Realtime, Edge Functions ইত্যাদি থেকে কত Log তৈরি/ingest হয়েছে।

একটির বৃদ্ধি দেখে অন্যটির সেটিংস পরিবর্তন করবেন না। বিশেষ করে Logs Query বেড়েছে বলে Auth, Edge Function বা Postgres logging বন্ধ করবেন না।

## এই Repository-র Logs Explorer SQL কীভাবে চালাবেন

1. Supabase SQL Editor-এ query source হিসেবে **Logs (ClickHouse)** নির্বাচন করুন; **Database** নয়।
2. প্রথমে শুধু `LogsExplorer_1h_source_summary.sql` একবার চালান। সময়সীমা ১ ঘণ্টা রাখা হয়েছে।
3. কোন source বেশি Event দিচ্ছে তা নিশ্চিত না হওয়া পর্যন্ত অন্য query চালাবেন না।
4. `edge_logs` বেশি হলে তবেই `LogsExplorer_1h_gateway_requests.sql` চালান। `postgres_logs` বেশি হলে তবেই `LogsExplorer_1h_postgres_signals.sql` চালান।
5. অপ্রয়োজনে একই query বারবার, বড় time range-এ, অথবা একাধিক tab/session থেকে চালাবেন না। প্রথমে ১ ঘণ্টার সীমা ব্যবহার করুন।

এই তিনটি SQL কেবল হাতে চালানোর diagnostics; এগুলো Frontend, Edge Function, Cron বা Background worker থেকে স্বয়ংক্রিয়ভাবে চলে না। Repository-তে Logs Explorer polling/Management Logs API চালানোর কোনো app-side loop নেই।

## বেশি Usage দেখালে করণীয়

- Usage screen-এ সঠিক Project ও billing period নিশ্চিত করুন।
- Logs Query আর Logs Ingest আলাদা করে লিখে রাখুন; কোনটির usage ৫ GB/দিন বা ১৩ GB দেখাচ্ছে তা নিশ্চিত করুন।
- Logs Query হলে Supabase Dashboard-এর usage report ও এক ঘণ্টার source summary মিলিয়ে দেখুন। Dashboard reporting anomaly থাকলে প্রকৃত source attribution ছাড়া app logging কমাবেন না।
- Logs Ingest হলে source summary থেকে নির্দিষ্ট source ও severity শনাক্ত করে তার পরেই logging-volume পরিবর্তন বিবেচনা করুন। Auth/security event, error, rate-limit বা abuse protection log অন্ধভাবে বন্ধ করা যাবে না।

**সতর্কতা:** Logs Query quota ১০০ GB হলেও Free plan-এর Logs Ingest quota আলাদা এবং অনেক কম। Query scan কমানো Logs Ingest কমানোর সমান নয়। Production logging configuration পরিবর্তনের আগে Dashboard-এর প্রকৃত metric ও source breakdown যাচাই আবশ্যক।
