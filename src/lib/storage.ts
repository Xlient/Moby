import { Storage } from 'expo-sqlite/kv-store';

/**
 * Small synchronous key-value store that survives app restarts.
 * Native: SQLite-backed (expo-sqlite/kv-store). Web: see storage.web.ts.
 *
 * Synchronous on purpose — the offline caches are read during render so the
 * last-known alerts show immediately with no connectivity.
 */
export const kv = {
  get(key: string): string | null {
    try {
      return Storage.getItemSync(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      Storage.setItemSync(key, value);
    } catch {
      /* ignore write failures */
    }
  },
};

/** AsyncStorage-compatible store (used for Firebase auth persistence). */
export const asyncStorage = Storage;
