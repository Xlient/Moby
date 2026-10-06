import type { LngLatBounds } from '@maplibre/maplibre-react-native';

/** GeoJSON polygon approximating a circle of `km` around a point. */
export function circle(lat: number, lon: number, km: number, steps = 64): GeoJSON.Polygon {
  const ring = Array.from({ length: steps + 1 }, (_, i) => {
    const t = (2 * Math.PI * i) / steps;
    return [lon + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(t), lat + (km / 111.32) * Math.cos(t)];
  });
  return { type: 'Polygon', coordinates: [ring] };
}

/** [west, south, east, north] around a point. */
export function boundsAround(lat: number, lon: number, km: number): LngLatBounds {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}
