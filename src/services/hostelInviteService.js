import { supabase } from '../lib/supabase';

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

export async function getHostelInviteLinkInfo(token) {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_hostel_invite_link_info', { p_token: token });
  if (error) throw error;
  return firstRow(data) || {};
}

export async function createHostelJoinRequestFromInvite(token, note = '') {
  assertSupabase();
  const { data, error } = await supabase.rpc('create_hostel_join_request_from_link', {
    p_token: token,
    p_request_note: note.trim() || null,
  });
  if (error) throw error;
  return firstRow(data) || {};
}

export async function getMyHostelJoinRequestStatus(token) {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_my_hostel_join_request_status', { p_token: token });
  if (error) throw error;
  return firstRow(data) || {};
}

export async function managerCreateHostelInviteLink(expiresAt, label = '') {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_create_hostel_invite_link', {
    p_expires_at: expiresAt || null,
    p_label: label.trim(),
  });
  if (error) throw error;
  return firstRow(data) || {};
}

export async function managerListHostelInviteLinks() {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_list_hostel_invite_links');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function managerRevokeHostelInviteLink(linkId) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_revoke_hostel_invite_link', { p_link_id: linkId });
  if (error) throw error;
  return firstRow(data) || data;
}

export async function managerListHostelJoinRequests() {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_list_hostel_join_requests');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function managerReviewHostelJoinRequest(requestId, approve, note = '') {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_review_hostel_join_request', {
    p_request_id: requestId,
    p_approve: Boolean(approve),
    p_review_note: note.trim() || null,
  });
  if (error) throw error;
  return firstRow(data) || data;
}
