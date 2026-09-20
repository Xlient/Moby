import { useState, useEffect, useCallback } from 'react';
import { api } from '@/api/client';
import type { Alert } from '@/api/types';
import { useOnlineStatus } from './useOnlineStatus';

const CACHE_KEY = 'cached-alerts';
const CACHE_TS_KEY = 'cached-alerts-ts';

function getCachedAlerts(): { alerts: Alert[]; cachedAt: string | null } {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const ts = localStorage.getItem(CACHE_TS_KEY);
    if (raw) {
      return { alerts: JSON.parse(raw) as Alert[], cachedAt: ts };
    }
  } catch { /* corrupted cache — ignore */ }
  return { alerts: [], cachedAt: null };
}

function cacheAlerts(alerts: Alert[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(alerts));
    localStorage.setItem(CACHE_TS_KEY, new Date().toISOString());
  } catch { /* quota exceeded — acceptable */ }
}

export interface UseAlertsResult {
  alerts: Alert[];
  loading: boolean;
  error: string | null;
  isOffline: boolean;
  cachedAt: string | null;
  refetch: () => Promise<void>;
}

export function useAlerts(lat?: number, lon?: number, radiusKm?: number): UseAlertsResult {
  const isOnline = useOnlineStatus();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    if (!isOnline) {
      const cached = getCachedAlerts();
      setAlerts(cached.alerts);
      setCachedAt(cached.cachedAt);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await api.getAlerts({ lat, lon, radius_km: radiusKm });
      const list = data.alerts ?? [];
      setAlerts(list);
      cacheAlerts(list);
      setCachedAt(new Date().toISOString());
      setError(null);
    } catch {
      const cached = getCachedAlerts();
      if (cached.alerts.length > 0) {
        setAlerts(cached.alerts);
        setCachedAt(cached.cachedAt);
      } else {
        setError('Could not load alerts. Check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [isOnline, lat, lon, radiusKm]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  return {
    alerts,
    loading,
    error,
    isOffline: !isOnline,
    cachedAt,
    refetch: fetchAlerts,
  };
}
