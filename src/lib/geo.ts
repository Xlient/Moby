// ── Coordinate helpers (flat-earth approximation, fine at city scale) ──

export const USER_CENTER = { lat: 37.7749, lon: -122.4194 };
export const KM_PER_DEG_LAT = 111.32;

export function kmPerDegLon(lat: number): number {
  return 111.32 * Math.cos((lat * Math.PI) / 180);
}

/** Projects lat/lon to km offsets from `center` (x east, y south — screen axes). */
export function latLonToXY(
  lat: number,
  lon: number,
  center: { lat: number; lon: number },
): { x: number; y: number } {
  const x = (lon - center.lon) * kmPerDegLon(center.lat);
  const y = -(lat - center.lat) * KM_PER_DEG_LAT;
  return { x, y };
}

export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dy = (lat2 - lat1) * KM_PER_DEG_LAT;
  const dx = (lon2 - lon1) * kmPerDegLon((lat1 + lat2) / 2);
  return Math.sqrt(dx * dx + dy * dy);
}
