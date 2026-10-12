import { supabase } from '../lib/supabase';
import { cachedRequest } from '../lib/requestCache';

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

export async function fetchDashboardData({ force = false } = {}) {
  assertSupabase();
  return cachedRequest('dashboard:data', async () => {
    const { data, error } = await supabase.rpc('get_dashboard_data');
    if (error) throw error;
    return data ?? null;
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
    const { data, error } = await supabase.rpc('get_offline_meal_bundle');
    if (error) throw error;
    return data ?? null;
  }, { ttlMs: 5 * 60 * 1000, force });
}

export async function fetchMemberPeriodDetails(memberId, periodId = null, { force = false } = {}) {
  assertSupabase();
  return cachedRequest(`dashboard:member-period:${memberId}:${periodId || 'running'}`, async () => {
    const { data, error } = await supabase.rpc('get_member_period_details', { p_member_id: memberId, p_period_id: periodId });
    if (error) throw error;
    return data ?? null;
  }, { ttlMs: 30000, force });
}
