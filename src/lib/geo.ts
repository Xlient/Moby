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

/**
 * Distance from the user to an alert, in km. The server measures to the alert's
 * *area* when it has one (0 = inside a warning area), from the point the list was
 * fetched for; adding how far the user is from that point keeps it a safe upper
 * bound (triangle inequality). Falls back to the alert's centre point.
 */
export function alertDistanceKm(
  alert: { location?: { lat: number; lon: number }; distance_km?: number },
  user: { lat: number; lon: number },
  fetchedAt: { lat: number; lon: number },
): number | undefined {
  const toCentre = alert.location
    ? distanceKm(user.lat, user.lon, alert.location.lat, alert.location.lon)
    : undefined;
  const offset = distanceKm(user.lat, user.lon, fetchedAt.lat, fetchedAt.lon);
  // Inside the area as seen from the fetch point, and the user is in the same ~1 km
  // cell: call it inside (at worst off by < 1 km at the very edge of a warning area).
  if (alert.distance_km === 0 && offset <= 1) return 0;
  const viaServer = alert.distance_km !== undefined ? alert.distance_km + offset : undefined;
  if (toCentre === undefined) return viaServer;
  return viaServer === undefined ? toCentre : Math.min(toCentre, viaServer);
}
