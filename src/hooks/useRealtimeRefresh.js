import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

export function useRealtimeRefresh({ enabled = true, hostelId, tables = [], onRefresh }) {
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const tableKey = Array.isArray(tables) ? tables.filter(Boolean).join('|') : '';

  useEffect(() => {
    if (!enabled || !supabase || !hostelId || !tableKey) return undefined;

    let timer = null;
    const requestRefresh = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          onRefreshRef.current?.();
        }
      }, 700);
    };

    const requestedTables = tableKey.split('|').filter(Boolean);
    const channelName = `hostel-life-live-${hostelId}-${requestedTables.join('-')}`;
    const channel = supabase.channel(channelName);

    for (const table of requestedTables) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `hostel_id=eq.${hostelId}` },
        requestRefresh,
      );
    }

    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`Realtime subscription unavailable for ${channelName}.`);
      }
    });

    return () => {
      if (timer) window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [enabled, hostelId, tableKey]);
}
