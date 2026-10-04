import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

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

/**
 * Where the phone is, for placing a report. Shows the last known position at once
 * (works offline, instant), then refines it with a current fix. Never blocks the UI
 * on GPS: a report can always be sent with the best position available.
 */
export function useDeviceLocation(active: boolean) {
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [fix, setFix] = useState<DeviceFix | null>(null);
  const cancelled = useRef(false);

  const locate = useCallback(async () => {
    cancelled.current = false;
    setStatus('locating');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        if (!cancelled.current) setStatus('denied');
        return;
      }
      const last = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60_000 });
      if (last && !cancelled.current) {
        setFix(toFix(last));
        setStatus('ready');
      }
      // mayShowUserSettingsDialog: false — don't make Google's "Location Accuracy"
      // (network-assisted location) a requirement. If someone declines that prompt,
      // plain GPS must still work; otherwise they couldn't report at all.
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: false,
      });
      if (!cancelled.current) {
        setFix(toFix(current));
        setStatus('ready');
      }
    } catch {
      // Location services off, or no fix possible (e.g. indoors, airplane mode).
      if (!cancelled.current) setStatus((s) => (s === 'ready' ? s : 'unavailable'));
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    locate();
    return () => {
      cancelled.current = true;
    };
  }, [active, locate]);

  return { status, fix, retry: locate };
}
