import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
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

  const refresh = useCallback(async () => {
    if (!supabase || !online || !membership?.hostel_id) return null;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_month_management_context');
      if (!error) {
        setContext(data ?? null);
        return data ?? null;
      }

      // A manager's role is authoritative from AuthContext/operationalRole. If the
      // richer management context is temporarily unavailable, fall back to
      // the running-period context so manager features do not disappear.
      const { data: periodData, error: periodError } = await supabase.rpc('get_running_period_context');
      if (periodError) throw error;
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
