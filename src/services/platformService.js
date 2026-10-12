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
  const { data, error } = await supabase.rpc('platform_admin_list_hostels');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function platformAdminListHostelMembers(hostelId) {
  assertSupabase();
  const { data, error } = await supabase.rpc('platform_admin_list_hostel_members', { p_hostel_id: hostelId });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
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
