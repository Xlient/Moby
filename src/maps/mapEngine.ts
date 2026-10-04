import { useCallback, useSyncExternalStore } from 'react';
import { kv } from '@/lib/storage';

/**
 * Which map renderer to use (issue #21). MapLibre is the default: terrain, warning
 * areas, offline maps, and it works in China (Google tiles don't). Google
 * (react-native-maps) remains as "Classic map" in Settings.
 */
export type MapEngine = 'google' | 'maplibre';

const KEY = 'map-engine';
const listeners = new Set<() => void>();

function read(): MapEngine {
  return kv.get(KEY) === 'google' ? 'google' : 'maplibre';
}

let current: MapEngine = read();

export function useMapEngine(): [MapEngine, (next: MapEngine) => void] {
  const engine = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
  const set = useCallback((next: MapEngine) => {
    current = next;
    kv.set(KEY, next);
    listeners.forEach((cb) => cb());
  }, []);
  return [engine, set];
}
