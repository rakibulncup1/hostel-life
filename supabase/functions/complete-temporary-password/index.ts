// Authenticated password completion. Deploy with JWT verification enabled.
// The service-role key must remain server-side and must never be exposed to the browser.
import { createClient } from 'npm:@supabase/supabase-js@2';

const FUNCTION_VERSION = '2026-10-29-final-repair-1';
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Vary': 'Origin',
};
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === 'OPTIONS') return new Response(null, { headers, status: 204 });
  if (req.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED', message: 'শুধু POST গ্রহণযোগ্য।', request_id: requestId }, 405);

  try {
    const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!jwt) return reply({ error: 'AUTH_REQUIRED', message: 'লগইন সেশন পাওয়া যায়নি।', request_id: requestId }, 401);
    if (!url || !anon || !service) {
      console.error('complete-temporary-password configuration missing', { request_id: requestId, has_url: Boolean(url), has_anon_key: Boolean(anon), has_service_role_key: Boolean(service) });
      return reply({ error: 'SERVER_CONFIG_MISSING', message: 'Edge Function-এর server configuration অনুপস্থিত।', request_id: requestId }, 503);
    }

    const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: current, error: authError } = await caller.auth.getUser(jwt);
    if (authError || !current.user) return reply({ error: 'INVALID_SESSION', message: 'সেশন বৈধ নয়; অস্থায়ী পাসওয়ার্ড দিয়ে আবার লগইন করুন।', request_id: requestId }, 401);
    const { data: record, error: lookupError } = await admin.auth.admin.getUserById(current.user.id);
    if (lookupError || !record?.user) {
      console.error('complete-temporary-password user lookup failed', { request_id: requestId, user_id: current.user.id, message: lookupError?.message });
      return reply({ error: 'AUTH_USER_LOOKUP_FAILED', message: lookupError?.message || 'Auth user পাওয়া যায়নি।', request_id: requestId }, 404);
    }
    if (!record.user.app_metadata?.must_change_password) {
      return reply({ error: 'PASSWORD_CHANGE_NOT_PENDING', message: 'এই account-এর জন্য বাধ্যতামূলক পাসওয়ার্ড পরিবর্তন pending নেই। Super Admin থেকে নতুন temporary password তৈরি করে আবার লগইন করুন।', request_id: requestId }, 403);
    }

    let body: { new_password?: string };
    try { body = await req.json(); } catch { return reply({ error: 'INVALID_JSON', message: 'Request body পড়া যায়নি।', request_id: requestId }, 400); }
    if (typeof body.new_password !== 'string' || body.new_password.length < 12 || body.new_password.length > 128) {
      return reply({ error: 'INVALID_PASSWORD_LENGTH', message: 'নতুন পাসওয়ার্ড ১২–১২৮ অক্ষরের হতে হবে।', request_id: requestId }, 400);
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(current.user.id, {
      password: body.new_password,
      app_metadata: { ...(record.user.app_metadata || {}), must_change_password: false },
    });
    if (updateError) {
      console.error('complete-temporary-password Auth update failed', { request_id: requestId, user_id: current.user.id, message: updateError.message, status: updateError.status, code: updateError.code });
      return reply({ error: 'AUTH_UPDATE_FAILED', message: `Supabase Auth নতুন পাসওয়ার্ড সংরক্ষণ করেনি: ${updateError.message}`, request_id: requestId }, 400);
    }

    return reply({ success: true, function: 'complete-temporary-password', version: FUNCTION_VERSION, request_id: requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('complete-temporary-password unexpected failure', { request_id: requestId, message });
    return reply({ error: 'UNEXPECTED_SERVER_ERROR', message: `Edge Function-এ অপ্রত্যাশিত ত্রুটি হয়েছে: ${message}`, request_id: requestId }, 500);
  }
});
