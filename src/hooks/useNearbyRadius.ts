import { useSyncExternalStore, useCallback } from 'react';

const STORAGE_KEY = 'nearby-radius-km';
const DEFAULT_RADIUS = 25;
export const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
export type RadiusKm = (typeof RADIUS_OPTIONS)[number];

function isValidRadius(v: number): v is RadiusKm {
  return (RADIUS_OPTIONS as readonly number[]).includes(v);
}

function readStored(): RadiusKm {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      if (isValidRadius(parsed)) return parsed;
    }
  } catch {
    // Private browsing or storage full — use default
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

export function useNearbyRadius(): [RadiusKm, (next: RadiusKm) => void] {
  const radius = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setRadius = useCallback((next: RadiusKm) => {
    cached = next;
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Ignore write failures
    }
    listeners.forEach((cb) => cb());
  }, []);

  return [radius, setRadius];
}
