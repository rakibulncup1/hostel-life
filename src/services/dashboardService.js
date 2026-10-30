import { supabase } from '../lib/supabase';
import { cachedRequest } from '../lib/requestCache';
import { normalizeRunningPeriodPayload } from '../utils/period';
import { ensureRunningPeriodDays } from './diningService';
import { buildUpcomingMealDays } from '../utils/sevenDayMeals';

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

export async function fetchDashboardData({ force = false } = {}) {
  assertSupabase();
  return cachedRequest('dashboard:data', async () => {
    await ensureRunningPeriodDays();
    const { data, error } = await supabase.rpc('get_dashboard_data');
    if (error) throw error;
    if (!data || typeof data !== 'object') return data ?? null;
    const normalizedPeriod = normalizeRunningPeriodPayload({ period: data.period });
    return normalizedPeriod ? { ...data, period: normalizedPeriod } : data;
  }, { ttlMs: 45000, force });
}

export async function fetchMealDetails(mealDate, { force = false } = {}) {
  assertSupabase();
  return cachedRequest(`dashboard:meal-details:${mealDate}`, async () => {
    const { data, error } = await supabase.rpc('get_meal_details', { p_meal_date: mealDate });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }, { ttlMs: 15000, force });
}

export async function fetchOfflineMealBundle({ force = false } = {}) {
  assertSupabase();
  return cachedRequest('dashboard:offlineMealBundle', async () => {
    await ensureRunningPeriodDays();
    const { data, error } = await supabase.rpc('get_offline_meal_bundle');
    if (error) throw error;
    if (!data || typeof data !== 'object') return data ?? null;
    const normalizedPeriod = normalizeRunningPeriodPayload({ period: data.period });
    return normalizedPeriod ? { ...data, period: normalizedPeriod } : data;
  }, { ttlMs: 5 * 60 * 1000, force });
}


/**
 * Read-only seven-day schedule snapshot. This intentionally reads the existing
 * RLS-protected daily_meal_records table instead of calling get_offline_meal_bundle,
 * because that RPC also runs due-day finalization and can write audit history.
 */
export async function fetchUpcomingMealOverview({ periodId, dates, periodStartDate = null, periodEndDate = null, force = false }) {
  assertSupabase();
  const safeDates = (Array.isArray(dates) ? dates : []).map((date) => String(date || '').slice(0, 10));
  if (!periodId || safeDates.length !== 7 || safeDates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new Error('আগামী সাত দিনের মিলের তারিখ সঠিকভাবে তৈরি করা যায়নি।');
  }
  const fromDate = safeDates[0];
  const toDate = safeDates[safeDates.length - 1];

  return cachedRequest(`dashboard:upcoming-seven:${periodId}:${fromDate}:${toDate}`, async () => {
    const { data, error } = await supabase
      .from('daily_meal_records')
      .select(`
        planned_breakfast, planned_lunch, planned_dinner,
        actual_breakfast, actual_lunch, actual_dinner,
        final_breakfast, final_lunch, final_dinner,
        finalization_source, cancelled,
        daily_meal_days!inner(meal_date,status)
      `)
      .eq('period_id', periodId)
      .eq('cancelled', false)
      .gte('daily_meal_days.meal_date', fromDate)
      .lte('daily_meal_days.meal_date', toDate);

    if (error) throw error;
    return buildUpcomingMealDays(data || [], safeDates, { periodStartDate, periodEndDate });
  }, { ttlMs: 60000, force });
}

export async function fetchMemberPeriodDetails(memberId, periodId = null, { force = false } = {}) {
  assertSupabase();
  return cachedRequest(`dashboard:member-period:${memberId}:${periodId || 'running'}`, async () => {
    const { data, error } = await supabase.rpc('get_member_period_details', { p_member_id: memberId, p_period_id: periodId });
    if (error) throw error;
    return data ?? null;
  }, { ttlMs: 30000, force });
}
