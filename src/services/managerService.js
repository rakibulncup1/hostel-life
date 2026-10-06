import { supabase } from '../lib/supabase';

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

function unwrap(data) {
  if (Array.isArray(data) && data.length === 1 && data[0] == null) return null;
  return Array.isArray(data) ? data[0] ?? data : data ?? null;
}

export async function startNewMonth(startDate, endDate) {
  assertSupabase();
  const { data, error } = await supabase.rpc('start_new_month', {
    p_start_date: startDate,
    p_end_date: endDate,
  });
  if (error) throw error;
  return unwrap(data);
}

export async function changeManager(newMembershipId) {
  assertSupabase();
  const { data, error } = await supabase.rpc('change_manager', { p_new_membership_id: newMembershipId });
  if (error) throw error;
  return unwrap(data);
}

export async function deactivateMember(membershipId) {
  assertSupabase();
  const { data, error } = await supabase.rpc('deactivate_member', { p_membership_id: membershipId });
  if (error) throw error;
  return unwrap(data);
}

export async function reactivateMember(membershipId) {
  assertSupabase();
  const { data, error } = await supabase.rpc('reactivate_member', { p_membership_id: membershipId });
  if (error) throw error;
  return unwrap(data);
}

export async function updateHostel(name) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_update_hostel', { p_name: name });
  if (error) throw error;
  return unwrap(data);
}

export async function regenerateJoinCode() {
  assertSupabase();
  const { data, error } = await supabase.rpc('regenerate_join_code');
  if (error) throw error;
  return typeof data === 'string' ? data : unwrap(data);
}

export async function fetchArchivePermissions(periodId = null) {
  assertSupabase();
  let query = supabase
    .from('archive_edit_permissions')
    .select('id,period_id,membership_id,granted_by,reason,expires_at,revoked_at,created_at');
  if (periodId) query = query.eq('period_id', periodId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function grantArchiveEditPermission({ periodId, membershipId, expiresAt = null, reason = null }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('grant_archive_edit_permission', {
    p_period_id: periodId,
    p_membership_id: membershipId,
    p_expires_at: expiresAt,
    p_reason: reason || null,
  });
  if (error) throw error;
  return unwrap(data);
}

export async function revokeArchiveEditPermission(permissionId) {
  assertSupabase();
  const { data, error } = await supabase.rpc('revoke_archive_edit_permission', {
    p_permission_id: permissionId,
  });
  if (error) throw error;
  return data;
}

export async function addKhalaMoney({ memberId, amount, date, description = null }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_add_khala_money', {
    p_member_id: memberId,
    p_amount: amount,
    p_date: date,
    p_description: description || null,
  });
  if (error) throw error;
  return unwrap(data);
}

export async function updateKhalaMoney({ entryId, memberId, amount, date, description = null }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_update_khala_money', {
    p_entry_id: entryId,
    p_member_id: memberId,
    p_amount: amount,
    p_date: date,
    p_description: description || null,
  });
  if (error) throw error;
  return unwrap(data);
}

export async function voidKhalaMoney(entryId, reason) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_void_khala_money', {
    p_entry_id: entryId,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}

export async function adjustTransaction({ transactionId, newAmount, description = null }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_adjust_transaction', {
    p_transaction_id: transactionId,
    p_new_amount: newAmount,
    p_description: description || null,
  });
  if (error) throw error;
  return unwrap(data);
}

export async function updateMarketEntry({ marketEntryId, entryDate, buyerMembershipId, items, creditToBuyer, reason = null }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_update_market_entry', {
    p_market_entry_id: marketEntryId,
    p_entry_date: entryDate,
    p_buyer_membership_id: buyerMembershipId,
    p_items: items,
    p_credit_to_buyer: creditToBuyer,
    p_reason: reason || null,
  });
  if (error) throw error;
  return unwrap(data);
}

export async function voidMarketEntry(marketEntryId, reason) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_void_market_entry', {
    p_market_entry_id: marketEntryId,
    p_reason: reason,
  });
  if (error) throw error;
  return unwrap(data);
}
