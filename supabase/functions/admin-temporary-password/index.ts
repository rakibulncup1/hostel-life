// Deploy with JWT verification enabled. Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
import { createClient } from 'npm:@supabase/supabase-js@2';

const FUNCTION_VERSION = '2026-10-29-final-repair-1';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const isUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED', message: 'শুধু POST গ্রহণযোগ্য।', request_id: requestId }, 405);

  try {
    const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!jwt) return json({ error: 'AUTH_REQUIRED', message: 'Super Admin সেশন পাওয়া যায়নি। পুনরায় লগইন করুন।', request_id: requestId }, 401);
    if (!url || !anon || !service) {
      console.error('admin-temporary-password configuration missing', { request_id: requestId, has_url: Boolean(url), has_anon_key: Boolean(anon), has_service_role_key: Boolean(service) });
      return json({ error: 'SERVER_CONFIG_MISSING', message: 'Edge Function-এর SUPABASE_URL, SUPABASE_ANON_KEY বা SUPABASE_SERVICE_ROLE_KEY কনফিগারেশন অনুপস্থিত।', request_id: requestId }, 503);
    }

    const caller = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await caller.auth.getUser(jwt);
    if (authError || !authData.user) return json({ error: 'INVALID_SESSION', message: 'লগইন সেশন বৈধ নয়। আবার লগইন করুন।', request_id: requestId }, 401);

    const callerId = authData.user.id;
    const { data: profile, error: profileErr } = await admin.from('profiles').select('role,is_blocked').eq('id', callerId).maybeSingle();
    if (profileErr) {
      console.error('admin-temporary-password profile lookup failed', { request_id: requestId, caller_id: callerId, message: profileErr.message, code: profileErr.code });
      return json({ error: 'SUPER_ADMIN_PROFILE_LOOKUP_FAILED', message: `profiles থেকে Super Admin যাচাই করা যায়নি: ${profileErr.message}`, request_id: requestId }, 500);
    }
    if (!profile || profile.role !== 'super_admin' || profile.is_blocked) {
      return json({ error: 'NOT_AUTHORIZED', message: 'এই কাজের জন্য সক্রিয় Super Admin অনুমতি প্রয়োজন।', request_id: requestId }, 403);
    }

    let body: { action?: string; user_id?: string; identity_verified?: boolean; verification_note?: string };
    try { body = await req.json(); }
    catch { return json({ error: 'INVALID_JSON', message: 'Request body পড়া যায়নি।', request_id: requestId }, 400); }

    // Non-mutating diagnostics: verifies deployment, JWT, role and service-role config only.
    if (body.action === 'healthcheck') {
      return json({ ok: true, function: 'admin-temporary-password', version: FUNCTION_VERSION, caller_role: profile.role, service_role_configured: true, request_id: requestId });
    }

    if (!body.identity_verified || !isUuid(body.user_id) || !body.verification_note?.trim() || body.verification_note.trim().length < 5 || body.verification_note.trim().length > 300) {
      return json({ error: 'MANUAL_VERIFICATION_REQUIRED', message: 'লক্ষ্য ব্যবহারকারী, পরিচয় যাচাই এবং কমপক্ষে ৫ অক্ষরের কারণ দিতে হবে।', request_id: requestId }, 400);
    }
    if (body.user_id === callerId) return json({ error: 'SELF_RECOVERY_NOT_ALLOWED', message: 'নিজের পাসওয়ার্ডের জন্য ব্যক্তিগত পাসওয়ার্ড পরিবর্তন ব্যবহার করুন।', request_id: requestId }, 400);

    const { data: targetProfile, error: targetProfileErr } = await admin.from('profiles').select('id,role').eq('id', body.user_id).maybeSingle();
    if (targetProfileErr) {
      console.error('admin-temporary-password target profile lookup failed', { request_id: requestId, target_id: body.user_id, message: targetProfileErr.message, code: targetProfileErr.code });
      return json({ error: 'TARGET_PROFILE_LOOKUP_FAILED', message: `লক্ষ্য ব্যবহারকারীর profile যাচাই করা যায়নি: ${targetProfileErr.message}`, request_id: requestId }, 500);
    }
    if (!targetProfile) return json({ error: 'TARGET_PROFILE_NOT_FOUND', message: 'এই Auth ID-এর profiles রেকর্ড পাওয়া যায়নি। মেম্বার তালিকা রিফ্রেশ করে আবার চেষ্টা করুন।', request_id: requestId }, 404);
    if (targetProfile.role === 'super_admin') return json({ error: 'TARGET_IS_SUPER_ADMIN', message: 'অন্য Super Admin-এর পাসওয়ার্ড এই অপশন থেকে পরিবর্তন করা যাবে না।', request_id: requestId }, 403);

    const { data: targetAuthData, error: targetAuthError } = await admin.auth.admin.getUserById(body.user_id);
    if (targetAuthError || !targetAuthData?.user) {
      console.error('admin-temporary-password target Auth lookup failed', { request_id: requestId, target_id: body.user_id, message: targetAuthError?.message || 'Auth user not found' });
      return json({ error: 'TARGET_AUTH_LOOKUP_FAILED', message: targetAuthError?.message || 'লক্ষ্য ব্যবহারকারীর Auth account পাওয়া যায়নি।', request_id: requestId }, 404);
    }

    // Generate a one-time secret. It is returned once and never written to logs/audit.
    const random = crypto.getRandomValues(new Uint8Array(24));
    const secret = Array.from(random, value => value.toString(16).padStart(2, '0')).join('');
    const metadata = targetAuthData.user.app_metadata ?? {};
    const { error: updateErr } = await admin.auth.admin.updateUserById(body.user_id, {
      password: secret,
      app_metadata: { ...metadata, must_change_password: true },
    });
    if (updateErr) {
      console.error('admin-temporary-password Auth update failed', { request_id: requestId, target_id: body.user_id, message: updateErr.message, status: updateErr.status, code: updateErr.code });
      return json({ error: 'AUTH_PASSWORD_UPDATE_FAILED', message: `Supabase Auth পাসওয়ার্ড আপডেট করেনি: ${updateErr.message}`, request_id: requestId }, 400);
    }

    const { error: auditErr } = await admin.from('platform_audit_log').insert({
      actor_user_id: callerId,
      action: 'admin_temporary_password',
      target_type: 'user',
      target_id: body.user_id,
      details: { identity_verified_manually: true, note: body.verification_note.trim(), request_id: requestId },
    });
    if (auditErr) {
      console.error('admin-temporary-password audit insert failed after successful password change', { request_id: requestId, target_id: body.user_id, message: auditErr.message, code: auditErr.code });
      return json({ temporary_password: secret, must_change_password: true, warning: `পাসওয়ার্ড পরিবর্তিত হয়েছে, কিন্তু Audit Log লেখা যায়নি: ${auditErr.message}`, request_id: requestId });
    }

    return json({ temporary_password: secret, must_change_password: true, request_id: requestId });
  } catch (error) {
    // Do not log request bodies or any generated credential.
    const message = error instanceof Error ? error.message : String(error);
    console.error('admin-temporary-password unexpected failure', { request_id: requestId, message });
    return json({ error: 'UNEXPECTED_SERVER_ERROR', message: `Edge Function-এ অপ্রত্যাশিত ত্রুটি হয়েছে: ${message}`, request_id: requestId }, 500);
  }
});
