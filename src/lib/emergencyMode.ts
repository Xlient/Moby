// Emergency mode: when Moby swaps the feed for a simple "do this now" screen.
//
// A fixed rule, never a model: models don't decide urgency in Moby (README, "How Moby
// uses NVIDIA Nemotron"). Only an official warning qualifies, at high or critical
// severity, still in force, and only when the person is inside its area (or within
// EMERGENCY_DISTANCE_KM of it). Community reports never trigger it: they're unverified,
// and a rumour must never take over someone's screen.
//
// No React and no storage here, so `npm run test:lib` can test it with plain Node.

import type { Alert } from '@/api/types';
import { compareAlerts, isExpired } from './alerts';

/** Inside the warning area, or this close to it (km). Alert distances are 0 inside an area. */
export const EMERGENCY_DISTANCE_KM = 1;

export interface Candidate {
  alert: Alert;
  /** Kilometres from the person, as useNearbyAlerts measures it. */
  distanceKm: number;
}

export function qualifiesForEmergency(c: Candidate, now: number = Date.now()): boolean {
  const { alert } = c;
  return (
    alert.verification_label === 'official_confirmed' &&
    (alert.severity === 'high' || alert.severity === 'critical') &&
    !isExpired(alert, now) &&
    c.distanceKm <= EMERGENCY_DISTANCE_KM
  );
}

/** The warning emergency mode is about: the most severe, then the newest. Null when none qualifies. */
export function emergencyAlert(nearby: Candidate[], now: number = Date.now()): Candidate | null {
  const qualifying = nearby.filter((c) => qualifiesForEmergency(c, now));
  qualifying.sort((a, b) => compareAlerts(a.alert, b.alert));
  return qualifying[0] ?? null;
}
