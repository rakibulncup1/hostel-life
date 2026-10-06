import { supabase } from '../lib/supabase';

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

export async function fetchNotifications(limit = 50) {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_notifications', { p_limit: limit });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function markNotificationSeen(notificationId) {
  assertSupabase();
  const { error } = await supabase.rpc('mark_notification_seen', {
    p_notification_id: notificationId,
  });
  if (error) throw error;
}

export async function deleteMyNotification(notificationId) {
  assertSupabase();
  const { error } = await supabase.rpc('delete_my_notification', {
    p_notification_id: notificationId,
  });
  if (error) throw error;
}

export async function managerSendNotification(title, body) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_send_notification', {
    p_title: title,
    p_body: body,
  });
  if (error) throw error;
  return data ?? null;
}

export async function managerDeleteNotification(notificationId) {
  assertSupabase();
  const { error } = await supabase.rpc('manager_delete_notification', {
    p_notification_id: notificationId,
  });
  if (error) throw error;
}
