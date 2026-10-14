import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

// Keep realtime-driven RPC refreshes bounded. Multiple row events are coalesced,
// and a page will request at most one refresh per 15 seconds while visible.
const REFRESH_DEBOUNCE_MS = 700;
const MIN_REFRESH_INTERVAL_MS = 30000;

export function useRealtimeRefresh({ enabled = true, hostelId, tables = [], onRefresh, minRefreshIntervalMs = MIN_REFRESH_INTERVAL_MS, immediateTables = [] }) {
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const tableKey = Array.isArray(tables) ? tables.filter(Boolean).join('|') : '';
  const immediateTableKey = Array.isArray(immediateTables) ? immediateTables.filter(Boolean).join('|') : '';
  const immediateTableSet = new Set(immediateTableKey.split('|').filter(Boolean));

  useEffect(() => {
    if (!enabled || !supabase || !hostelId || !tableKey) return undefined;

    let channel = null;
    let debounceTimer = null;
    // Allow the first event to refresh promptly, then cap bursts to one per 30 seconds.
    const refreshInterval = Math.max(5000, Number(minRefreshIntervalMs) || MIN_REFRESH_INTERVAL_MS);
    let lastRefreshAt = Date.now() - refreshInterval;
    const pendingTables = new Set();
    let pendingReason = 'realtime';

    const isPageActive = () => document.visibilityState === 'visible' && document.hasFocus() && navigator.onLine;

    const clearPending = () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = null;
      pendingTables.clear();
      pendingReason = 'realtime';
    };

    const disconnect = () => {
      clearPending();
      if (!channel) return;
      const oldChannel = channel;
      channel = null;
      // removeChannel closes the local subscription; failures are intentionally
      // swallowed here because reconnect/visibility handling can safely retry.
      Promise.resolve(supabase.removeChannel(oldChannel)).catch(() => undefined);
    };

    const dispatchRefresh = () => {
      debounceTimer = null;
      if (!isPageActive()) {
        pendingTables.clear();
        pendingReason = 'realtime';
        return;
      }
      lastRefreshAt = Date.now();
      const changedTables = [...pendingTables];
      const reason = pendingReason;
      pendingTables.clear();
      pendingReason = 'realtime';
      try {
        const result = onRefreshRef.current?.({ tables: changedTables, reason });
        if (result && typeof result.catch === 'function') result.catch(() => undefined);
      } catch {
        // A refresh failure is handled by the owning page; do not emit repetitive logs.
      }
    };

    const scheduleRefresh = (table, reason = 'realtime') => {
      if (table) pendingTables.add(table);
      if (reason !== 'realtime') pendingReason = reason;
      if (!isPageActive()) return;
      if (debounceTimer) window.clearTimeout(debounceTimer);
      // Realtime, focus, visibility, and online events all share the same throttle.
      // Browsers often emit several of these together; bypassing the throttle for
      // resume events caused duplicate RPC refreshes during tab/network changes.
      const elapsed = Date.now() - lastRefreshAt;
      const isImmediate = [...pendingTables].some((name) => immediateTableSet.has(name));
      const delay = isImmediate ? REFRESH_DEBOUNCE_MS : Math.max(REFRESH_DEBOUNCE_MS, refreshInterval - elapsed);
      debounceTimer = window.setTimeout(dispatchRefresh, delay);
    };

    const connect = () => {
      if (channel || !isPageActive()) return;
      const requestedTables = tableKey.split('|').filter(Boolean);
      const channelName = `hostel-life-live-${hostelId}-${requestedTables.join('-')}`;
      const nextChannel = supabase.channel(channelName);

      for (const table of requestedTables) {
        nextChannel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter: `hostel_id=eq.${hostelId}` },
          () => scheduleRefresh(table),
        );
      }

      channel = nextChannel;
      // Supabase handles its own websocket reconnect. Avoid logging every transient
      // channel error; hidden/offline pages explicitly detach and reconnect on resume.
      nextChannel.subscribe();
    };

    const handleVisibility = () => {
      if (!isPageActive()) {
        disconnect();
        return;
      }
      connect();
      scheduleRefresh('__resume__', 'resume');
    };

    const handleOnline = () => {
      if (!navigator.onLine) {
        disconnect();
        return;
      }
      connect();
      scheduleRefresh('__online__', 'online');
    };

    const handleOffline = () => disconnect();
    const handleFocus = () => {
      if (!isPageActive()) return;
      connect();
      scheduleRefresh('__focus__', 'resume');
    };
    const handleBlur = () => disconnect();

    connect();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      disconnect();
    };
  }, [enabled, hostelId, tableKey, minRefreshIntervalMs, immediateTableKey]);
}
