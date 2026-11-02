import { supabase } from '../lib/supabase';

let publicSettingsCache = null;
let publicSettingsCachedAt = 0;
let publicSettingsInFlight = null;
const PUBLIC_SETTINGS_TTL_MS = 5 * 60 * 1000;

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

export async function fetchPlatformPublicSettings({ force = false } = {}) {
  assertSupabase();
  if (!force && publicSettingsCache && Date.now() - publicSettingsCachedAt < PUBLIC_SETTINGS_TTL_MS) {
    return publicSettingsCache;
  }
  if (publicSettingsInFlight) return publicSettingsInFlight;
  const task = (async () => {
    const { data, error } = await supabase.rpc('get_platform_public_settings');
    if (error) throw error;
    publicSettingsCache = firstRow(data) || {};
    publicSettingsCachedAt = Date.now();
    return publicSettingsCache;
  })();
  publicSettingsInFlight = task;
  try { return await task; }
  finally { if (publicSettingsInFlight === task) publicSettingsInFlight = null; }
}

export function invalidatePlatformPublicSettingsCache() {
  publicSettingsCache = null;
  publicSettingsCachedAt = 0;
}

export async function platformAdminGetOverview() {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_get_overview');
  if (error) throw error;
  return data || {};
}

export async function platformAdminListHostels() {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_list_hostels_v3');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function platformAdminListHostelMembers(hostelId) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_list_hostel_members_v3', { p_hostel_id: hostelId });
  if (error) throw error;
  // Run27's hostel-scoped RPC already returns email/avatar for every member in
  // this hostel. A second global directory RPC was capped at 100 rows, added
  // latency, and could never reliably enrich members beyond that first page.
  return Array.isArray(data) ? data : [];
}

export async function platformAdminListHostelRoleBadges(hostelId) {
  assertSupabase();
  const { data, error } = await supabase.rpc('hl_platform_hostel_roles', { p_hostel_id: hostelId });
  if (error) throw error;
  const roles = {};
  for (const row of (Array.isArray(data) ? data : [])) {
    if (row?.membership_id) roles[row.membership_id] = { primary: Boolean(row.primary), assistant: Boolean(row.assistant) };
  }
  return roles;
}

export async function platformAdminSetHostelStatus(hostelId, status, reason = null) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_set_hostel_status', {
    p_hostel_id: hostelId, p_status: status, p_reason: reason || null,
  });
  if (error) throw error;
  return firstRow(data) || data;
}

export async function platformAdminSetUserBlocked(userId, blocked, reason = null) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_set_user_blocked', {
    p_user_id: userId, p_blocked: blocked, p_reason: reason || null,
  });
  if (error) throw error;
  return firstRow(data) || data;
}

export async function platformAdminUpdatePublicSettings(settings) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_update_public_settings', {
    p_announcement_enabled: Boolean(settings.announcement_enabled),
    p_announcement_title: settings.announcement_title || '',
    p_announcement_body: settings.announcement_body || '',
    p_developer_name: settings.developer_name || '',
    p_developer_title: settings.developer_title || '',
    p_developer_photo_url: settings.developer_photo_url || '',
    p_developer_email: settings.developer_email || '',
    p_developer_phone: settings.developer_phone || '',
    p_developer_portfolio_url: settings.developer_portfolio_url || '',
  });
  if (error) throw error;
  invalidatePlatformPublicSettingsCache();
  return firstRow(data) || data;
}

export async function platformAdminSetGate(purpose, required) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_set_gate', { p_purpose: purpose, p_required: required });
  if (error) throw error;
  invalidatePlatformPublicSettingsCache();
  return firstRow(data) || data;
}

export async function platformAdminGenerateAccessCode(purpose, ttlMinutes, maxUses) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_generate_access_code', {
    p_purpose: purpose, p_ttl_minutes: Number(ttlMinutes), p_max_uses: Number(maxUses),
  });
  if (error) throw error;
  return firstRow(data) || data;
}


export async function platformAdminSetHostelFlag(hostelId, flag, enabled) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_set_hostel_flag', {
    p_hostel_id: hostelId, p_flag: flag, p_enabled: Boolean(enabled),
  });
  if (error) throw error;
  return firstRow(data) || data;
}

export async function platformAdminSetUserFlag(userId, flag, enabled) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_set_user_flag', {
    p_user_id: userId, p_flag: flag, p_enabled: Boolean(enabled),
  });
  if (error) throw error;
  return firstRow(data) || data;
}

export async function platformAdminPermanentlyDeleteHostel(hostelId, deleteMemberAccounts, confirmation) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_permanently_delete_hostel', {
    p_hostel_id: hostelId,
    p_delete_member_accounts: Boolean(deleteMemberAccounts),
    p_confirmation: confirmation,
  });
  if (error) throw error;
  return firstRow(data) || data;
}

export async function platformAdminPermanentlyDeleteMember(hostelId, membershipId, deleteAuthAccount, confirmation) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_permanently_delete_member', {
    p_hostel_id: hostelId,
    p_membership_id: membershipId,
    p_delete_auth_account: Boolean(deleteAuthAccount),
    p_confirmation: confirmation,
  });
  if (error) throw error;
  return firstRow(data) || data;
}

export async function uploadDeveloperPhoto(userId, file) {
  assertSupabase();
  if (!userId) throw new Error('অ্যাডমিন পরিচয় পাওয়া যায়নি।');
  if (!(file instanceof File) || !/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    throw new Error('শুধু JPG, PNG বা WEBP ছবি ব্যবহার করুন।');
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('ছবির আকার ৫ MB-এর কম হতে হবে।');
  const toJpeg = async (input) => {
    const url = URL.createObjectURL(input);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('ছবিটি পড়া যায়নি।')); img.src = url;
      });
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('ছবি প্রস্তুত করা যায়নি।');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('ছবি compress করা যায়নি।')), 'image/jpeg', 0.88));
      if (blob.size > 3 * 1024 * 1024) throw new Error('ছবিটি compress করার পরও বড়। ছোট ছবি ব্যবহার করুন।');
      return blob;
    } finally { URL.revokeObjectURL(url); }
  };
  const blob = await toJpeg(file);
  const path = 'developer-info/developer-photo.jpg';
  const { error } = await supabase.storage.from('developer-assets').upload(path, blob, {
    upsert: true, contentType: 'image/jpeg', cacheControl: '3600',
  });
  if (error) throw error;
  const { data } = supabase.storage.from('developer-assets').getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('ছবির URL তৈরি করা যায়নি।');
  return `${data.publicUrl}?v=${Date.now()}`;
}


// Retention controls deliberately use authenticated admin-only RPCs. Missing SQL
// fails closed; the browser never deletes archive rows directly.
export async function platformAdminGetRetention() {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_get_retention');
  if (error) throw error;
  return firstRow(data) || {};
}

export async function platformAdminUpdateRetention(detailMonths, summaryMonths) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_update_retention', {
    p_detail_months: Number(detailMonths), p_summary_months: Number(summaryMonths),
  });
  if (error) throw error;
  return firstRow(data) || data;
}

export async function platformAdminListExpiredArchives() {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_list_expired_archives');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function platformAdminDeleteExpiredArchive(hostelId, periodId, confirmation) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_delete_expired_archive', {
    p_hostel_id: hostelId, p_period_id: periodId, p_confirmation: confirmation,
  });
  if (error) throw error;
  return firstRow(data) || data;
}

// Pro Master SQL: these administrative functions are separate deliberate steps.
export async function platformAdminFinalizeArchiveSummary(periodId) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_finalize_archive_summary', { p_period_id: periodId });
  if (error) throw error;
  return firstRow(data) || data;
}
export async function platformAdminVerifyArchiveSummary(periodId, confirmation) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_verify_archive_summary', { p_period_id: periodId, p_confirmation: confirmation });
  if (error) throw error;
  return firstRow(data) || data;
}
export async function platformAdminListSavedSummaries() {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_list_saved_summaries');
  if (error) throw error;
  // This RPC returns a JSONB array, not a set of SQL rows. Do not pass that
  // array through firstRow(), which would silently keep only the first item
  // (and turn a one-row array into an object) so the retention panel showed []
  // or an incomplete list.
  return Array.isArray(data) ? data : [];
}

export async function platformAdminListClosedPeriods() {
  assertSupabase();
  const {data,error}=await supabase.rpc('platform_admin_list_closed_periods');
  if(error) throw error;
  return Array.isArray(data) ? data : [];
}


// Read-only, server-scoped Super Admin observability endpoints.
// The browser never queries platform_audit_log or platform_access_codes directly.
export async function platformAdminListAuditLogs({ limit = 25, offset = 0, action = null, targetType = null, search = null } = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_list_audit_logs', {
    p_limit: Math.min(100, Math.max(1, Number(limit) || 25)),
    p_offset: Math.max(0, Number(offset) || 0),
    p_action: action || null,
    p_target_type: targetType || null,
    p_search: search || null,
  });
  if (error) throw error;
  return firstRow(data) || {};
}

export async function platformAdminListAccessCodeHistory({ limit = 20, offset = 0, purpose = null } = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_list_access_code_history', {
    p_limit: Math.min(100, Math.max(1, Number(limit) || 20)),
    p_offset: Math.max(0, Number(offset) || 0),
    p_purpose: purpose || null,
  });
  if (error) throw error;
  return firstRow(data) || {};
}


// Super Admin hostel/month insights. The backend returns aggregate-only data
// and never exposes member-level financial or meal records.
export async function platformAdminGetHostelInsights(hostelId, periodId = null) {
  assertSupabase();
  if (!hostelId) throw new Error('একটি মেস নির্বাচন করুন।');
  const { data, error } = await supabase.rpc('platform_admin_get_hostel_insights', {
    p_hostel_id: hostelId,
    p_period_id: periodId || null,
  });
  if (error) throw error;
  return firstRow(data) || {};
}

// Phase 3: Super Admin-only operational monitoring and aggregate report endpoints.
export async function platformAdminGetSystemHealth(staleDays = 14) {
  assertSupabase();
  const safeDays = Math.min(60, Math.max(7, Number(staleDays) || 14));
  const { data, error } = await supabase.rpc('platform_admin_get_system_health', { p_stale_days: safeDays });
  if (error) throw error;
  return firstRow(data) || {};
}

export async function platformAdminListNoticeMonitoring({ limit = 25, offset = 0, search = null } = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_list_notice_monitoring', {
    p_limit: Math.min(100, Math.max(1, Number(limit) || 25)),
    p_offset: Math.max(0, Number(offset) || 0),
    p_search: search ? String(search).slice(0, 120) : null,
  });
  if (error) throw error;
  return firstRow(data) || {};
}

export async function platformAdminGetPlatformReport(fromDate, toDate) {
  assertSupabase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(toDate || '')) {
    throw new Error('রিপোর্টের তারিখ সঠিকভাবে নির্বাচন করুন।');
  }
  if (toDate < fromDate) throw new Error('শেষ তারিখ শুরুর তারিখের আগে হতে পারবে না।');
  const { data, error } = await supabase.rpc('platform_admin_get_platform_report', {
    p_from_date: fromDate, p_to_date: toDate,
  });
  if (error) throw error;
  return firstRow(data) || {};
}

// V1.18 Module 3 — server-authorized observability. All sensitive reads are RPCs;
// browser code never selects from private tracking tables directly.
export async function platformAdminListActivity({ hostelId = null, eventType = null, limit = 30, offset = 0 } = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_list_activity', {
    p_hostel_id: hostelId || null,
    p_event_type: eventType || null,
    p_limit: Number(limit) || 30,
    p_offset: Number(offset) || 0,
  });
  if (error) throw error;
  return data || { items: [], total_count: 0 };
}

export async function platformAdminGetMemberActivityOverview(hostelId, userId) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_get_member_activity_overview', {
    p_hostel_id: hostelId,
    p_user_id: userId,
  });
  if (error) throw error;
  return firstRow(data) || data || {};
}

export async function platformAdminListMemberActivity(hostelId, userId, limit = 30, offset = 0) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_list_member_activity', {
    p_hostel_id: hostelId,
    p_user_id: userId,
    p_limit: Number(limit) || 30,
    p_offset: Number(offset) || 0,
  });
  if (error) throw error;
  return data || { items: [], total_count: 0 };
}

export async function platformAdminListMemberSessions(hostelId, userId, limit = 20, offset = 0) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_list_member_sessions', {
    p_hostel_id: hostelId,
    p_user_id: userId,
    p_limit: Number(limit) || 20,
    p_offset: Number(offset) || 0,
  });
  if (error) throw error;
  return data || { items: [], total_count: 0 };
}

export async function platformAdminGetSecurityOverview() {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_get_security_overview');
  if (error) throw error;
  return firstRow(data) || data || {};
}

export async function platformAdminListSecurityEvents({ eventType = null, ipSearch = null, limit = 30, offset = 0 } = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_list_security_events', {
    p_event_type: eventType || null,
    p_ip_search: ipSearch || null,
    p_limit: Number(limit) || 30,
    p_offset: Number(offset) || 0,
  });
  if (error) throw error;
  return data || { items: [], total_count: 0 };
}

export async function platformAdminCheckSecurityTelemetry() {
  assertSupabase();
  const { data, error } = await supabase.functions.invoke('record-auth-event', { method: 'GET' });
  if (error) throw error;
  return data || { ready: false, code: 'EMPTY_HEALTH_RESPONSE' };
}

export async function platformAdminSetDefaultTheme(theme) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_set_default_theme', { p_theme: theme });
  if (error) throw error;
  invalidatePlatformPublicSettingsCache();
  return firstRow(data) || data;
}

export async function platformAdminGetSessionPolicy() {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_get_session_policy');
  if (error) throw error;
  return firstRow(data) || { max_devices_per_user: 10 };
}

export async function platformAdminSetMaxDevicesPerUser(limit) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_set_max_devices_per_user', { p_limit: Number(limit) });
  if (error) throw error;
  return firstRow(data) || data;
}
