import { useSyncExternalStore, useCallback } from 'react';
import { kv } from '@/lib/storage';

const STORAGE_KEY = 'nearby-radius-km';
const DEFAULT_RADIUS = 25;
export const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
export type RadiusKm = (typeof RADIUS_OPTIONS)[number];

export function isValidRadius(v: number): v is RadiusKm {
  return (RADIUS_OPTIONS as readonly number[]).includes(v);
}

function readStored(): RadiusKm {
  try {
    const raw = kv.get(STORAGE_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      if (isValidRadius(parsed)) return parsed;
    }
  } catch {
    // Storage unavailable — use default
  }
  return DEFAULT_RADIUS;
}

const listeners = new Set<() => void>();
let cached: RadiusKm = readStored();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): RadiusKm {
  return cached;
}

function getServerSnapshot(): RadiusKm {
  return DEFAULT_RADIUS;
}

function storeLocally(next: RadiusKm): void {
  if (next === cached) return;
  cached = next;
  try {
    kv.set(STORAGE_KEY, String(next));
  } catch {
    // Ignore write failures
  }
  listeners.forEach((cb) => cb());
}

// The device copy is the source of truth for rendering (it works offline). When
// signed in, AuthProvider mirrors it to the user's profile so it follows them
// across devices.
let remoteSink: ((next: RadiusKm) => void) | null = null;

export function setNearbyRadiusRemoteSink(sink: ((next: RadiusKm) => void) | null): void {
  remoteSink = sink;
}

/** Applies a value read from the user's profile without writing it back. */
export function applyRemoteNearbyRadius(value: number): void {
  if (isValidRadius(value)) storeLocally(value);
}

export function getNearbyRadius(): RadiusKm {
  return cached;
}

export function useNearbyRadius(): [RadiusKm, (next: RadiusKm) => void] {
  const radius = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setRadius = useCallback((next: RadiusKm) => {
    storeLocally(next);
    remoteSink?.(next);
  }, []);

  return [radius, setRadius];
}
