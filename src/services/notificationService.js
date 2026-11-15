import { supabase } from '../lib/supabase';
import { cachedRequest, invalidateRequestCache } from '../lib/requestCache';

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

export async function fetchNotifications(limit = 50, { force = false } = {}) {
  assertSupabase();
  return cachedRequest(`notifications:inbox:${limit}`, async () => {
    const { data, error } = await supabase.rpc('get_notifications', { p_limit: limit });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }, { ttlMs: 30000, force });
}

export async function fetchPinnedManagerAnnouncement({ force = false } = {}) {
  assertSupabase();
  return cachedRequest('notifications:pinned-announcement', async () => {
    const { data, error } = await supabase.rpc('get_hostel_pinned_announcement');
    if (error) throw error;
    return data && typeof data === 'object' ? data : null;
  }, { ttlMs: 60000, force });
}

export async function markNotificationSeen(notificationId) {
  assertSupabase();
  const { error } = await supabase.rpc('mark_notification_seen', {
    p_notification_id: notificationId,
  });
  if (error) throw error;
  invalidateRequestCache('notifications:');
}

export async function deleteMyNotification(notificationId) {
  assertSupabase();
  const { error } = await supabase.rpc('delete_my_notification', {
    p_notification_id: notificationId,
  });
  if (error) throw error;
  invalidateRequestCache('notifications:');
}

export async function managerSendNotification(title, body) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_send_notification', {
    p_title: title,
    p_body: body,
  });
  if (error) throw error;
  invalidateRequestCache('notifications:');
  return data ?? null;
}

export async function managerDeleteNotification(notificationId) {
  assertSupabase();
  const { error } = await supabase.rpc('manager_delete_notification', {
    p_notification_id: notificationId,
  });
  if (error) throw error;
  invalidateRequestCache('notifications:');
}

export async function managerClearHostelPinnedAnnouncement() {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_clear_hostel_pinned_announcement');
  if (error) throw error;
  invalidateRequestCache('notifications:');
  return data ?? null;
}

// Server-authorized bulk operation applies only to the signed-in recipient.
export async function deleteAllMyNotifications() {
  assertSupabase();
  const { data, error } = await supabase.rpc('delete_all_my_notifications');
  if (error) throw error;
  invalidateRequestCache('notifications:');
  return data;
}
