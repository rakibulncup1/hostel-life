import { useCallback, useEffect, useState } from 'react';
import { fetchOfflineMealBundle } from '../services/dashboardService';
import { pickOfflineMealCard } from '../services/mealOfflineStore';
import { readDashboardSnapshot, saveDashboardSnapshot } from '../services/offlineStore';

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

  // This function only persists a dashboard result already fetched by the page.
  // It must not fetch dashboard data itself: doing so duplicated RPC calls and,
  // when used by DashboardPage's effect, could start a fetch/cache/render loop.
  const sync = useCallback(async (freshDashboard, { refreshMealBundle = false } = {}) => {
    if (!userId || !hostelId || !isOnline || !freshDashboard) return null;
    try {
      const previous = await readDashboardSnapshot({ userId, hostelId }).catch(() => null);
      let mealBundle = previous?.mealBundle || null;

      if (freshDashboard.has_running_period === false) {
        mealBundle = null;
      } else if (refreshMealBundle || !mealBundle) {
        // Never discard a good cached bundle just because this fetch temporarily fails.
        const latestBundle = await fetchOfflineMealBundle().catch(() => null);
        if (latestBundle) mealBundle = latestBundle;
      }

      await saveDashboardSnapshot({ userId, hostelId, dashboard: freshDashboard, mealBundle });
      const cached = await readDashboardSnapshot({ userId, hostelId });
      setSnapshot(cached);
      setError(null);
      return cached;
    } catch (syncError) {
      setError(syncError);
      return null;
    }
  }, [hostelId, isOnline, userId]);

  useEffect(() => {
    loadCached();
  }, [loadCached]);


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
