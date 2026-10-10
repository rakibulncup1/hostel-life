import { useCallback, useEffect, useState } from 'react';
import { fetchDashboardData, fetchOfflineMealBundle } from '../services/dashboardService';
import { pickOfflineMealCard } from '../services/mealOfflineStore';
import { readDashboardSnapshot, requestPersistentStorage, saveDashboardSnapshot } from '../services/offlineStore';

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
      console.warn('Dashboard offline cache read failed:', storageError);
      setError(storageError);
      return null;
    } finally {
      setLoading(false);
    }
  }, [hostelId, userId]);

  const sync = useCallback(async (freshDashboard = null) => {
    if (!userId || !hostelId || !isOnline) return null;
    try {
      const dashboard = freshDashboard || await fetchDashboardData();
      if (!dashboard) return null;
      // Remove stale meal content from the snapshot only when server confirms there is no running period.
      const mealBundle = dashboard.has_running_period === false
        ? null
        : await fetchOfflineMealBundle().catch(() => null);

      await saveDashboardSnapshot({ userId, hostelId, dashboard, mealBundle });
      const cached = await readDashboardSnapshot({ userId, hostelId });
      setSnapshot(cached);
      setError(null);
      requestPersistentStorage().catch(() => undefined);
      return cached;
    } catch (syncError) {
      console.warn('Dashboard online sync failed:', syncError);
      setError(syncError);
      return null;
    }
  }, [hostelId, isOnline, userId]);

  useEffect(() => {
    loadCached();
  }, [loadCached]);

  useEffect(() => {
    if (!isOnline || !userId || !hostelId) return undefined;
    requestPersistentStorage().catch(() => undefined);
    return undefined;
  }, [hostelId, isOnline, userId]);

  const offlineMealCard = (() => {
    if (!snapshot?.mealBundle) return snapshot?.dashboard?.meal_card || null;
    return pickOfflineMealCard({ bundle: snapshot.mealBundle }) || snapshot?.dashboard?.meal_card || null;
  })();

  return {
    snapshot,
    dashboard: snapshot?.dashboard || null,
    offlineMealCard,
    loading,
    error,
    loadCached,
    sync,
  };
}
