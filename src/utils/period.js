/** Normalize the canonical running-period RPC payload across deployed RPC versions. */
export function normalizeRunningPeriodPayload(payload) {
  let value = payload;
  if (Array.isArray(value)) value = value[0] ?? null;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  let period = value?.period ?? null;
  if (Array.isArray(period)) period = period[0] ?? null;
  // Compatibility with deployments that return the period object directly.
  if (!period && value && typeof value === 'object' && (value.period_id || value.id)) period = value;
  if (!period || typeof period !== 'object') return null;
  const periodId = period.period_id || period.id;
  if (!periodId) return null;
  const normalized = { ...period, period_id: periodId };
  // The open-ended running period uses an internal far-future sentinel so older
  // deployed SQL routines keep working. Never expose that implementation detail
  // as a user-visible end date; the actual end date is written when the month closes.
  const endDate = String(normalized.end_date || '').slice(0, 10);
  if (String(normalized.status || '').toLowerCase() === 'running' && endDate >= '9999-01-01') {
    normalized.end_date = null;
  }
  return normalized;
}



export function dashboardNeedsPeriodFallback(data) {
  const hasPeriod = Boolean(data?.period?.period_id || data?.period?.id);
  // `false` without a period object is common in older RPC payloads, and must be
  // checked against the canonical period lookup before showing “month not started”.
  return data?.has_running_period === false && !hasPeriod;
}


/**
 * Tri-state period status for the dashboard: unknown must never be rendered as
 * “month not started”. Only a successful canonical lookup may authoritatively say none.
 */
export function resolveDashboardPeriodStatus({
  periodWasResolved = false,
  periodResultStatus = 'fulfilled',
  resolvedPeriod = null,
  data = null,
  previous = null,
}) {
  const hasId = (period) => Boolean(period?.period_id || period?.id);
  const priorStatus = previous?.period_status;

  if (periodWasResolved && periodResultStatus === 'fulfilled') {
    return hasId(resolvedPeriod) ? 'running' : 'none';
  }
  if (data?.has_running_period === true || hasId(data?.period)) return 'running';
  if (priorStatus === 'running' || priorStatus === 'none') return priorStatus;
  if (periodWasResolved && periodResultStatus === 'rejected') {
    // Do not trust a legacy cached `false` unless it was confirmed by the current
    // canonical lookup; an old bundle may have stored a stale negative flag.
    if (previous?.has_running_period === true || hasId(previous?.period)) return 'running';
    return 'unknown';
  }
  if (typeof previous?.has_running_period === 'boolean') {
    return previous.has_running_period ? 'running' : 'none';
  }
  if (data?.has_running_period === false) return 'unknown';
  return 'unknown';
}


/**
 * Resolve a running-period mismatch without treating a partial management RPC payload
 * as proof that no month exists. A successful canonical empty lookup may say "none";
 * a failed verification must leave the state unknown.
 */
export function reconcileManagementContextWithPeriod(
  managementContext,
  runningPeriodPayload,
  { verificationSucceeded = false, today = null, canManageMonth = false } = {},
) {
  const base = managementContext && typeof managementContext === 'object' && !Array.isArray(managementContext)
    ? managementContext
    : {};
  const directPeriod = normalizeRunningPeriodPayload(base);
  if (directPeriod) {
    return { ...base, has_running_period: true, period: directPeriod };
  }

  const verifiedPeriod = verificationSucceeded ? normalizeRunningPeriodPayload(runningPeriodPayload) : null;
  if (verifiedPeriod) {
    return {
      ...base,
      today: base.today || today || undefined,
      has_running_period: true,
      period: verifiedPeriod,
      can_manage_month: Boolean(base.can_manage_month ?? canManageMonth),
    };
  }

  return {
    ...base,
    today: base.today || today || undefined,
    has_running_period: verificationSucceeded ? false : undefined,
    period: null,
  };
}
