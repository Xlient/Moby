import { KM_PER_DEG_LAT, kmPerDegLon } from './geo';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Region extends LatLng {
  latitudeDelta: number;
  longitudeDelta: number;
}

export function toLatLng(p: { lat: number; lon: number }): LatLng {
  return { latitude: p.lat, longitude: p.lon };
}

/** A region that shows the whole radius circle with a little margin. */
export function regionForRadius(center: { lat: number; lon: number }, radiusKm: number, margin = 1.25): Region {
  const latitudeDelta = (radiusKm * 2 * margin) / KM_PER_DEG_LAT;
  const longitudeDelta = (radiusKm * 2 * margin) / kmPerDegLon(center.lat);
  return { latitude: center.lat, longitude: center.lon, latitudeDelta, longitudeDelta };
}

/** Polygon approximation of a circle on the ground (flat-earth; fine at these scales). */
export function circlePoints(center: { lat: number; lon: number }, radiusKm: number, steps = 72): LatLng[] {
  const points: LatLng[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    points.push({
      latitude: center.lat + (radiusKm * Math.sin(a)) / KM_PER_DEG_LAT,
      longitude: center.lon + (radiusKm * Math.cos(a)) / kmPerDegLon(center.lat),
    });
  }
  return points;
}

/** A box far larger than any view at our zoom levels, used as the "outside" for dimming. */
export function surroundingBox(center: { lat: number; lon: number }, spanDeg = 8): LatLng[] {
  const { lat, lon } = center;
  return [
    { latitude: lat + spanDeg, longitude: lon - spanDeg },
    { latitude: lat + spanDeg, longitude: lon + spanDeg },
    { latitude: lat - spanDeg, longitude: lon + spanDeg },
    { latitude: lat - spanDeg, longitude: lon - spanDeg },
  ];
}
