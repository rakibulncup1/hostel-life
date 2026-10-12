/**
 * Determines whether the signed-in active member is authorized to manage the current period
 * based on the app's canonical running-period context. Archived periods still require the
 * explicit archive-edit grant in HistoryPage and must not be authorized by this helper.
 */
export function isCurrentPeriodManager({ isManager = false, operationalRole = null, membership = null, period = null } = {}) {
  if (isManager || operationalRole?.can_manage_month || operationalRole?.is_assistant_manager || operationalRole?.is_primary_manager) {
    return true;
  }

  if (!membership || membership.status !== 'active') return false;
  const membershipId = membership.membership_id ?? membership.id ?? membership.membershipId ?? null;
  if (!membershipId) return false;

  const periodPayload = period?.period && typeof period.period === 'object' ? period.period : period;
  const primaryManagerId = periodPayload?.primary_manager_membership_id ?? null;
  if (primaryManagerId && String(primaryManagerId) === String(membershipId)) return true;

  const assistants = Array.isArray(periodPayload?.assistant_managers)
    ? periodPayload.assistant_managers
    : Array.isArray(period?.assistant_managers) ? period.assistant_managers : [];
  return assistants.some((assistant) => {
    const assistantId = assistant?.membership_id ?? assistant?.id ?? assistant?.membershipId;
    return assistantId != null && String(assistantId) === String(membershipId);
  });
}
