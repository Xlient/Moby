// Hazard route check: wording and the hand-off to a navigation app. No React, so
// `npm run test:lib` tests it with plain Node.
//
// The rule for every sentence here: Moby never calls a route safe. It says what the
// route crosses among the hazards Moby knows about, and what that leaves out.

import type { CheckedRoute, RouteCheck, RouteHazard } from '@/api/types';
import { distanceKm } from './geo';

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export function formatDuration(s: number): string {
  const minutes = Math.max(1, Math.round(s / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "+4.2 km, +9 min" — what going around costs. */
export function detourCost(usual: CheckedRoute, around: CheckedRoute): string {
  const dm = around.distance_m - usual.distance_m;
  const ds = around.duration_s - usual.duration_s;
  const sign = (n: number) => (n >= 0 ? '+' : '−');
  return `${sign(dm)}${formatDistance(Math.abs(dm))}, ${sign(ds)}${formatDuration(Math.abs(ds))}`;
}

export type Verdict = 'clear' | 'crosses' | 'around';

/**
 * clear   the usual route crosses nothing Moby knows about
 * around  it does, and there's a way around that crosses nothing Moby knows about
 * crosses it does, and Moby has no clear way around
 */
export function verdict(check: RouteCheck): Verdict {
  if (check.route.hazards.length === 0) return 'clear';
  if (check.alternative && check.alternative.hazards.length === 0) return 'around';
  return 'crosses';
}

export function headlineFor(v: Verdict, count: number): string {
  switch (v) {
    case 'clear':
      return 'No known hazards on this route';
    case 'around':
      return `This route crosses ${count === 1 ? 'a known hazard' : `${count} known hazards`}. There’s a way around.`;
    case 'crosses':
      return `This route crosses ${count === 1 ? 'a known hazard' : `${count} known hazards`}`;
  }
}

/** Said under every result, whatever it is. */
export const LIMITS =
  'Moby only knows official warnings and what people have reported. Roads close and water rises faster than anyone reports. Follow local authorities and road signs.';

export function hazardLine(h: RouteHazard): string {
  const where = h.km_along < 0.1 ? 'At the start' : `After ${formatDistance(h.km_along * 1000)}`;
  return `${where}: ${h.headline ?? 'Hazard'}`;
}

export function cannotAvoidCopy(h: RouteHazard): string | null {
  switch (h.cannot_avoid) {
    case 'start_inside':
      return 'You’re starting inside it, so no route can avoid it.';
    case 'end_inside':
      return 'Your destination is inside it.';
    case 'too_large':
      return 'It covers too large an area to route around.';
    default:
      return null;
  }
}

/** Why there's no way around, in plain words. */
export function alternativeProblemCopy(reason: RouteCheck['alternative_problem']): string | null {
  switch (reason) {
    case null:
    case undefined:
      return null;
    case 'cannot_avoid':
      return 'Moby couldn’t look for a way around: the hazard is at your start or destination, or covers too large an area.';
    case 'no_route':
      return 'There’s no road or path around these hazards that Moby could find.';
    case 'over_limits':
      return 'The hazard areas are too large for the routing service to go around.';
    default:
      return 'Moby couldn’t look for a way around right now. Try again in a moment.';
  }
}

/**
 * Up to `max` points spread evenly (by distance) along a route, start and end excluded.
 * Handed to a navigation app as waypoints so it follows roughly the same way.
 */
export function waypoints(coords: number[][], max = 8): { lat: number; lon: number }[] {
  if (coords.length < 3 || max <= 0) return [];
  const cumulative = [0];
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1]!;
    const [lon2, lat2] = coords[i]!;
    cumulative.push(cumulative[i - 1]! + distanceKm(lat1!, lon1!, lat2!, lon2!));
  }
  const total = cumulative[cumulative.length - 1]!;
  if (total === 0) return [];
  const out: { lat: number; lon: number }[] = [];
  let j = 1;
  for (let k = 1; k <= max; k++) {
    const target = (total * k) / (max + 1);
    while (j < coords.length - 1 && cumulative[j]! < target) j++;
    if (j >= coords.length - 1) break;
    const [lon, lat] = coords[j]!;
    const last = out[out.length - 1];
    if (!last || last.lat !== lat || last.lon !== lon) out.push({ lat: lat!, lon: lon! });
  }
  return out;
}

const fmt = (p: { lat: number; lon: number }) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

/**
 * Opens the route in Google Maps (a plain link, not Google's API) with waypoints along
 * Moby's route, so it follows roughly the same way. Between waypoints Google picks its
 * own roads, which the app says.
 */
export function googleMapsUrl(
  route: CheckedRoute,
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number },
  profile: RouteCheck['profile'],
): string {
  const via = waypoints(route.geometry.coordinates);
  const params = [
    'api=1',
    `origin=${fmt(origin)}`,
    `destination=${fmt(destination)}`,
    `travelmode=${profile === 'foot-hiking' ? 'walking' : 'driving'}`,
  ];
  if (via.length) params.push(`waypoints=${via.map(fmt).join('%7C')}`);
  return `https://www.google.com/maps/dir/?${params.join('&')}`;
}
