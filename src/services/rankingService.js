import { supabase } from '../lib/supabase';
import { fetchMemberDirectory } from './diningService';

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

/**
 * The current member-directory RPC already provides `deposit` per member from
 * the running period's financial ledger (cash + market-credit deposits). Reuse
 * that authorized, hostel-scoped payload instead of introducing a new SQL RPC
 * or schema migration just for the ranking screen.
 */
export async function fetchTopDepositors() {
  const members = await fetchMemberDirectory({ force: true });
  return (Array.isArray(members) ? members : [])
    // Inactive members may still have a valid deposit balance in this month;
    // preserve their contribution just as the shoppers ranking preserves past
    // market entries. The directory RPC already excludes blocked profiles.
    .map((member) => ({
      membership_id: member.membership_id || member.member_id,
      member_id: member.membership_id || member.member_id,
      member_name: member.member_name || member.full_name || 'নাম নেই',
      total_deposit: Number(member.deposit || 0),
      deposit: Number(member.deposit || 0),
      amount: Number(member.deposit || 0),
    }))
    .filter((member) => Number.isFinite(member.total_deposit) && member.total_deposit > 0)
    .sort((a, b) => b.total_deposit - a.total_deposit || a.member_name.localeCompare(b.member_name, 'bn'))
    .slice(0, 10)
    .map((member, index) => ({ ...member, rank: index + 1, rank_no: index + 1 }));
}
