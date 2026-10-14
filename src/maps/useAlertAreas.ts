import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type AlertAreas } from '@/api/client';
import { kv } from '@/lib/storage';
import { RADIUS_OPTIONS } from '@/hooks/useNearbyRadius';
import { fetchCenter, type UserCenter } from '@/location/UserLocationContext';

// Warning areas for the maps (issue #21). Saved on the phone like the alert list, so
// after an offline restart the map still shades the areas instead of only pins.

const CACHE_KEY = 'cached-alert-areas';
const MAX_RADIUS_KM: number = RADIUS_OPTIONS[RADIUS_OPTIONS.length - 1] ?? 100;
const EMPTY: AlertAreas = { type: 'FeatureCollection', features: [] };

function readSaved(): AlertAreas | undefined {
  try {
    const raw = kv.get(CACHE_KEY);
    return raw ? (JSON.parse(raw) as AlertAreas) : undefined;
  } catch {
    return undefined;
  }
}

/** Areas of the given alerts (the list's ids), as GeoJSON for MapLibre. */
export function useAlertAreas(center: UserCenter, alertIds: Set<string>): GeoJSON.FeatureCollection {
  const q = fetchCenter(center);
  const saved = readSaved();
  const query = useQuery({
    queryKey: ['alert-areas', q.lat, q.lon],
    queryFn: async () => {
      const areas = await api.getAlertAreas({ lat: q.lat, lon: q.lon, radius_km: MAX_RADIUS_KM });
      kv.set(CACHE_KEY, JSON.stringify(areas));
      return areas;
    },
    staleTime: 60_000,
    placeholderData: saved,
  });
  const all = query.data ?? saved ?? EMPTY;
  return useMemo(
    () => ({
      type: 'FeatureCollection',
      // Only alerts the list shows (radius + preferences), so map and list agree.
      features: all.features.filter((f) => alertIds.has(f.properties.alert_id)) as GeoJSON.Feature[],
    }),
    [all, alertIds],
  );
}
