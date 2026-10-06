import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { env } from '@/config/env';
import { USER_CENTER } from '@/lib/geo';
import { kv } from '@/lib/storage';

export type CenterSource =
  /** A fix from this device (possibly the last known one). */
  | 'device'
  /** No permission or no fix yet, and nothing saved: the demo city. */
  | 'demo';

export interface UserCenter {
  lat: number;
  lon: number;
  source: CenterSource;
  /**
   * Why there's no device fix, so the UI never passes the demo city off as "near you":
   * permission refused, or location off / no fix possible.
   */
  problem: null | 'denied' | 'unavailable';
}

const SAVED_KEY = 'last-device-center';

function saved(): { lat: number; lon: number } | null {
  try {
    const raw = kv.get(SAVED_KEY);
    return raw ? (JSON.parse(raw) as { lat: number; lon: number }) : null;
  } catch {
    return null;
  }
}

function initial(): UserCenter {
  const s = env.useMock ? null : saved();
  return s ? { ...s, source: 'device', problem: null } : { ...USER_CENTER, source: 'demo', problem: null };
}

const Ctx = createContext<{ center: UserCenter; start: () => void; retry: () => void } | null>(null);

/** getCurrentPositionAsync can wait forever with no sky view; give up and say so. */
const FIX_TIMEOUT_MS = 20_000;

/**
 * "Where the person is", for everything that means "near me": Home, the alert
 * list, the map and distances. Starts at the last saved position (works offline,
 * instant), then refreshes from the device — on first use and whenever the app
 * comes back to the foreground.
 *
 * Mock data is pinned around the demo city, so mock mode always uses it.
 */
export function UserLocationProvider({ children }: { children: ReactNode }) {
  const [center, setCenter] = useState<UserCenter>(initial);
  const started = useRef(false);

  const refresh = useCallback(async () => {
    if (env.useMock) return;
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setCenter((c) => ({ ...c, problem: 'denied' }));
        return;
      }
      const apply = (p: Location.LocationObject) => {
        const next = { lat: p.coords.latitude, lon: p.coords.longitude };
        kv.set(SAVED_KEY, JSON.stringify(next));
        setCenter({ ...next, source: 'device', problem: null });
      };
      const last = await Location.getLastKnownPositionAsync({ maxAge: 60 * 60_000 });
      if (last) apply(last);
      // One High fix per foreground: Balanced skips GPS when network location is off
      // (e.g. Google's Location Accuracy declined), which would leave people with no fix.
      // mayShowUserSettingsDialog: false, as in useDeviceLocation — never nag for it.
      const current = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, mayShowUserSettingsDialog: false }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
      ]);
      if (current) apply(current);
      else if (!last) setCenter((c) => ({ ...c, problem: 'unavailable' }));
    } catch {
      // Location services off or no fix: keep whatever we had, and say why.
      setCenter((c) => ({ ...c, problem: 'unavailable' }));
    }
  }, []);

  const start = useCallback(() => {
    if (started.current) return;
    started.current = true;
    refresh();
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && started.current) refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const value = useMemo(() => ({ center, start, retry: refresh }), [center, start, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The centre for "near me". The first screen that asks for it triggers the
 * location permission prompt (not app start, so sign-in comes first).
 */
export function useUserCenter(): UserCenter {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useUserCenter must be used inside UserLocationProvider');
  const { start } = ctx;
  useEffect(() => {
    start();
  }, [start]);
  return ctx.center;
}

/**
 * Rounded to ~1 km so small GPS jitter doesn't refetch alerts. Fetches use this;
 * distances use the exact centre.
 */
export function fetchCenter(c: { lat: number; lon: number }): { lat: number; lon: number } {
  return { lat: Math.round(c.lat * 100) / 100, lon: Math.round(c.lon * 100) / 100 };
}

/** Ask for a fresh fix (e.g. after "Can't find where you are"). */
export function useRetryLocation(): () => void {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRetryLocation must be used inside UserLocationProvider');
  return ctx.retry;
}

/** The current centre without triggering the permission prompt (for background sync). */
export function useUserCenterPassive(): UserCenter {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useUserCenterPassive must be used inside UserLocationProvider');
  return ctx.center;
}
