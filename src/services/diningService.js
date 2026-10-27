import { supabase } from '../lib/supabase';
import { rpcWithFallback } from '../lib/rpcCompatibility';
import { cachedRequest, invalidateRequestCache } from '../lib/requestCache';
import { normalizeRunningPeriodPayload } from '../utils/period';

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

function unwrapData(data) {
  if (Array.isArray(data) && data.length === 1 && data[0] == null) return null;
  return data;
}

export async function fetchMemberDirectory({ force = false } = {}) {
  assertSupabase();
  return cachedRequest('dining:memberDirectory', async () => {
    const { data, error } = await rpcWithFallback(supabase, [
      { name: 'get_member_directory_v4' },
      { name: 'get_member_directory_v3' },
      { name: 'get_member_directory_v2' },
      { name: 'get_member_directory' },
    ]);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    // Privacy: never request or forward other members' profile photos.
    // The directory remains a single RPC with its original accounting/role payload.
    return rows;
  }, { ttlMs: 60000, force });
}

export async function fetchManagerMemberDirectory() {
  return fetchMemberDirectory();
}

export async function fetchMyMealRequests(limit = 100, { force = false } = {}) {
  assertSupabase();
  return cachedRequest(`dining:myMealRequests:${limit}`, async () => {
    const { data, error } = await rpcWithFallback(supabase, [
      { name: 'get_my_meal_requests_v2', params: { p_limit: limit } },
      { name: 'get_my_meal_requests', params: { p_limit: limit } },
    ]);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }, { ttlMs: 15000, force });
}

export async function fetchManagerMealRequests({ periodId = null, requestType = null, status = null, lateOnly = null, limit = 200, force = false } = {}) {
  assertSupabase();
  return cachedRequest(`dining:managerMealRequests:${periodId || 'running'}:${requestType || 'all'}:${status || 'all'}:${lateOnly ?? 'all'}:${limit}`, async () => {
  // get_manager_meal_requests_v3 resolves the active period on the server. Avoid an
  // extra get_running_period_context RPC every time the manager opens/refreshes this list.
  const resolvedPeriod = periodId || null;
  const paramsV3 = {
    p_period_id: resolvedPeriod,
    p_request_type: requestType,
    p_status: status,
    p_late_only: lateOnly,
    p_limit: limit,
  };
  const paramsV2 = {
    p_period_id: resolvedPeriod,
    p_request_type: requestType,
    p_status: status,
    p_limit: limit,
  };
  const { data, error, functionName } = await rpcWithFallback(supabase, [
    { name: 'get_manager_meal_requests_v3', params: paramsV3 },
    { name: 'get_manager_meal_requests_v2', params: paramsV2 },
    { name: 'manager_get_meal_requests', params: paramsV2 },
  ]);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return functionName === 'get_manager_meal_requests_v3'
    ? rows
    : (lateOnly === true ? rows.filter((row) => row.is_late_request) : rows);
  }, { ttlMs: 12000, force });
}

export async function createLateMealRequest({ mealDate, breakfast, lunch, dinner, reason = null }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('create_late_meal_request', {
    p_meal_date: mealDate, p_breakfast: breakfast, p_lunch: lunch, p_dinner: dinner, p_reason: reason,
  });
  if (error) throw error;
  invalidateRequestCache('dashboard:', 'dining:');
  return unwrapData(data);
}

export async function reviewLateMealRequest({ requestId, approve, reason = null }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_review_late_meal_request', {
    p_request_id: requestId, p_approve: approve, p_reason: reason,
  });
  if (error) throw error;
  invalidateRequestCache('dashboard:', 'dining:');
  return unwrapData(data);
}

export async function createMemberMealRequest({ memberId, startDate, endDate, days }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_create_member_meal_request', {
    p_member_id: memberId, p_start_date: startDate, p_end_date: endDate, p_days: days,
  });
  if (error) throw error;
  invalidateRequestCache('dashboard:', 'dining:');
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
  invalidateRequestCache('dashboard:', 'dining:');
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
  invalidateRequestCache('dashboard:', 'dining:');
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
  invalidateRequestCache('dashboard:', 'dining:');
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
  invalidateRequestCache('dashboard:', 'dining:');
  return unwrapData(data);
}

export async function updateSubmittedMealRequest({ requestId, days, note = null }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_update_submitted_meal_request', {
    p_request_id: requestId,
    p_days: days,
    p_note: note,
  });
  if (error) throw error;
  invalidateRequestCache('dashboard:', 'dining:');
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
  invalidateRequestCache('dashboard:', 'dining:');
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
  invalidateRequestCache('dashboard:', 'dining:');
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
  invalidateRequestCache('dashboard:', 'dining:');
  return data;
}

export async function setManagerMealEntries(entries) {
  assertSupabase();
  const { data, error } = await supabase.rpc('manager_set_meal_entries', {
    p_entries: entries,
  });
  if (error) throw error;
  invalidateRequestCache('dashboard:', 'dining:');
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

async function fetchRunningPeriodFromRlsTable() {
  // Fallback is deliberately read-only. monthly_periods has same-hostel RLS;
  // only rows with status=running can be returned to the current member.
  const { data, error } = await supabase
    .from('monthly_periods')
    .select('id, label, start_date, end_date, status, primary_manager_membership_id')
    .eq('status', 'running')
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeRunningPeriodPayload({ period: { ...data, period_id: data.id } }) : null;
}

export async function fetchRunningPeriod({ force = false } = {}) {
  assertSupabase();
  return cachedRequest('dining:runningPeriod', async () => {
    const { data, error } = await supabase.rpc('get_running_period_context');
    if (!error) {
      const period = normalizeRunningPeriodPayload(data);
      if (period) return period;
      // A null/malformed context can be caused by stale deployments or an old
      // RPC contract. Verify against the RLS-protected source of truth before
      // telling the user that no month exists.
      return fetchRunningPeriodFromRlsTable();
    }

    // If the RPC is unavailable, the secure same-hostel RLS query can still
    // resolve an existing running period. If that query also fails, preserve
    // the original RPC error so the UI shows a recoverable error—not “no month”.
    try {
      const fallbackPeriod = await fetchRunningPeriodFromRlsTable();
      if (fallbackPeriod) return fallbackPeriod;
    } catch {
      // Keep the primary RPC error below; it is the first failing contract.
    }
    throw error;
  }, { ttlMs: 30000, force });
}

function isMissingRunningPeriodRepairRpc(error) {
  const detail = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  return /PGRST202|42883|could not find the function|schema cache|function .* does not exist/i.test(detail);
}

/** Backfill missing real calendar days for the currently running period, never the far-future sentinel. */
export async function ensureRunningPeriodDays() {
  assertSupabase();
  const { data, error } = await supabase.rpc('hl_ensure_running_period_days', {});
  if (error) {
    // Older deployments can continue to open the UI, but the database migration
    // must be applied before open-ended periods can work completely.
    if (isMissingRunningPeriodRepairRpc(error)) return null;
    throw error;
  }
  return data ?? null;
}

export async function fetchMonthClosePreflight() {
  assertSupabase();
  await ensureRunningPeriodDays();
  const { data, error } = await supabase.rpc('get_month_close_preflight');
  if (error) throw error;
  return data ?? null;
}
