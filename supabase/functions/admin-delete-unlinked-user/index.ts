// Deploy with JWT verification enabled. Never expose the service role key in the browser.
import { createClient } from 'npm:@supabase/supabase-js@2';

const FUNCTION_VERSION = '2026-11-06-orphan-bulk-delete-3-api-keys';
const AUTH_PAGE_SIZE = 50;
const AUTH_PAGES_PER_BATCH = 10; // up to 500 Auth users per visible batch
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: cors });
const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

function defaultApiKey(mapName: string): string {
  const raw = Deno.env.get(mapName)?.trim() ?? '';
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    const value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).default : null;
    return typeof value === 'string' ? value.trim() : '';
  } catch { return ''; }
}
const publishableKey = () => defaultApiKey('SUPABASE_PUBLISHABLE_KEYS') || Deno.env.get('SUPABASE_ANON_KEY')?.trim() || '';
const secretKey = () => defaultApiKey('SUPABASE_SECRET_KEYS') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() || '';

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED', message: 'শুধু POST গ্রহণযোগ্য।', request_id: requestId }, 405);

  try {
    const jwt = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
    const url = Deno.env.get('SUPABASE_URL') || '';
    const anon = publishableKey();
    const service = secretKey();
    if (!jwt || !url || !anon || !service) {
      return reply({ error: 'AUTH_OR_CONFIG_UNAVAILABLE', message: 'লগইন সেশন অথবা Edge Function-এর server configuration অনুপস্থিত।', request_id: requestId }, 401);
    }
    const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: identity, error: authError } = await caller.auth.getUser(jwt);
    if (authError || !identity.user) return reply({ error: 'INVALID_SESSION', message: 'লগইন সেশন বৈধ নয়। আবার লগইন করুন।', request_id: requestId }, 401);
    const { data: profile, error: profileError } = await admin.from('profiles').select('role,is_blocked').eq('id', identity.user.id).maybeSingle();
    if (profileError) {
      console.error('admin-delete-unlinked-user profile lookup failed', { request_id: requestId, message: profileError.message, code: profileError.code });
      return reply({ error: 'PROFILE_LOOKUP_FAILED', message: `Super Admin পরিচয় যাচাই করা যায়নি: ${profileError.message}`, request_id: requestId }, 500);
    }
    if (!profile || profile.role !== 'super_admin' || profile.is_blocked) return reply({ error: 'SUPER_ADMIN_ONLY', message: 'সক্রিয় Super Admin অনুমতি প্রয়োজন।', request_id: requestId }, 403);

    let body: { action?: string; page?: number; user_id?: string; user_ids?: string[]; confirmation?: string };
    try { body = await request.json(); } catch { return reply({ error: 'INVALID_REQUEST', message: 'Request body পড়া যায়নি।', request_id: requestId }, 400); }

    if (body.action === 'healthcheck') {
      return reply({ ok: true, function: 'admin-delete-unlinked-user', version: FUNCTION_VERSION, caller_role: profile.role, request_id: requestId });
    }

    if (body.action === 'list') {
      // The page in the UI is a scan batch, not a single Auth API page. This avoids
      // showing a false empty result when the first 50 users all have memberships.
      const batch = Math.max(1, Math.min(100, Math.trunc(Number(body.page) || 1)));
      const firstAuthPage = ((batch - 1) * AUTH_PAGES_PER_BATCH) + 1;
      const scannedUsers: Array<{ id: string; email?: string; created_at?: string }> = [];
      let pagesScanned = 0;
      let reachedEnd = false;
      for (let offset = 0; offset < AUTH_PAGES_PER_BATCH; offset += 1) {
        const authPage = firstAuthPage + offset;
        if (authPage > 1000) { reachedEnd = true; break; }
        const { data, error: listError } = await admin.auth.admin.listUsers({ page: authPage, perPage: AUTH_PAGE_SIZE });
        if (listError) {
          console.error('admin-delete-unlinked-user listUsers failed', { request_id: requestId, auth_page: authPage, message: listError.message, status: listError.status });
          return reply({ error: 'AUTH_USER_LIST_FAILED', message: `Auth account তালিকা page ${authPage}-এ ব্যর্থ হয়েছে: ${listError.message}`, request_id: requestId }, 500);
        }
        const users = data?.users || [];
        pagesScanned += 1;
        scannedUsers.push(...users.map(user => ({ id: user.id, email: user.email || '', created_at: user.created_at })));
        if (users.length < AUTH_PAGE_SIZE || authPage >= 1000) { reachedEnd = true; break; }
      }
      const ids = scannedUsers.map(user => user.id);
      const linkedIds = new Set<string>();
      const protectedSuperAdminIds = new Set<string>();
      // Use 50-ID subqueries to avoid request URL limits and give precise errors.
      for (let start = 0; start < ids.length; start += AUTH_PAGE_SIZE) {
        const group = ids.slice(start, start + AUTH_PAGE_SIZE);
        if (!group.length) continue;
        const [{ data: links, error: linkError }, { data: profiles, error: profileListError }] = await Promise.all([
          admin.from('hostel_memberships').select('user_id').in('user_id', group),
          admin.from('profiles').select('id,role').in('id', group),
        ]);
        if (linkError) {
          console.error('admin-delete-unlinked-user membership query failed', { request_id: requestId, message: linkError.message, code: linkError.code });
          return reply({ error: 'MEMBERSHIP_VERIFICATION_FAILED', message: `মেম্বারশিপ যাচাই করা যায়নি: ${linkError.message}`, request_id: requestId }, 500);
        }
        if (profileListError) {
          console.error('admin-delete-unlinked-user profile directory query failed', { request_id: requestId, message: profileListError.message, code: profileListError.code });
          return reply({ error: 'PROFILE_DIRECTORY_FAILED', message: `Super Admin account সুরক্ষিত কি না যাচাই করা যায়নি: ${profileListError.message}`, request_id: requestId }, 500);
        }
        for (const link of links || []) if (link.user_id) linkedIds.add(String(link.user_id));
        for (const item of profiles || []) if (item.role === 'super_admin') protectedSuperAdminIds.add(String(item.id));
      }
      const items = scannedUsers.filter(user => !linkedIds.has(user.id) && !protectedSuperAdminIds.has(user.id) && user.id !== identity.user.id);
      return reply({
        items, page: batch, has_more: !reachedEnd, scanned_users: scannedUsers.length,
        auth_pages_scanned: pagesScanned, auth_page_start: firstAuthPage,
        auth_page_end: firstAuthPage + Math.max(0, pagesScanned - 1),
        message: items.length ? `${items.length}টি মেস-বিহীন Auth account পাওয়া গেছে।` : `${scannedUsers.length}টি Auth account পরীক্ষা করে এই ধাপে মেস-বিহীন account পাওয়া যায়নি।`,
        request_id: requestId,
      });
    }

    if (body.action === 'delete_many') {
      const rawIds = Array.isArray(body.user_ids) ? body.user_ids : [];
      const ids = [...new Set(rawIds)];
      if (rawIds.length < 1 || rawIds.length > 25 || ids.length !== rawIds.length || ids.some((id) => !isUuid(id))) {
        return reply({ error: 'INVALID_BULK_SELECTION', message: 'একবারে ১–২৫টি ভিন্ন ও বৈধ Auth account নির্বাচন করতে হবে।', request_id: requestId }, 400);
      }
      const expected = `DELETE ${ids.length} ORPHAN AUTH ACCOUNTS`;
      if (body.confirmation !== expected || ids.includes(identity.user.id)) {
        return reply({ error: 'CONFIRMATION_MISMATCH', message: 'Bulk deletion-এর নিশ্চিতকরণ মেলেনি অথবা নিজের Admin account নির্বাচন করা হয়েছে। কোনো পরিবর্তন করা হয়নি।', request_id: requestId }, 400);
      }

      // Auth Admin deletion is not part of a Postgres transaction. Recheck each
      // account immediately before deletion and return per-account outcomes;
      // one unsafe/failed account never causes the remaining checks to be skipped.
      const results: Array<{ user_id: string; deleted: boolean; code?: string; message?: string; audit_warning?: boolean }> = [];
      for (const targetId of ids) {
        const { count, error: memberError } = await admin.from('hostel_memberships')
          .select('id', { count: 'exact', head: true }).eq('user_id', targetId);
        if (memberError) {
          results.push({ user_id: targetId, deleted: false, code: 'MEMBERSHIP_CHECK_FAILED', message: 'সদস্যপদ যাচাই ব্যর্থ; account রাখা হয়েছে।' });
          continue;
        }
        if ((count ?? 0) > 0) {
          results.push({ user_id: targetId, deleted: false, code: 'ACCOUNT_STILL_LINKED', message: 'এই account এখনও একটি বা একাধিক মেসের membership-এ যুক্ত।' });
          continue;
        }
        const { data: target, error: targetError } = await admin.from('profiles').select('role').eq('id', targetId).maybeSingle();
        if (targetError || target?.role === 'super_admin') {
          results.push({ user_id: targetId, deleted: false, code: 'ACCOUNT_PROTECTED', message: 'Super Admin পরিচয় যাচাই হয়নি অথবা account সুরক্ষিত।' });
          continue;
        }
        const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
        if (deleteError) {
          console.error('admin-delete-unlinked-user bulk delete failed', { request_id: requestId, target_id: targetId, code: deleteError.code, status: deleteError.status });
          results.push({ user_id: targetId, deleted: false, code: 'AUTH_ACCOUNT_DELETE_FAILED', message: 'Supabase Auth account মুছে ফেলা যায়নি।' });
          continue;
        }
        const { error: auditError } = await admin.from('platform_audit_log').insert({
          actor_user_id: identity.user.id, action: 'admin_delete_unlinked_auth', target_type: 'user', target_id: targetId,
          reason: 'Super Admin কর্তৃক নির্বাচিত orphan Auth account bulk deletion',
          details: { source: 'super_admin_panel_bulk', request_id: requestId, selection_size: ids.length },
        });
        if (auditError) console.error('admin-delete-unlinked-user bulk audit insert failed after deletion', { request_id: requestId, target_id: targetId, code: auditError.code });
        results.push({ user_id: targetId, deleted: true, audit_warning: Boolean(auditError) });
      }
      const deletedCount = results.filter((item) => item.deleted).length;
      return reply({ success: true, requested: ids.length, deleted_count: deletedCount, failed_count: ids.length - deletedCount, results, request_id: requestId });
    }

    const id = body.user_id || '';
    if (!isUuid(id) || body.confirmation !== `DELETE AUTH ${id}` || id === identity.user.id) {
      return reply({ error: 'CONFIRMATION_MISMATCH', message: 'Auth account ডিলিটের নিশ্চিতকরণ মেলেনি। কোনো পরিবর্তন করা হয়নি।', request_id: requestId }, 400);
    }
    const { count, error: memberError } = await admin.from('hostel_memberships').select('id', { count: 'exact', head: true }).eq('user_id', id);
    if (memberError) return reply({ error: 'MEMBERSHIP_CHECK_FAILED', message: `সদস্যপদ যাচাই ব্যর্থ হয়েছে; Auth account রাখা হয়েছে: ${memberError.message}`, request_id: requestId }, 409);
    if ((count ?? 0) > 0) return reply({ error: 'ACCOUNT_STILL_LINKED', message: 'এই account এখনও অন্তত একটি মেসের membership টেবিলে রয়েছে; নিরাপত্তার জন্য মুছে ফেলা হয়নি।', request_id: requestId }, 409);
    const { data: target, error: targetError } = await admin.from('profiles').select('role').eq('id', id).maybeSingle();
    if (targetError || target?.role === 'super_admin') return reply({ error: 'ACCOUNT_PROTECTED', message: 'এই account ডিলিট করা যাবে না।', request_id: requestId }, 403);

    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    if (deleteError) {
      console.error('admin-delete-unlinked-user delete failed', { request_id: requestId, target_id: id, message: deleteError.message, status: deleteError.status });
      return reply({ error: 'AUTH_ACCOUNT_DELETE_FAILED', message: `Supabase Auth account মুছতে পারেনি: ${deleteError.message}`, request_id: requestId }, 500);
    }
    const { error: auditError } = await admin.from('platform_audit_log').insert({
      actor_user_id: identity.user.id, action: 'admin_delete_unlinked_auth', target_type: 'user', target_id: id,
      details: { source: 'super_admin_panel', request_id: requestId },
    });
    if (auditError) console.error('admin-delete-unlinked-user audit insert failed after deletion', { request_id: requestId, target_id: id, message: auditError.message });
    return reply({ deleted: true, audit_warning: Boolean(auditError), request_id: requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('admin-delete-unlinked-user unexpected failure', { request_id: requestId, message });
    return reply({ error: 'UNEXPECTED_SERVER_ERROR', message: `Edge Function-এ অপ্রত্যাশিত ত্রুটি হয়েছে: ${message}`, request_id: requestId }, 500);
  }
});
