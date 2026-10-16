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
  // Update the logged-in user's own credential before removing the privileged recovery flag.
  const { error: passwordError } = await caller.auth.updateUser({ password: body.new_password });
  if (passwordError) return reply({ error: 'Password update failed' }, 400);
  const { error: metadataError } = await admin.auth.admin.updateUserById(current.user.id, { app_metadata: { ...(record.user.app_metadata || {}), must_change_password: false } });
  if (metadataError) return reply({ error: 'Password changed, but account finalization failed. Contact Super Admin.' }, 500);
  return reply({ success: true });
});
