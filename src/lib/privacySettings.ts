import { useSyncExternalStore } from 'react';
import { kv } from '@/lib/storage';

/**
 * Privacy choices (docs: privacy policy, "Your rights"). Kept on the phone; each one
 * changes what the app sends:
 *   followLocation      — keep a ~1 km "near me" area on the server for push alerts.
 *                         Off: the server copy is deleted and no location is sent for push.
 *   approximateReports  — round report positions to ~500 m before sending.
 */
export interface PrivacySettings {
  followLocation: boolean;
  approximateReports: boolean;
}

const KEY = 'privacy-settings';
const DEFAULTS: PrivacySettings = { followLocation: true, approximateReports: false };

function read(): PrivacySettings {
  try {
    const raw = kv.get(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PrivacySettings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function getPrivacySettings(): PrivacySettings {
  return current;
}

export function setPrivacySettings(patch: Partial<PrivacySettings>): void {
  current = { ...current, ...patch };
  kv.set(KEY, JSON.stringify(current));
  listeners.forEach((cb) => cb());
}

export function resetPrivacySettings(): void {
  current = DEFAULTS;
  kv.set(KEY, JSON.stringify(current));
  listeners.forEach((cb) => cb());
}

export function usePrivacySettings(): PrivacySettings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
}

/** ~500 m: enough for reports to be grouped with others, too coarse to pin a home. */
export const APPROXIMATE_STEP_DEG = 0.005;

export function approximate(lat: number, lon: number): { lat: number; lon: number } {
  const snap = (v: number) => Math.round(v / APPROXIMATE_STEP_DEG) * APPROXIMATE_STEP_DEG;
  return { lat: Number(snap(lat).toFixed(4)), lon: Number(snap(lon).toFixed(4)) };
}
