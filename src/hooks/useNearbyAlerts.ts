import { useMemo } from 'react';
import type { Alert, AlertPreferences } from '@/api/types';
import { compareAlerts } from '@/lib/alerts';
import { alertDistanceKm } from '@/lib/geo';
import { fetchCenter, useUserCenter, type UserCenter } from '@/location/UserLocationContext';
import { RADIUS_OPTIONS, useNearbyRadius, type RadiusKm } from './useNearbyRadius';
import { useAlerts } from './useAlerts';
import { matchesAlertPreferences, useAlertPreferences, wantsVerification } from './useAlertPreferences';
import type { HiddenAlerts } from '@/lib/hiddenAlerts';

export interface NearbyAlert {
  alert: Alert;
  /** Kilometres from the user, rounded to 0.1. */
  distanceKm: number;
}

export interface UseNearbyAlertsResult {
  /** Alerts within the radius that match the user's alert preferences, highest severity first. */
  nearby: NearbyAlert[];
  /** Within the radius but filtered out by alert preferences (so the UI can say so). */
  hiddenCount: number;
  /** hiddenCount split by reason, so the UI can name the setting that hides them. */
  hidden: HiddenAlerts;
  preferences: AlertPreferences;
  radiusKm: RadiusKm;
  setRadiusKm: (next: RadiusKm) => void;
  loading: boolean;
  error: string | null;
  isOffline: boolean;
  /** When the alert list was last fetched (ISO), if ever. */
  cachedAt: string | null;
  /** Where "near" is measured from. */
  center: UserCenter;
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
  const center = useUserCenter();
  const q = fetchCenter(center);
  const { alerts, loading, error, isOffline, cachedAt } = useAlerts(q.lat, q.lon, MAX_RADIUS_KM);
  const [preferences] = useAlertPreferences();

  const { nearby, hiddenCount, hidden } = useMemo(() => {
    const inRadius = alerts.flatMap((alert): NearbyAlert[] => {
      const d = alertDistanceKm(alert, center, q);
      if (d === undefined) return [];
      return d <= radiusKm ? [{ alert, distanceKm: Math.round(d * 10) / 10 }] : [];
    });
    const wanted = inRadius.filter(({ alert }) => matchesAlertPreferences(preferences, alert));
    const reports = inRadius.filter(
      ({ alert }) => !wantsVerification(preferences, alert.verification_label),
    ).length;
    const hiddenCount = inRadius.length - wanted.length;
    return {
      nearby: wanted.sort((a, b) => compareAlerts(a.alert, b.alert)),
      hiddenCount,
      hidden: { reports, other: hiddenCount - reports },
    };
  }, [alerts, center.lat, center.lon, q.lat, q.lon, radiusKm, preferences]);

  return { nearby, hiddenCount, hidden, preferences, radiusKm, setRadiusKm, loading, error, isOffline, cachedAt, center };
}
