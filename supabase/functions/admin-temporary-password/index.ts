// Deploy as Supabase Edge Function with JWT verification enabled.
// Never ship SUPABASE_SERVICE_ROLE_KEY to the browser.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), { status: code, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!jwt) return json({ error: 'Sign in required' }, 401);
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !anon || !service) return json({ error: 'Server not configured' }, 503);
  const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authErr } = await caller.auth.getUser(jwt);
  if (authErr || !authData.user) return json({ error: 'Invalid session' }, 401);
  const callerId = authData.user.id;
  const { data: profile, error: profileErr } = await admin.from('profiles').select('role,is_blocked').eq('id', callerId).single();
  if (profileErr || profile?.role !== 'super_admin' || profile.is_blocked) return json({ error: 'Not authorized' }, 403);
  let body: { user_id?: string; identity_verified?: boolean; verification_note?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!body.identity_verified || typeof body.user_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(body.user_id) ||
      !body.verification_note?.trim() || body.verification_note.trim().length > 300) {
    return json({ error: 'Target, manual verification confirmation, and reason required' }, 400);
  }
  if (body.user_id === callerId) return json({ error: 'Use personal password change for your own account' }, 400);
  const { data: targetProfile, error: targetErr } = await admin.from('profiles').select('id,role').eq('id', body.user_id).single();
  if (targetErr || !targetProfile || targetProfile.role === 'super_admin') return json({ error: 'Target unavailable' }, 404);
  // Generate a strong, unique temporary secret on the server, shown only once.
  const random = crypto.getRandomValues(new Uint8Array(24));
  const secret = Array.from(random, v => v.toString(16).padStart(2, '0')).join('');
  const { data: targetAuth } = await admin.auth.admin.getUserById(body.user_id);
  if (!targetAuth.user) return json({ error: 'User unavailable' }, 404);
  const existingMetadata = targetAuth.user.app_metadata ?? {};
  const { error: updateErr } = await admin.auth.admin.updateUserById(body.user_id, {
    password: secret,
    app_metadata: { ...existingMetadata, must_change_password: true },
  });
  if (updateErr) return json({ error: 'Password change failed' }, 500);
  // Non-secret audit metadata; never store the temporary password.
  const { error: auditErr } = await admin.from('platform_audit_log').insert({
    actor_user_id: callerId, action: 'admin_temporary_password',
    target_type: 'user', target_id: body.user_id,
    details: { identity_verified_manually: true, note: body.verification_note.trim() },
  });
  if (auditErr) {
    // Password was changed; return a usable result rather than hide the new credential.
    return json({ temporary_password: secret, warning: 'Password updated but audit insert failed; inspect server logs.' });
  }
  return json({ temporary_password: secret, must_change_password: true });
});
