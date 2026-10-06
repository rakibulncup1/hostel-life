import { supabase } from '../lib/supabase';

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

function unwrapData(data) {
  if (Array.isArray(data) && data.length === 1 && data[0] == null) return null;
  return data;
}

export async function fetchMemberDirectory() {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_member_directory');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function fetchMyMealRequests(limit = 100) {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_my_meal_requests', { p_limit: limit });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function fetchManagerMealRequests({ periodId = null, requestType = null, status = null, limit = 200 } = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_get_meal_requests', {
    p_period_id: periodId,
    p_request_type: requestType,
    p_status: status,
    p_limit: limit,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function createMealRequest({ startDate, endDate, days }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('create_meal_request', {
    p_start_date: startDate,
    p_end_date: endDate,
    p_days: days,
  });
  if (error) throw error;
  return unwrapData(data);
}

export async function editApprovedMealRequest({ requestId, startDate, endDate, days }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('edit_my_approved_meal_request', {
    p_request_id: requestId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_days: days,
  });
  if (error) throw error;
  return unwrapData(data);
}

export async function createMealCorrectionRequest({ startDate, endDate, days, parentRequestId = null }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('create_meal_correction_request', {
    p_start_date: startDate,
    p_end_date: endDate,
    p_days: days,
    p_parent_request_id: parentRequestId,
  });
  if (error) throw error;
  return unwrapData(data);
}

export async function reviewMealCorrection({ requestId, approve, reason = null }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_review_correction', {
    p_request_id: requestId,
    p_approve: approve,
    p_reason: reason,
  });
  if (error) throw error;
  return unwrapData(data);
}

export async function createMarketEntry({ entryDate, buyerMembershipId, items, creditToBuyer }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('create_market_entry', {
    p_entry_date: entryDate,
    p_buyer_membership_id: buyerMembershipId,
    p_items: items,
    p_credit_to_buyer: creditToBuyer,
  });
  if (error) throw error;
  return unwrapData(data);
}

export async function addManagerDeposit({ memberId, amount, date, description }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_add_deposit', {
    p_member_id: memberId,
    p_amount: amount,
    p_date: date,
    p_description: description || null,
  });
  if (error) throw error;
  return data;
}

export async function addManagerOtherExpense({ memberId, amount, date, description }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_add_other_expense', {
    p_member_id: memberId,
    p_amount: amount,
    p_date: date,
    p_description: description,
  });
  if (error) throw error;
  return data;
}

export async function setManagerMealEntries(entries) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_set_meal_entries', {
    p_entries: entries,
  });
  if (error) throw error;
  return unwrapData(data);
}

export async function fetchMealEntryData(date) {
  assertSupabase();
  const { data: day, error: dayError } = await supabase
    .from('daily_meal_days')
    .select('id, meal_date, status, cutoff_at, finalizes_at, locked_at, finalized_at')
    .eq('meal_date', date)
    .maybeSingle();
  if (dayError) throw dayError;
  if (!day) return { day: null, records: [] };

  const { data: records, error: recordsError } = await supabase
    .from('daily_meal_records')
    .select('member_id, planned_breakfast, planned_lunch, planned_dinner, actual_breakfast, actual_lunch, actual_dinner, final_breakfast, final_lunch, final_dinner, cancelled')
    .eq('daily_meal_day_id', day.id);
  if (recordsError) throw recordsError;

  return { day, records: Array.isArray(records) ? records : [] };
}

export async function fetchRunningPeriod() {
  assertSupabase();
  const { data, error } = await supabase
    .from('monthly_periods')
    .select('id, label, start_date, end_date, status')
    .eq('status', 'running')
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}
