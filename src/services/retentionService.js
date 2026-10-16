import { supabase } from '../lib/supabase';

export async function fetchRetentionNotice() {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_retention_notice');
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
export async function fetchArchivedFinalSummaries() {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_archived_final_summaries');
  if (error) throw error;
  const value = Array.isArray(data) ? data[0] : data;
  return Array.isArray(value) ? value : Array.isArray(value?.summaries) ? value.summaries : [];
}
