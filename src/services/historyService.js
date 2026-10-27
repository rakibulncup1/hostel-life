import { supabase } from '../lib/supabase';
import { rpcWithFallback } from '../lib/rpcCompatibility';
import { normalizeLedgerRow } from '../utils/accounting';

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

function unwrap(data) {
  if (Array.isArray(data) && data.length === 1 && data[0] == null) return null;
  return data;
}


export async function fetchMarketHistory({ periodId = null, limit = 100 } = {}) {
  assertSupabase();
  const { data, error } = await rpcWithFallback(supabase, [
    { name: 'get_market_history_v2', params: { p_period_id: periodId, p_limit: limit } },
    { name: 'get_market_history', params: { p_period_id: periodId, p_limit: limit } },
  ]);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function fetchMarketDetail(marketEntryId) {
  assertSupabase();
  const { data, error } = await rpcWithFallback(supabase, [
    { name: 'get_market_detail_v2', params: { p_market_entry_id: marketEntryId } },
    { name: 'get_market_detail', params: { p_market_entry_id: marketEntryId } },
  ]);
  if (error) throw error;
  return unwrap(data) ?? null;
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
  const { data, error } = await rpcWithFallback(supabase, [
    { name: 'get_khala_money_history_v2', params: { p_period_id: periodId, p_limit: limit } },
    { name: 'get_khala_money_history', params: { p_period_id: periodId, p_limit: limit } },
  ]);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function fetchPreviousMonths() {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_previous_months');
  if (error) throw error;
  const previous = Array.isArray(data) ? data : [];
  try {
    const { data: listed, error: listedError } = await supabase.rpc('hl_b_list_closed_months');
    if (listedError || !Array.isArray(listed)) return previous;
    const known = new Set(previous.map(row => String(row.period_id || row.id)));
    return [...previous, ...listed.filter(row => !known.has(String(row.period_id || row.id)))
      .map(row => ({ ...row, period_id: row.period_id || row.id, archive_read_only: true }))];
  } catch { return previous; }
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
