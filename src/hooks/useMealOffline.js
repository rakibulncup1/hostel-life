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

      // V2.1 already includes member-wise details inside each snapshot.
      // Keep the offline sync to one RPC so we do not repeat the detail query.
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
    if (!offlineRecord) return undefined;
    let timer = null;
    const scheduleBoundary = () => {
      const now = new Date();
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
      const minutes = Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
      const targets = [21 * 60, 22 * 60];
      const delta = Math.min(...targets.map((target) => { const d = target - minutes; return d > 0 ? d : d + 24 * 60; }));
      timer = window.setTimeout(() => {
        setOfflineMealCard(pickOfflineMealCard(offlineRecord, new Date()));
        scheduleBoundary();
      }, Math.max(15000, Math.ceil(delta * 60 * 1000)));
    };
    scheduleBoundary();
    return () => { if (timer) window.clearTimeout(timer); };
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
