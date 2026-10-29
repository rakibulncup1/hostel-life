// Deploy with JWT verification enabled. Never expose the service role key in frontend.
import { createClient } from 'npm:@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: cors });
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return reply({}, 204);
  if (request.method !== 'POST') return reply({error:'Method not allowed'}, 405);
  const jwt = request.headers.get('Authorization')?.replace(/^Bearer\s+/i,'') || '';
  const url = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!jwt || !url || !anon || !service) return reply({error:'Authentication or service configuration unavailable'},401);
  const caller = createClient(url, anon, {global:{headers:{Authorization:`Bearer ${jwt}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const admin = createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error:authError} = await caller.auth.getUser(jwt);
  if (authError || !identity.user) return reply({error:'Session invalid'},401);
  const {data:profile,error:profileError} = await admin.from('profiles').select('role,is_blocked').eq('id',identity.user.id).single();
  if (profileError || profile?.role !== 'super_admin' || profile?.is_blocked) return reply({error:'Super Admin only'},403);
  let body:{user_id?:string;confirmation?:string};
  try { body=await request.json(); } catch { return reply({error:'Invalid request'},400); }
  const id=body.user_id || '';
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id) || body.confirmation !== `DELETE AUTH ${id}` || id===identity.user.id) return reply({error:'Confirmation mismatch or invalid account'},400);
  // Check twice: the account may belong to another hostel. Avoid any data access outside a restricted identity query.
  const {count,error:memberError} = await admin.from('hostel_memberships').select('id',{count:'exact',head:true}).eq('user_id',id);
  if (memberError) return reply({error:'Membership check failed; Auth account preserved'},409);
  if ((count ?? 0)>0) return reply({error:'Account is still a member of a hostel; preserved'},409);
  const {data:target,error:targetError} = await admin.from('profiles').select('role').eq('id',id).maybeSingle();
  if (targetError || target?.role === 'super_admin') return reply({error:'Account cannot be removed'},403);
  const {error:deleteError} = await admin.auth.admin.deleteUser(id);
  if (deleteError) return reply({error:'Auth account deletion failed; inspect Edge Function logs'},500);
  // A missing audit record must not be misreported as a failure of already-completed deletion.
  const {error:auditError}=await admin.from('platform_audit_log').insert({actor_user_id:identity.user.id,action:'admin_delete_unlinked_auth',target_type:'user',target_id:id,details:{source:'super_admin_panel'}});
  return reply({deleted:true,audit_warning:Boolean(auditError)});
});
