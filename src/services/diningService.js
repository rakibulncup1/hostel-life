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
  const v4 = await supabase.rpc('get_member_directory_v4');
  if (!v4.error) return Array.isArray(v4.data) ? v4.data : [];
  if (!(await isMissingFunctionError(v4.error))) throw v4.error;

  const latest = await supabase.rpc('get_member_directory_v3');
  if (!latest.error) return Array.isArray(latest.data) ? latest.data : [];
  if (!(await isMissingFunctionError(latest.error))) throw latest.error;

  const primary = await supabase.rpc('get_member_directory_v2');
  if (!primary.error) return Array.isArray(primary.data) ? primary.data : [];
  if (!(await isMissingFunctionError(primary.error))) throw primary.error;

  const fallback = await supabase.rpc('get_member_directory');
  if (fallback.error) throw fallback.error;
  return Array.isArray(fallback.data) ? fallback.data : [];
}

export async function fetchManagerMemberDirectory() {
  return fetchMemberDirectory();
}

export async function fetchMyMealRequests(limit = 100) {
  assertSupabase();
  const latest = await supabase.rpc('get_my_meal_requests_v2', { p_limit: limit });
  if (!latest.error) return Array.isArray(latest.data) ? latest.data : [];
  if (!(await isMissingFunctionError(latest.error))) throw latest.error;
  const { data, error } = await supabase.rpc('get_my_meal_requests', { p_limit: limit });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function isMissingFunctionError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '');
  // PostgREST may report an absent RPC as PGRST202/PGRST203 rather than PostgreSQL 42883.
  // Only treat genuine missing-function/schema-cache lookup errors as fallback cases.
  return code === '42883'
    || code === 'PGRST202'
    || code === 'PGRST203'
    || /function .* does not exist/i.test(message)
    || /could not find the function .* in the schema cache/i.test(message)
    || /schema cache.*function/i.test(message);
}

export async function fetchManagerMealRequests({ periodId = null, requestType = null, status = null, lateOnly = null, limit = 200 } = {}) {
  assertSupabase();
  const resolvedPeriod = periodId || (await fetchRunningPeriod())?.period_id || null;
  const v3 = await supabase.rpc('get_manager_meal_requests_v3', {
    p_period_id: resolvedPeriod,
    p_request_type: requestType,
    p_status: status,
    p_late_only: lateOnly,
    p_limit: limit,
  });
  if (!v3.error) return Array.isArray(v3.data) ? v3.data : [];
  if (!(await isMissingFunctionError(v3.error))) throw v3.error;

  const primary = await supabase.rpc('get_manager_meal_requests_v2', {
    p_period_id: resolvedPeriod, p_request_type: requestType, p_status: status, p_limit: limit,
  });
  if (!primary.error) {
    const rows = Array.isArray(primary.data) ? primary.data : [];
    return lateOnly === true ? rows.filter((row) => row.is_late_request) : rows;
  }
  if (!(await isMissingFunctionError(primary.error))) throw primary.error;
  const fallback = await supabase.rpc('manager_get_meal_requests', {
    p_period_id: resolvedPeriod, p_request_type: requestType, p_status: status, p_limit: limit,
  });
  if (fallback.error) throw fallback.error;
  const rows = Array.isArray(fallback.data) ? fallback.data : [];
  return lateOnly === true ? rows.filter((row) => row.is_late_request) : rows;
}

export async function createLateMealRequest({ mealDate, breakfast, lunch, dinner, reason = null }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('create_late_meal_request', {
    p_meal_date: mealDate, p_breakfast: breakfast, p_lunch: lunch, p_dinner: dinner, p_reason: reason,
  });
  if (error) throw error;
  return unwrapData(data);
}

export async function reviewLateMealRequest({ requestId, approve, reason = null }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_review_late_meal_request', {
    p_request_id: requestId, p_approve: approve, p_reason: reason,
  });
  if (error) throw error;
  return unwrapData(data);
}

export async function createMemberMealRequest({ memberId, startDate, endDate, days }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_create_member_meal_request', {
    p_member_id: memberId, p_start_date: startDate, p_end_date: endDate, p_days: days,
  });
  if (error) throw error;
  return unwrapData(data);
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


export async function fetchMealDayStates(startDate, endDate, periodId = null) {
  assertSupabase();
  if (!startDate || !endDate || startDate > endDate) return [];
  let query = supabase
    .from('daily_meal_days')
    .select('id, period_id, meal_date, status, cutoff_at, finalizes_at, locked_at, finalized_at')
    .gte('meal_date', startDate)
    .lte('meal_date', endDate);
  if (periodId) query = query.eq('period_id', periodId);
  const { data, error } = await query.order('meal_date', { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function fetchMealEntryData(date, periodId = null) {
  assertSupabase();
  let dayQuery = supabase
    .from('daily_meal_days')
    .select('id, period_id, meal_date, status, cutoff_at, finalizes_at, locked_at, finalized_at')
    .eq('meal_date', date);
  if (periodId) dayQuery = dayQuery.eq('period_id', periodId);
  const { data: day, error: dayError } = await dayQuery.maybeSingle();
  if (dayError) throw dayError;
  if (!day) return { day: null, records: [] };

  const { data: records, error: recordsError } = await supabase
    .from('daily_meal_records')
    .select('member_id, planned_breakfast, planned_lunch, planned_dinner, actual_breakfast, actual_lunch, actual_dinner, final_breakfast, final_lunch, final_dinner, finalization_source, finalized_by, finalized_at, cancelled')
    .eq('daily_meal_day_id', day.id);
  if (recordsError) throw recordsError;

  return { day, records: Array.isArray(records) ? records : [] };
}

export async function fetchRunningPeriod() {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_running_period_context');
  if (error) throw error;
  const period = data?.period || null;
  return period ? { ...period, period_id: period.period_id || period.id } : null;
}

export async function fetchMonthClosePreflight() {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_month_close_preflight');
  if (error) throw error;
  return data ?? null;
}
