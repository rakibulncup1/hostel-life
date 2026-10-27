import { supabase } from '../lib/supabase';
import { invalidateRequestCache } from '../lib/requestCache';

// Module 1 contract. Module 2 must create these narrowly scoped, authenticated RPCs.
// No fallback to reopen_archived_period or legacy grant_archive_edit_permission.
export const ARCHIVE_CORRECTION_RPC = Object.freeze({
  bundle: 'hlc_get_archive_correction_bundle',
  apply: 'hlc_apply_archive_correction',
});

export function isCorrectionBackendMissing(error) {
  const code = String(error?.code || '');
  return code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(String(error?.message || ''));
}

export async function getArchiveCorrectionBundle(periodId) {
  if (!supabase) throw new Error('Supabase configuration নেই।');
  if (!periodId) throw new Error('একটি মাস নির্বাচন করুন।');
  const { data, error } = await supabase.rpc(ARCHIVE_CORRECTION_RPC.bundle, { p_period_id: periodId });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('সার্ভারের Archive Correction উত্তর সঠিক নয়।');
  if (String(data.period?.id || data.period?.period_id || '') !== String(periodId)) {
    throw new Error('সার্ভার অন্য মাসের তথ্য পাঠিয়েছে; নিরাপত্তার জন্য বন্ধ করা হয়েছে।');
  }
  if (!['closed', 'archived'].includes(String(data.period?.status))) {
    throw new Error('শুধু বন্ধ মাস সংশোধন করা যাবে।');
  }
  return data;
}

export async function applyArchiveCorrection({ periodId, kind, targetId, changes, reason }) {
  if (!supabase) throw new Error('Supabase configuration নেই।');
  if (!periodId || !targetId || !['final_meal','market','deposit','other_expense','khala'].includes(kind)) {
    throw new Error('সংশোধনের তথ্য অসম্পূর্ণ।');
  }
  if (typeof reason !== 'string' || reason.trim().length < 8) {
    throw new Error('অন্তত ৮ অক্ষরের সংশোধনের কারণ লিখুন।');
  }
  const { data, error } = await supabase.rpc(ARCHIVE_CORRECTION_RPC.apply, {
    p_period_id: periodId, p_kind: kind, p_target_id: targetId,
    p_changes: changes, p_reason: reason.trim(),
  });
  if (error) throw error;
  if (data?.status !== 'success') throw new Error('সার্ভার সংশোধন নিশ্চিত করেনি।');
  invalidateRequestCache('dashboard:', 'manager:', 'history:', 'dining:');
  return data;
}
