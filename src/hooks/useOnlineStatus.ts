import { useSyncExternalStore, useCallback } from 'react';

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

function getServerSnapshot(): boolean {
  return true;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const DISMISS_KEY = 'offline-banner-dismissed';

export function useOfflineBannerDismiss(): {
  isDismissed: boolean;
  dismiss: () => void;
} {
  const isDismissed = sessionStorage.getItem(DISMISS_KEY) === 'true';
  const dismiss = useCallback(() => {
    sessionStorage.setItem(DISMISS_KEY, 'true');
    window.dispatchEvent(new Event('storage'));
  }, []);
  return { isDismissed, dismiss };
}
