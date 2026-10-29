// Authenticated password completion. Deploy with JWT verification enabled.
import { createClient } from 'npm:@supabase/supabase-js@2';
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers, status: 204 });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!jwt) return reply({ error: 'Sign in required' }, 401);
  if (!url || !anon || !service) return reply({ error: 'Server configuration missing' }, 503);
  const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: current, error: authError } = await caller.auth.getUser(jwt);
  if (authError || !current.user) return reply({ error: 'Invalid session' }, 401);
  const { data: record, error: lookupError } = await admin.auth.admin.getUserById(current.user.id);
  if (lookupError || !record.user || !record.user.app_metadata?.must_change_password) return reply({ error: 'Password recovery is not pending' }, 403);
  let body: { new_password?: string };
  try { body = await req.json(); } catch { return reply({ error: 'Invalid JSON' }, 400); }
  if (typeof body.new_password !== 'string' || body.new_password.length < 12 || body.new_password.length > 128) return reply({ error: 'Use a 12–128 character password' }, 400);
  // Perform password + recovery-flag update in a single server-side Auth Admin call.
  // updateUser() from inside a stateless Edge Function can fail even with a validated JWT.
  const { error: updateError } = await admin.auth.admin.updateUserById(current.user.id, {
    password: body.new_password,
    app_metadata: { ...(record.user.app_metadata || {}), must_change_password: false },
  });
  if (updateError) return reply({ error: `Auth update failed: ${updateError.message}` }, 400);
  return reply({ success: true });
});
