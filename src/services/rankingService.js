import { supabase } from '../lib/supabase';

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

export async function fetchTopEaters() {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_top_eaters');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function fetchTopShoppers() {
  assertSupabase();
  const { data, error } = await supabase.rpc('get_top_shoppers');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}
