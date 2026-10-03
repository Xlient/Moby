import { useMemo } from 'react';
import type { Alert } from '@/api/types';
import { compareAlerts } from '@/lib/alerts';
import { USER_CENTER, distanceKm } from '@/lib/geo';
import { RADIUS_OPTIONS, useNearbyRadius, type RadiusKm } from './useNearbyRadius';
import { useAlerts } from './useAlerts';

export interface NearbyAlert {
  alert: Alert;
  /** Kilometres from the user, rounded to 0.1. */
  distanceKm: number;
}

export interface UseNearbyAlertsResult {
  /** Alerts within the radius, highest severity first. */
  nearby: NearbyAlert[];
  radiusKm: RadiusKm;
  setRadiusKm: (next: RadiusKm) => void;
  loading: boolean;
  error: string | null;
  isOffline: boolean;
  /** When the alert list was last fetched (ISO), if ever. */
  cachedAt: string | null;
}

const MAX_RADIUS_KM = RADIUS_OPTIONS[RADIUS_OPTIONS.length - 1];

/**
 * The single source of "what's near me". Home, the alert list and the map all
 * read this so they always show the same set for the same radius (spec v3, Part 4).
 *
 * Fetches once at the largest radius and filters on-device, so changing the radius
 * is instant and works offline.
 */
export function useNearbyAlerts(): UseNearbyAlertsResult {
  const [radiusKm, setRadiusKm] = useNearbyRadius();
  // TODO(location): replace the demo location with the device position.
  const center = USER_CENTER;
  const { alerts, loading, error, isOffline, cachedAt } = useAlerts(center.lat, center.lon, MAX_RADIUS_KM);

  const nearby = useMemo(
    () =>
      alerts
        .flatMap((alert): NearbyAlert[] => {
          if (!alert.location) return [];
          const d = distanceKm(center.lat, center.lon, alert.location.lat, alert.location.lon);
          return d <= radiusKm ? [{ alert, distanceKm: Math.round(d * 10) / 10 }] : [];
        })
        .sort((a, b) => compareAlerts(a.alert, b.alert)),
    [alerts, center.lat, center.lon, radiusKm],
  );

  return { nearby, radiusKm, setRadiusKm, loading, error, isOffline, cachedAt };
}
