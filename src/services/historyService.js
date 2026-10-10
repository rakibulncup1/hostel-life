import { supabase } from '../lib/supabase';
import { normalizeLedgerRow } from '../utils/accounting';

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

function unwrap(data) {
  if (Array.isArray(data) && data.length === 1 && data[0] == null) return null;
  return data;
}

function missingFunction(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '');
  return code === '42883'
    || code === 'PGRST202'
    || code === 'PGRST203'
    || /function .* does not exist/i.test(message)
    || /could not find the function .* in the schema cache/i.test(message)
    || /schema cache.*function/i.test(message);
}

export async function fetchMarketHistory({ periodId = null, limit = 100 } = {}) {
  assertSupabase();
  const primary = await supabase.rpc('get_market_history_v2', { p_period_id: periodId, p_limit: limit });
  if (!primary.error) return Array.isArray(primary.data) ? primary.data : [];
  if (!missingFunction(primary.error)) throw primary.error;

  const fallback = await supabase.rpc('get_market_history', { p_period_id: periodId, p_limit: limit });
  if (fallback.error) throw fallback.error;
  return Array.isArray(fallback.data) ? fallback.data : [];
}

export async function fetchMarketDetail(marketEntryId) {
  assertSupabase();
  const primary = await supabase.rpc('get_market_detail_v2', { p_market_entry_id: marketEntryId });
  if (!primary.error) return unwrap(primary.data) ?? null;
  if (!missingFunction(primary.error)) throw primary.error;

  const fallback = await supabase.rpc('get_market_detail', { p_market_entry_id: marketEntryId });
  if (fallback.error) throw fallback.error;
  return unwrap(fallback.data) ?? null;
}

export async function fetchAccountHistory({ periodId = null, memberId = null, limit = 200 } = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_account_history_v2', {
    p_period_id: periodId,
    p_member_id: memberId,
    p_limit: limit,
  });
  if (error) throw error;
  return Array.isArray(data) ? data.map(normalizeLedgerRow) : [];
}

export async function fetchKhalaMoneyHistory({ periodId = null, limit = 200 } = {}) {
  assertSupabase();
  const primary = await supabase.rpc('get_khala_money_history_v2', { p_period_id: periodId, p_limit: limit });
  if (!primary.error) return Array.isArray(primary.data) ? primary.data : [];
  if (!missingFunction(primary.error)) throw primary.error;

  const fallback = await supabase.rpc('get_khala_money_history', { p_period_id: periodId, p_limit: limit });
  if (fallback.error) throw fallback.error;
  return Array.isArray(fallback.data) ? fallback.data : [];
}

export async function fetchPreviousMonths() {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_previous_months');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function fetchArchivedMonthDetail(periodId) {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_archived_month_detail', {
    p_period_id: periodId,
  });
  if (error) throw error;
  const detail = data ?? null;
  if (!detail || typeof detail !== 'object') return detail;
  const auditResult = await supabase.rpc('get_archive_period_audit', { p_period_id: periodId });
  return { ...detail, edit_audit: auditResult.error ? [] : (Array.isArray(auditResult.data) ? auditResult.data : []) };
}


export async function fetchMyArchiveEditablePeriods() {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_my_archive_editable_periods');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}
