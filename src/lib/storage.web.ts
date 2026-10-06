/** Web implementation of the key-value store, backed by localStorage. */
export const kv = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* private mode / quota */
    }
  },
  /** Account deletion: remove everything this app stored in the browser. */
  clear(): void {
    try {
      window.localStorage.clear();
    } catch {
      /* ignore */
    }
  },
};

export const asyncStorage = {
  getItem: async (key: string) => kv.get(key),
  setItem: async (key: string, value: string) => kv.set(key, value),
  removeItem: async (key: string) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
