import { supabase } from '../lib/supabase';

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

export async function fetchDashboardData() {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_dashboard_data');
  if (error) throw error;
  return data ?? null;
}

export async function fetchMealDetails(mealDate) {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_meal_details', { p_meal_date: mealDate });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function fetchOfflineMealBundle() {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_offline_meal_bundle');
  if (error) throw error;
  return data ?? null;
}
