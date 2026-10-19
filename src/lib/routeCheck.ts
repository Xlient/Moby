// Hazard route check: wording and the hand-off to a navigation app. No React, so
// `npm run test:lib` tests it with plain Node.
//
// The rule for every sentence here: Moby never calls a route safe. It says what the
// route crosses among the hazards Moby knows about, and what that leaves out.

import type { CheckedRoute, RouteCheck, RouteHazard } from '@/api/types';
import { distanceKm } from './geo';

/** Thousands separated by hand: Hermes' Intl support varies by Android build. */
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return m < 10_000 ? `${(m / 1000).toFixed(1)} km` : `${grouped(Math.round(m / 1000))} km`;
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

/** Further than this from the usual route, the way around has left it (km). */
const DIVERGES_KM = 0.15;

function nearestKm(lon: number, lat: number, line: number[][]): number {
  let best = Infinity;
  for (const [lon2, lat2] of line) best = Math.min(best, distanceKm(lat, lon, lat2!, lon2!));
  return best;
}

/**
 * Where the way around leaves the usual route: one point in the middle of each stretch
 * that's off it (up to `max`). Handed to a navigation app as stops, so it takes the
 * detours and otherwise follows its own roads. Start and end are never stops.
 */
export function detourWaypoints(around: number[][], usual: number[][], max = 3): { lat: number; lon: number }[] {
  const off = around.map(([lon, lat], i) =>
    i > 0 && i < around.length - 1 && nearestKm(lon!, lat!, usual) > DIVERGES_KM);
  const runs: number[][] = [];
  off.forEach((isOff, i) => {
    if (!isOff) return;
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i);
    else runs.push([i]);
  });
  // Longest detours first if there are more than `max`, then back in route order.
  return runs
    .sort((a, b) => b.length - a.length)
    .slice(0, max)
    .sort((a, b) => a[0]! - b[0]!)
    .map((run) => {
      const [lon, lat] = around[run[Math.floor(run.length / 2)]!]!;
      return { lat: lat!, lon: lon! };
    });
}

const fmt = (p: { lat: number; lon: number }) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

/**
 * Opens the trip in Google Maps (a plain link, not Google's API). For a way around, the
 * middle of each detour goes in as a stop so Google takes it; elsewhere Google picks its
 * own roads, which the app says.
 */
export function googleMapsUrl(
  check: RouteCheck,
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number },
): string {
  const via = check.alternative
    ? detourWaypoints(check.alternative.geometry.coordinates, check.route.geometry.coordinates)
    : [];
  const profile = check.profile;
  const params = [
    'api=1',
    `origin=${fmt(origin)}`,
    `destination=${fmt(destination)}`,
    `travelmode=${profile === 'foot-hiking' ? 'walking' : 'driving'}`,
  ];
  if (via.length) params.push(`waypoints=${via.map(fmt).join('%7C')}`);
  return `https://www.google.com/maps/dir/?${params.join('&')}`;
}
