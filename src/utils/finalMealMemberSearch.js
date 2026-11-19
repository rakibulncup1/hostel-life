export const MAX_FINAL_MEAL_BATCH_SIZE = 100;

/**
 * Client-side member filtering for the manager final-meal editor.
 * This helper never changes member records or persistence behavior.
 */
export function normalizeFinalMealMemberSearch(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function filterFinalMealMembers(members = [], query = '') {
  const normalizedQuery = normalizeFinalMealMemberSearch(query);
  const safeMembers = Array.isArray(members) ? members : [];
  if (!normalizedQuery) return safeMembers;
  return safeMembers.filter((member) => normalizeFinalMealMemberSearch(member?.member_name).includes(normalizedQuery));
}

/** Single mode targets one selected member; all-mode search targets visible matches only. */
export function resolveFinalMealMemberTargets({ mode = 'all', activeMembers = [], matchedMembers = [], selectedMemberId = '', hasSearch = false } = {}) {
  const safeActiveMembers = Array.isArray(activeMembers) ? activeMembers : [];
  if (mode === 'single') return safeActiveMembers.filter((member) => member?.membership_id === selectedMemberId);
  if (hasSearch) return Array.isArray(matchedMembers) ? matchedMembers : [];
  return safeActiveMembers;
}
