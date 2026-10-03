import { useCallback, useEffect, useState } from 'react';

/** How long to wait for Google map tiles before showing the drawn map instead. */
const LOAD_TIMEOUT_MS = 6000;

/**
 * Google maps render nothing (not even our pins) until their first tiles arrive.
 * With no signal — the moment this app matters most — or with Google unreachable,
 * that never happens. Give the map a few seconds, then fall back to the drawn map.
 *
 * Pass `onMapLoaded` to the MapView. `resetKey` restarts the wait (e.g. after a
 * remount).
 */
export function useMapLoadFallback(resetKey?: unknown): { failed: boolean; onMapLoaded: () => void } {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [resetKey]);

  useEffect(() => {
    if (loaded) return;
    const t = setTimeout(() => setFailed(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [loaded, resetKey]);

  const onMapLoaded = useCallback(() => {
    setLoaded(true);
    setFailed(false);
  }, []);

  return { failed, onMapLoaded };
}
