import { useSyncExternalStore, useCallback } from 'react';
import { kv } from '@/lib/storage';
import type { AlertPreferences, HazardType, Severity, VerificationLabel } from '@/api/types';

// What kinds of alert the user wants (contract `AlertPreferences`). The same filter
// runs on the server for GET /alerts and push delivery; on the device it drives the
// home list and both maps, so they always agree.
//
// The device copy is the source of truth for rendering (works offline and signed
// out). Signed in, AuthProvider mirrors it to users/{uid}.settings.alert_preferences.

export const ALL_HAZARDS: readonly HazardType[] = ['flood', 'fire', 'earthquake', 'storm', 'landslide', 'other'];
export const SEVERITY_ORDER: readonly Severity[] = ['low', 'medium', 'high', 'critical'];

export type CommunityReports = NonNullable<AlertPreferences['community_reports']>;
export const COMMUNITY_OPTIONS: readonly CommunityReports[] = ['off', 'corroborated', 'all'];

/**
 * Every hazard, every severity, marine off (marine is ~70% of NWS alerts; opt-in), and
 * community reports once 2+ different people agree (single reports are opt-in).
 */
export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  hazard_types: [...ALL_HAZARDS],
  min_severity: 'low',
  include_marine: false,
  community_reports: 'corroborated',
};

const STORAGE_KEY = 'alert-preferences';

/**
 * Tolerant parse: unknown values are dropped, and an empty hazard list means "all" —
 * nobody should be able to silence every alert by accident.
 */
export function normalizeAlertPreferences(raw: unknown): AlertPreferences {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Partial<AlertPreferences>;
  const hazards = (Array.isArray(data.hazard_types) ? data.hazard_types : []).filter((h): h is HazardType =>
    (ALL_HAZARDS as readonly string[]).includes(h),
  );
  const minSeverity = (SEVERITY_ORDER as readonly string[]).includes(data.min_severity as string)
    ? (data.min_severity as Severity)
    : 'low';
  return {
    hazard_types: hazards.length > 0 ? ALL_HAZARDS.filter((h) => hazards.includes(h)) : [...ALL_HAZARDS],
    min_severity: minSeverity,
    include_marine: data.include_marine === true,
    community_reports: (COMMUNITY_OPTIONS as readonly string[]).includes(data.community_reports as string)
      ? (data.community_reports as CommunityReports)
      : 'corroborated',
  };
}

/** Whether the user chose to see this kind of community report (official alerts always pass). */
export function wantsVerification(prefs: AlertPreferences, label: VerificationLabel | undefined): boolean {
  const choice = prefs.community_reports ?? 'corroborated';
  if (!label || label === 'official_confirmed') return true;
  if (label === 'corroborated_report') return choice !== 'off';
  return choice === 'all';
}

/**
 * Critical alerts always match the hazard, severity and marine filters: warning people
 * early is the point of the app, so those can't hide a critical alert nearby. The
 * community_reports choice is about trust, not severity, so it applies to critical
 * reports too. (Same rules as the server's alerts_near, so the app and notifications agree.)
 */
export function matchesAlertPreferences(
  prefs: AlertPreferences,
  alert: { hazard_type?: HazardType; severity: Severity; marine?: boolean; verification_label?: VerificationLabel },
): boolean {
  if (!wantsVerification(prefs, alert.verification_label)) return false;
  if (alert.severity === 'critical') return true;
  const hazards = prefs.hazard_types ?? ALL_HAZARDS;
  return (
    hazards.includes(alert.hazard_type ?? 'other') &&
    SEVERITY_ORDER.indexOf(alert.severity) >= SEVERITY_ORDER.indexOf(prefs.min_severity) &&
    (prefs.include_marine || !alert.marine)
  );
}

function sameAs(a: AlertPreferences, b: AlertPreferences): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function readStored(): AlertPreferences {
  try {
    const raw = kv.get(STORAGE_KEY);
    if (raw) return normalizeAlertPreferences(JSON.parse(raw));
  } catch {
    // Corrupt or unavailable storage: defaults.
  }
  return DEFAULT_ALERT_PREFERENCES;
}

const listeners = new Set<() => void>();
let cached: AlertPreferences = readStored();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function storeLocally(next: AlertPreferences): void {
  if (sameAs(next, cached)) return;
  cached = next;
  try {
    kv.set(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore write failures
  }
  listeners.forEach((cb) => cb());
}

let remoteSink: ((next: AlertPreferences) => void) | null = null;

export function setAlertPreferencesRemoteSink(sink: ((next: AlertPreferences) => void) | null): void {
  remoteSink = sink;
}

/** Applies a value read from the user's profile without writing it back. */
export function applyRemoteAlertPreferences(value: unknown): void {
  storeLocally(normalizeAlertPreferences(value));
}

export function getAlertPreferences(): AlertPreferences {
  return cached;
}

export function useAlertPreferences(): [AlertPreferences, (next: AlertPreferences) => void] {
  const prefs = useSyncExternalStore(subscribe, () => cached, () => DEFAULT_ALERT_PREFERENCES);
  const setPrefs = useCallback((next: AlertPreferences) => {
    const normalized = normalizeAlertPreferences(next);
    storeLocally(normalized);
    remoteSink?.(normalized);
  }, []);
  return [prefs, setPrefs];
}
