import { useCallback, useEffect, useState } from 'react';
import { fetchMealDetails, fetchOfflineMealBundle } from '../services/dashboardService';
import { clearMealBundle, pickOfflineMealCard, readMealBundle, saveMealBundle } from '../services/mealOfflineStore';

export function useMealOffline({ hostelId, isOnline }) {
  const [offlineRecord, setOfflineRecord] = useState(null);
  const [offlineMealCard, setOfflineMealCard] = useState(null);
  const [offlineLoading, setOfflineLoading] = useState(true);
  const [offlineError, setOfflineError] = useState(null);

  const loadCached = useCallback(async () => {
    if (!hostelId) return null;
    setOfflineLoading(true);
    try {
      const record = await readMealBundle(hostelId);
      setOfflineRecord(record);
      setOfflineMealCard(pickOfflineMealCard(record));
      setOfflineError(null);
      return record;
    } catch (error) {
      setOfflineError(error);
      return null;
    } finally {
      setOfflineLoading(false);
    }
  }, [hostelId]);

  const sync = useCallback(async () => {
    if (!hostelId || !isOnline) return null;
    try {
      const bundle = await fetchOfflineMealBundle();
      if (!bundle) return null;

      const dates = [bundle?.today?.meal_date, bundle?.tomorrow?.meal_date].filter(Boolean);
      const detailPairs = await Promise.all(dates.map(async (mealDate) => {
        try {
          const rows = await fetchMealDetails(mealDate);
          return [mealDate, rows];
        } catch (error) {
          console.warn('Offline member meal details could not sync:', error);
          return [mealDate, []];
        }
      }));
      const detailMap = new Map(detailPairs);
      const enrichedBundle = {
        ...bundle,
        today: bundle.today ? { ...bundle.today, member_details: detailMap.get(bundle.today.meal_date) || [] } : bundle.today,
        tomorrow: bundle.tomorrow ? { ...bundle.tomorrow, member_details: detailMap.get(bundle.tomorrow.meal_date) || [] } : bundle.tomorrow,
      };

      await saveMealBundle({ hostelId, bundle: enrichedBundle });
      const record = await readMealBundle(hostelId);
      setOfflineRecord(record);
      setOfflineMealCard(pickOfflineMealCard(record));
      setOfflineError(null);
      return record;
    } catch (error) {
      setOfflineError(error);
      return null;
    }
  }, [hostelId, isOnline]);

  useEffect(() => {
    let active = true;
    if (!hostelId) {
      setOfflineLoading(false);
      setOfflineRecord(null);
      setOfflineMealCard(null);
      return undefined;
    }

    loadCached().then(() => {
      if (active && isOnline) sync().catch(() => undefined);
    });

    return () => { active = false; };
  }, [hostelId, isOnline, loadCached, sync]);

  useEffect(() => {
    const tick = () => {
      setOfflineMealCard(pickOfflineMealCard(offlineRecord, new Date()));
    };
    const interval = window.setInterval(tick, 30_000);
    return () => window.clearInterval(interval);
  }, [offlineRecord]);

  const clear = useCallback(async () => {
    await clearMealBundle();
    setOfflineRecord(null);
    setOfflineMealCard(null);
  }, []);

  return {
    offlineRecord,
    offlineMealCard,
    offlineLoading,
    offlineError,
    sync,
    clear,
  };
}
