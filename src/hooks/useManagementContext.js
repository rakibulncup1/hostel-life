import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { rpcWithFallback } from '../lib/rpcCompatibility';
import { cachedRequest } from '../lib/requestCache';
import { useAuth } from '../contexts/AuthContext';
import { useOnlineStatus } from './useOnlineStatus';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function useManagementContext() {
  const { membership, isManager, operationalRole } = useAuth();
  const online = useOnlineStatus();
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(false);
  const refreshInFlightRef = useRef(null);
  const lastRefreshAtRef = useRef(0);

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!supabase || !online || !membership?.hostel_id || document.visibilityState !== 'visible' || !document.hasFocus() || !navigator.onLine) return null;
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const now = Date.now();
    if (!force && now - lastRefreshAtRef.current < 15000) return null;
    lastRefreshAtRef.current = now;

    const task = (async () => {
      setLoading(true);
      try {
      const { data, error, functionName } = await cachedRequest('manager:context', () => rpcWithFallback(supabase, [
        { name: 'get_month_management_context' },
        { name: 'get_running_period_context' },
      ]), { ttlMs: 30000, force });
      if (error) throw error;
      if (functionName === 'get_month_management_context') {
        setContext(data ?? null);
        return data ?? null;
      }

      // Older database deployments only have running-period context. The shared
      // RPC resolver remembers missing variants for this tab, so later focus/resume
      // refreshes do not repeatedly generate failed function-lookup logs.
      const periodData = data;
      const fallbackPeriod = periodData?.period
        ? {
            ...periodData.period,
            period_id: periodData.period.period_id || periodData.period.id,
            assistant_managers: asArray(periodData.period.assistant_managers),
          }
        : null;
      const fallback = {
        today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date()),
        has_running_period: Boolean(fallbackPeriod),
        period: fallbackPeriod,
        can_manage_month: Boolean(isManager || operationalRole?.can_manage_month),
      };
      setContext(fallback);
      return fallback;
      } finally {
        setLoading(false);
      }
    })();
    refreshInFlightRef.current = task;
    try {
      return await task;
    } finally {
      if (refreshInFlightRef.current === task) refreshInFlightRef.current = null;
    }
  }, [membership?.hostel_id, online, isManager, operationalRole]);

  useEffect(() => {
    if (!online || !membership?.hostel_id) return undefined;
    refresh().catch(() => undefined);
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') refresh().catch(() => undefined);
    };
    window.addEventListener('focus', refreshIfVisible);
    window.addEventListener('online', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      window.removeEventListener('online', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [membership?.hostel_id, online, refresh]);

  const period = context?.period ? { ...context.period, period_id: context.period.period_id || context.period.id } : null;
  const assistants = asArray(period?.assistant_managers);
  const hasRunningPeriod = Boolean(context?.has_running_period ?? period?.period_id);
  const periodPrimaryId = period?.primary_manager_membership_id || null;
  const hasKnownPeriodPrimary = Boolean(periodPrimaryId && membership?.membership_id);
  const isPrimaryManager = hasRunningPeriod
    ? (hasKnownPeriodPrimary
        ? periodPrimaryId === membership.membership_id
        : Boolean(operationalRole?.is_primary_manager ?? period?.is_primary_manager ?? isManager))
    : Boolean(isManager || operationalRole?.is_primary_manager);
  const isAssistantManager = Boolean(
    !isPrimaryManager && (operationalRole?.is_assistant_manager || (membership?.membership_id && assistants.some((assistant) => assistant.membership_id === membership.membership_id))),
  );

  return {
    context,
    period,
    assistants,
    loading,
    refresh,
    isPrimaryManager,
    isAssistantManager,
    isOperationalManager: isPrimaryManager || isAssistantManager,
    canManageMonth: hasRunningPeriod && hasKnownPeriodPrimary
      ? isPrimaryManager
      : Boolean(context?.can_manage_month ?? operationalRole?.can_manage_month ?? isPrimaryManager),
  };
}
