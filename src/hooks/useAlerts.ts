import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Alert } from '@/api/types';
import { useOnlineStatus } from './useOnlineStatus';

const ALERTS_CACHE_KEY = 'cached-alerts';
const ALERTS_CACHE_TS_KEY = 'cached-alerts-ts';

function getPersistedAlerts(): { alerts: Alert[]; cachedAt: string | null } {
  try {
    const raw = localStorage.getItem(ALERTS_CACHE_KEY);
    const ts = localStorage.getItem(ALERTS_CACHE_TS_KEY);
    if (raw) return { alerts: JSON.parse(raw) as Alert[], cachedAt: ts };
  } catch { /* corrupted */ }
  return { alerts: [], cachedAt: null };
}

function persistAlerts(alerts: Alert[]): void {
  try {
    localStorage.setItem(ALERTS_CACHE_KEY, JSON.stringify(alerts));
    localStorage.setItem(ALERTS_CACHE_TS_KEY, new Date().toISOString());
  } catch { /* quota */ }
}

export interface UseAlertsResult {
  alerts: Alert[];
  loading: boolean;
  error: string | null;
  isOffline: boolean;
  cachedAt: string | null;
  refetch: () => void;
}

export function useAlerts(lat?: number, lon?: number, radiusKm?: number): UseAlertsResult {
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();

  const persisted = getPersistedAlerts();

  const query = useQuery({
    queryKey: ['alerts', lat, lon, radiusKm],
    queryFn: async () => {
      const data = await api.getAlerts({ lat, lon, radius_km: radiusKm });
      const list = data.alerts ?? [];
      persistAlerts(list);
      return list;
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: persisted.alerts.length > 0 ? persisted.alerts : undefined,
    enabled: isOnline,
  });

  const alerts = query.data ?? persisted.alerts;
  const cachedAt = query.dataUpdatedAt
    ? new Date(query.dataUpdatedAt).toISOString()
    : persisted.cachedAt;

  return {
    alerts,
    loading: query.isLoading && !query.isPlaceholderData,
    error: query.error && alerts.length === 0
      ? 'Could not load alerts. Check your connection and try again.'
      : null,
    isOffline: !isOnline,
    cachedAt,
    refetch: () => { queryClient.invalidateQueries({ queryKey: ['alerts'] }); },
  };
}
