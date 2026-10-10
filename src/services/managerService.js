import { supabase } from '../lib/supabase';

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

function unwrap(data) {
  if (Array.isArray(data) && data.length === 1 && data[0] == null) return null;
  return Array.isArray(data) ? data[0] ?? data : data ?? null;
}

async function rpc(name, params) {
  assertSupabase();
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data;
}

export async function fetchMonthManagementContext() {
  return rpc('get_month_management_context', {});
}

export async function fetchMealRequestOverlapDetails(periodId = null) {
  const data = await rpc('get_meal_request_overlap_details', { p_period_id: periodId });
  return Array.isArray(data) ? data : [];
}

export async function setRunningPeriodEndDate(newEndDate, confirmFutureCancel = false) {
  return unwrap(await rpc('manager_set_running_period_end_date', {
    p_new_end_date: newEndDate,
    p_confirm_future_cancel: confirmFutureCancel,
  }));
}

export async function closeCurrentMonth(confirmFutureCancel = false) {
  return unwrap(await rpc('close_current_month', {
    p_confirm_future_cancel: confirmFutureCancel,
  }));
}

export async function startNewMonth(startDate) {
  return unwrap(await rpc('start_new_month', { p_start_date: startDate }));
}

export async function changeManager(newMembershipId) {
  return unwrap(await rpc('change_manager', { p_new_membership_id: newMembershipId }));
}

export async function fetchKhalaPeriods() {
  const data = await rpc('get_khala_entry_periods_v2', {});
  return Array.isArray(data) ? data : [];
}

export async function fetchPeriodAssistants(periodId = null) {
  const data = await rpc('get_period_assistants', { p_period_id: periodId });
  return Array.isArray(data) ? data : [];
}

export async function setPeriodAssistants(membershipIds = [], periodId = null) {
  return unwrap(await rpc('set_period_assistant_managers', {
    p_membership_ids: membershipIds,
    p_period_id: periodId,
  }));
}

export async function deactivateMember(membershipId) {
  return unwrap(await rpc('deactivate_member', { p_membership_id: membershipId }));
}

export async function reactivateMember(membershipId) {
  return unwrap(await rpc('reactivate_member', { p_membership_id: membershipId }));
}

export async function updateHostel(name) {
  return unwrap(await rpc('manager_update_hostel', { p_name: name }));
}

export async function regenerateJoinCode() {
  const data = await rpc('regenerate_join_code', {});
  return typeof data === 'string' ? data : unwrap(data);
}

export async function fetchArchiveManagementItems() {
  const data = await rpc('get_archive_management_items', {});
  return Array.isArray(data) ? data : [];
}

export async function reopenArchivedPeriod(periodId) {
  return unwrap(await rpc('reopen_archived_period', { p_period_id: periodId }));
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
  return unwrap(await rpc('grant_archive_edit_permission', {
    p_period_id: periodId,
    p_membership_id: membershipId,
    p_expires_at: expiresAt,
    p_reason: reason || null,
  }));
}

export async function revokeArchiveEditPermission(permissionId) {
  return rpc('revoke_archive_edit_permission', { p_permission_id: permissionId });
}

export async function addKhalaMoney({ periodId, memberId, amount, paymentDate, description = null }) {
  return unwrap(await rpc('manager_add_khala_money_for_period', {
    p_period_id: periodId,
    p_member_id: memberId,
    p_amount: amount,
    p_payment_date: paymentDate,
    p_description: description || null,
  }));
}

export async function voidKhalaMoney(entryId, reason) {
  return rpc('manager_void_khala_money', {
    p_entry_id: entryId,
    p_reason: reason,
  });
}

export async function adjustTransaction({ transactionId, newAmount, description = null }) {
  return unwrap(await rpc('manager_adjust_transaction', {
    p_transaction_id: transactionId,
    p_new_amount: newAmount,
    p_description: description || null,
  }));
}

export async function updateMarketEntry({ marketEntryId, entryDate, buyerMembershipId, items, creditToBuyer, reason = null }) {
  return unwrap(await rpc('manager_update_market_entry', {
    p_market_entry_id: marketEntryId,
    p_entry_date: entryDate,
    p_buyer_membership_id: buyerMembershipId,
    p_items: items,
    p_credit_to_buyer: creditToBuyer,
    p_reason: reason || null,
  }));
}

export async function voidMarketEntry(marketEntryId, reason) {
  return rpc('manager_void_market_entry', {
    p_market_entry_id: marketEntryId,
    p_reason: reason,
  });
}

export async function saveManagerMyMeal({ startDate, endDate, days }) {
  return unwrap(await rpc('manager_save_my_meal', {
    p_start_date: startDate,
    p_end_date: endDate,
    p_days: days,
  }));
}


export async function managerEditApprovedMealRequest({ requestId, days }) {
  return unwrap(await rpc('manager_edit_approved_meal_request', {
    p_request_id: requestId,
    p_days: days,
  }));
}

export async function emergencyOverrideMyMeal({ mealDate, breakfast, lunch, dinner, reason = null }) {
  return unwrap(await rpc('manager_emergency_override_my_meal', {
    p_meal_date: mealDate,
    p_breakfast: breakfast,
    p_lunch: lunch,
    p_dinner: dinner,
    p_reason: reason || null,
  }));
}

export async function checkManagerMealEntryConflicts(entries = []) {
  return unwrap(await rpc('manager_check_meal_entry_conflicts', { p_entries: entries }));
}
