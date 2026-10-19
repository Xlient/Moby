import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { ensureForegroundLocation } from '@/location/permission';

export interface DeviceFix {
  lat: number;
  lon: number;
  /** Metres (68% confidence), when the platform reports it. */
  accuracyM: number | null;
  /** ISO time of the fix. */
  at: string;
}

export type LocationStatus = 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable';

/** A fix older than this is shown as "last known", not current. */
const FRESH_MS = 2 * 60_000;

function toFix(p: Location.LocationObject): DeviceFix {
  return {
    lat: p.coords.latitude,
    lon: p.coords.longitude,
    accuracyM: p.coords.accuracy ?? null,
    at: new Date(p.timestamp).toISOString(),
  };
}

export function isFresh(fix: DeviceFix | null, now = Date.now()): boolean {
  return !!fix && now - new Date(fix.at).getTime() < FRESH_MS;
}

/** How old a last known position may be. Reports only use a recent one; "I need help"
 *  passes a longer age, since any position beats none there (it's labelled "last known"). */
const LAST_KNOWN_MAX_AGE_MS = 30 * 60_000;
/** Wi-Fi / cell fix: usually a second or two, when network location is on. */
const QUICK_FIX_TIMEOUT_MS = 8_000;
/** getCurrentPositionAsync can wait forever with no sky view (indoors); give up and say so. */
const GPS_FIX_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/**
 * Where the phone is, for placing a report or asking for help. Shows the last known
 * position at once (works offline, instant), then a quick network fix, then refines
 * it with GPS. Never blocks the UI on GPS, and always ends: with a fix, or with
 * 'unavailable' so the screen can offer "Try again".
 */
export function useDeviceLocation(active: boolean, { lastKnownMaxAgeMs = LAST_KNOWN_MAX_AGE_MS } = {}) {
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [fix, setFix] = useState<DeviceFix | null>(null);
  const cancelled = useRef(false);

  const locate = useCallback(async () => {
    cancelled.current = false;
    setStatus('locating');
    try {
      if (!(await ensureForegroundLocation())) {
        if (!cancelled.current) setStatus('denied');
        return;
      }
      let found = false;
      const apply = (p: Location.LocationObject | null) => {
        if (!p || cancelled.current) return;
        found = true;
        setFix(toFix(p));
        setStatus('ready');
      };
      apply(await Location.getLastKnownPositionAsync({ maxAge: lastKnownMaxAgeMs }));
      // mayShowUserSettingsDialog: false — don't make Google's "Location Accuracy"
      // (network-assisted location) a requirement. If someone declines that prompt,
      // plain GPS must still work; otherwise they couldn't report at all.
      // Balanced first: fast where network location is on, but it skips GPS when that
      // is off, so a High (GPS) fix always follows.
      apply(
        await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced, mayShowUserSettingsDialog: false }),
          QUICK_FIX_TIMEOUT_MS,
        ).catch(() => null),
      );
      apply(
        await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, mayShowUserSettingsDialog: false }),
          GPS_FIX_TIMEOUT_MS,
        ),
      );
      if (!found && !cancelled.current) setStatus('unavailable');
    } catch {
      // Location services off, or no fix possible (e.g. indoors, airplane mode).
      if (!cancelled.current) setStatus((s) => (s === 'ready' ? s : 'unavailable'));
    }
  }, [lastKnownMaxAgeMs]);

  useEffect(() => {
    if (!active) return;
    locate();
    return () => {
      cancelled.current = true;
    };
  }, [active, locate]);

  return { status, fix, retry: locate };
}
