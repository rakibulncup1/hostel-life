import { useCallback, useEffect, useState } from 'react';
import {
  readDashboardSnapshot,
  readMealDetailSnapshot,
  readOwnAccountDetailSnapshot,
  saveDashboardSnapshot,
  saveMealDetailSnapshot,
  saveOwnAccountDetailSnapshot,
} from '../services/offlineStore';

export function useDashboardOffline({ userId, hostelId, isOnline }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadCached = useCallback(async () => {
    if (!userId || !hostelId) {
      setLoading(false);
      setSnapshot(null);
      return null;
    }
    setLoading(true);
    try {
      const cached = await readDashboardSnapshot({ userId, hostelId });
      setSnapshot(cached);
      setError(null);
      return cached;
    } catch (storageError) {
      setError(storageError);
      return null;
    } finally {
      setLoading(false);
    }
  }, [hostelId, userId]);

  // Persist only data the dashboard has already fetched. This never starts a
  // Supabase request and does not change the free-plan network footprint.
  const sync = useCallback(async (freshDashboard) => {
    if (!userId || !hostelId || !isOnline || !freshDashboard) return null;
    try {
      await saveDashboardSnapshot({ userId, hostelId, dashboard: freshDashboard });
      const cached = await readDashboardSnapshot({ userId, hostelId });
      setSnapshot(cached);
      setError(null);
      return cached;
    } catch (syncError) {
      setError(syncError);
      return null;
    }
  }, [hostelId, isOnline, userId]);

  const saveMealDetail = useCallback(async ({ periodId, mealDate, rows }) => {
    if (!userId || !hostelId) return null;
    try {
      return await saveMealDetailSnapshot({ userId, hostelId, periodId, mealDate, rows });
    } catch {
      return null;
    }
  }, [hostelId, userId]);

  const readMealDetail = useCallback(async ({ periodId, mealDate }) => {
    if (!userId || !hostelId) return null;
    try {
      return await readMealDetailSnapshot({ userId, hostelId, periodId, mealDate });
    } catch {
      return null;
    }
  }, [hostelId, userId]);

  const saveOwnAccountDetail = useCallback(async ({ membershipId, periodId, detail }) => {
    if (!userId || !hostelId) return null;
    try {
      return await saveOwnAccountDetailSnapshot({ userId, hostelId, membershipId, periodId, detail });
    } catch {
      return null;
    }
  }, [hostelId, userId]);

  const readOwnAccountDetail = useCallback(async ({ membershipId, periodId }) => {
    if (!userId || !hostelId) return null;
    try {
      return await readOwnAccountDetailSnapshot({ userId, hostelId, membershipId, periodId });
    } catch {
      return null;
    }
  }, [hostelId, userId]);

  useEffect(() => {
    loadCached();
  }, [loadCached]);

  return {
    snapshot,
    dashboard: snapshot?.dashboard || null,
    offlineMealCard: snapshot?.dashboard?.meal_card || null,
    loading,
    error,
    loadCached,
    sync,
    saveMealDetail,
    readMealDetail,
    saveOwnAccountDetail,
    readOwnAccountDetail,
  };
}
