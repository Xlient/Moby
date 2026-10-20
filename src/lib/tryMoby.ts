import { useSyncExternalStore } from 'react';
import { kv } from '@/lib/storage';

/**
 * Trying Moby away from a disaster (Settings → Try Moby). Two separate switches, kept
 * on the phone only:
 *
 *   viewing   — look at another place (one of today's hot zones, GET /v1/demo/hot-zones)
 *               instead of where the phone is. Real, live alerts. Everything that means
 *               "near me" follows it; nothing that leaves the phone does (push area, SOS,
 *               mesh, reports, emergency numbers in Help: those always use the real GPS).
 *   demoMode  — add replays of real past alerts around the place being viewed
 *               (GET /v1/demo/replay), marked DEMO everywhere they appear.
 *
 * Both say so on Home with one tap to stop, and neither is ever sent to the server.
 */
export interface ViewingPlace {
  lat: number;
  lon: number;
  name: string;
  /** Set when it came from the hot zones list. */
  zoneId?: string;
}

export interface TryMobySettings {
  viewing: ViewingPlace | null;
  demoMode: boolean;
  /** Changes each time demo mode is turned on, so its emergency screen opens again. */
  demoRun: string | null;
}

const KEY = 'try-moby-v1';
const DEFAULTS: TryMobySettings = { viewing: null, demoMode: false, demoRun: null };

function read(): TryMobySettings {
  try {
    const raw = kv.get(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<TryMobySettings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

function write(next: TryMobySettings): void {
  current = next;
  kv.set(KEY, JSON.stringify(current));
  listeners.forEach((cb) => cb());
}

export function getTryMoby(): TryMobySettings {
  return current;
}

export function setViewing(place: ViewingPlace | null): void {
  write({ ...current, viewing: place });
}

export function setDemoMode(on: boolean): void {
  write({ ...current, demoMode: on, demoRun: on ? String(Date.now()) : null });
}

/** Back to normal: the phone's own position, no demo alerts. */
export function stopTryingMoby(): void {
  write(DEFAULTS);
}

export function useTryMoby(): TryMobySettings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
}

// Whether demo mode's last replay found nothing near the place being viewed: Moby only
// replays alerts from the region (moby/api/demo.py), so Home says so instead of showing
// nothing. Not saved: it's about the latest fetch only.
let noReplayHere = false;
const replayListeners = new Set<() => void>();

export function setNoReplayHere(none: boolean): void {
  if (none === noReplayHere) return;
  noReplayHere = none;
  replayListeners.forEach((cb) => cb());
}

export function useNoReplayHere(): boolean {
  return useSyncExternalStore(
    (cb) => {
      replayListeners.add(cb);
      return () => replayListeners.delete(cb);
    },
    () => noReplayHere,
    () => noReplayHere,
  );
}

/** A demo alert: a replay, never a current warning. */
export function isDemoAlert(alert: { demo?: boolean; alert_id: string }): boolean {
  return alert.demo === true || alert.alert_id.startsWith('demo-');
}
