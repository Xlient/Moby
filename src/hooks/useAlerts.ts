import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Alert } from '@/api/types';
import { useOnlineStatus } from './useOnlineStatus';
import { kv } from '@/lib/storage';
import { env } from '@/config/env';
import { isDemoAlert, useTryMoby } from '@/lib/tryMoby';

const ALERTS_CACHE_KEY = 'cached-alerts';
const ALERTS_CACHE_TS_KEY = 'cached-alerts-ts';

function getPersistedAlerts(): { alerts: Alert[]; cachedAt: string | null } {
  try {
    const raw = kv.get(ALERTS_CACHE_KEY);
    const ts = kv.get(ALERTS_CACHE_TS_KEY);
    if (raw) return { alerts: JSON.parse(raw) as Alert[], cachedAt: ts };
  } catch { /* corrupted */ }
  return { alerts: [], cachedAt: null };
}

function persistAlerts(alerts: Alert[]): void {
  try {
    kv.set(ALERTS_CACHE_KEY, JSON.stringify(alerts));
    kv.set(ALERTS_CACHE_TS_KEY, new Date().toISOString());
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
  // Demo mode (Settings → Try Moby): replays of real past alerts join the list, marked demo.
  const { demoMode, demoRun } = useTryMoby();
  const demo = demoMode && demoRun && lat !== undefined && lon !== undefined ? demoRun : null;

  const query = useQuery({
    queryKey: ['alerts', lat, lon, radiusKm, demo],
    queryFn: async () => {
      // Every community report, labelled: the user's community_reports choice is applied
      // on the phone (useNearbyAlerts), so changing it is instant and works offline.
      const [data, replays] = await Promise.all([
        api.getAlerts({ lat, lon, radius_km: radiusKm, community_reports: 'all' }),
        // A failed replay never hides the real alerts.
        demo ? api.getDemoReplay(lat!, lon!).catch(() => [] as Alert[]) : Promise.resolve([] as Alert[]),
      ]);
      // A new id per demo run, so its emergency screen opens again each time demo mode is turned on.
      const list = [...(data.alerts ?? []), ...replays.map((a) => ({ ...a, alert_id: `demo-${demo}-${a.event_id}` }))];
      persistAlerts(list);
      return list;
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: persisted.alerts.length > 0 ? persisted.alerts : undefined,
    // Mock data needs no network; real requests wait for a connection.
    enabled: isOnline || env.useMock,
  });

  // Saved while demo mode was on: never show those replays once it's off.
  const all = query.data ?? persisted.alerts;
  const alerts = demoMode ? all : all.filter((a) => !isDemoAlert(a));
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
