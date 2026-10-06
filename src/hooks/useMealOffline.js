import { useCallback, useEffect, useState } from 'react';
import { fetchOfflineMealBundle } from '../services/dashboardService';
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
      await saveMealBundle({ hostelId, bundle });
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
