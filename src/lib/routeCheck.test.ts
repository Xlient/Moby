import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { CheckedRoute, RouteCheck, RouteHazard } from '@/api/types';
import {
  alternativeProblemCopy, detourCost, formatDistance, formatDuration, googleMapsUrl, hazardLine, headlineFor,
  verdict, waypoints,
} from './routeCheck';

const hazard = (over: Partial<RouteHazard> = {}): RouteHazard => ({
  event_id: 'e1', alert_id: 'e1', hazard_type: 'flood', severity: 'high', verification: 'official',
  headline: 'Flood Warning', km_along: 4.2, at: { lat: 37.8, lon: -122.25 }, ...over,
});

const line = (coords: number[][], hazards: RouteHazard[] = [], distance_m = 8800, duration_s = 600): CheckedRoute => ({
  geometry: { type: 'LineString', coordinates: coords }, distance_m, duration_s, hazards,
});

const STRAIGHT = [[-122.3, 37.8], [-122.25, 37.8], [-122.2, 37.8]];

function check(route: CheckedRoute, alternative: CheckedRoute | null = null): RouteCheck {
  return { profile: 'driving-car', route, alternative, alternative_problem: null };
}

test('the verdict never calls a route safe', () => {
  assert.equal(verdict(check(line(STRAIGHT))), 'clear');
  assert.equal(headlineFor('clear', 0), 'No known hazards on this route');
  assert.equal(verdict(check(line(STRAIGHT, [hazard()]), line(STRAIGHT))), 'around');
  assert.equal(verdict(check(line(STRAIGHT, [hazard()]), line(STRAIGHT, [hazard()]))), 'crosses');
  assert.equal(verdict(check(line(STRAIGHT, [hazard()]))), 'crosses');
  for (const v of ['clear', 'around', 'crosses'] as const) {
    assert.doesNotMatch(headlineFor(v, 2), /safe/i);
  }
});

test('distances and durations read naturally', () => {
  assert.equal(formatDistance(430), '430 m');
  assert.equal(formatDistance(4230), '4.2 km');
  assert.equal(formatDistance(42300), '42 km');
  assert.equal(formatDuration(20), '1 min');
  assert.equal(formatDuration(3900), '1 h 5 min');
  assert.equal(formatDuration(7200), '2 h');
});

test('the detour says what it costs', () => {
  assert.equal(detourCost(line(STRAIGHT, [], 8800, 600), line(STRAIGHT, [], 17000, 1140)), '+8.2 km, +9 min');
});

test('hazards say where on the route they are', () => {
  assert.equal(hazardLine(hazard()), 'After 4.2 km: Flood Warning');
  assert.equal(hazardLine(hazard({ km_along: 0 })), 'At the start: Flood Warning');
});

test('no way around: the reason in plain words', () => {
  assert.match(alternativeProblemCopy('no_route')!, /no road or path around/);
  assert.equal(alternativeProblemCopy(null), null);
});

test('waypoints are spread along the route, never the ends', () => {
  const coords = Array.from({ length: 101 }, (_, i) => [-122.3 + i * 0.001, 37.8]);
  const pts = waypoints(coords, 4);
  assert.equal(pts.length, 4);
  assert.ok(pts.every((p) => p.lon > -122.3 && p.lon < -122.2));
  assert.ok(pts[0]!.lon < pts[3]!.lon);
  assert.deepEqual(waypoints([[0, 0], [1, 1]]), []);
});

test('the Google Maps link carries the way around as waypoints', () => {
  const url = googleMapsUrl(line(STRAIGHT), { lat: 37.8, lon: -122.3 }, { lat: 37.8, lon: -122.2 }, 'foot-hiking');
  assert.match(url, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&/);
  assert.match(url, /origin=37\.80000,-122\.30000/);
  assert.match(url, /travelmode=walking/);
  assert.match(url, /waypoints=37\.80000,-122\.25000/);
});
