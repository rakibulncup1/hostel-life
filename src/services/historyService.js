import { supabase } from '../lib/supabase';

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

function unwrap(data) {
  if (Array.isArray(data) && data.length === 1 && data[0] == null) return null;
  return data;
}

export async function fetchMarketHistory({ periodId = null, limit = 100 } = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_market_history', {
    p_period_id: periodId,
    p_limit: limit,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function fetchMarketDetail(marketEntryId) {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_market_detail', {
    p_market_entry_id: marketEntryId,
  });
  if (error) throw error;
  return unwrap(data) ?? null;
}

export async function fetchAccountHistory({ periodId = null, memberId = null, limit = 200 } = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_account_history', {
    p_period_id: periodId,
    p_member_id: memberId,
    p_limit: limit,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function fetchKhalaMoneyHistory({ periodId = null, limit = 200 } = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_khala_money_history', {
    p_period_id: periodId,
    p_limit: limit,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
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
  return data ?? null;
}
