import { useSyncExternalStore, useCallback } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

// ── Connectivity ─────────────────────────────────────────────
//
// Backed by NetInfo so it works on Android/iOS (and web, where NetInfo
// wraps navigator.onLine). "Online" means the device has a network link.
//
// isInternetReachable is deliberately ignored: on Android it reflects the OS
// "validated" check against Google's servers, which fails on networks that block
// Google (and on captive or partial links) even though our own API is reachable.
// Treating that as offline would hide alerts we could have fetched. Requests are
// still attempted and fall back to the saved copy if they fail.

function toOnline(state: NetInfoState): boolean {
  return state.isConnected !== false;
}

let online = true;
const listeners = new Set<() => void>();

NetInfo.addEventListener((state) => {
  const next = toOnline(state);
  if (next !== online) {
    online = next;
    listeners.forEach((cb) => cb());
  }
});

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): boolean {
  return online;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ── Offline banner dismissal (per app session, in memory) ────

let bannerDismissed = false;
const dismissListeners = new Set<() => void>();

function subscribeDismiss(cb: () => void): () => void {
  dismissListeners.add(cb);
  return () => {
    dismissListeners.delete(cb);
  };
}

export function useOfflineBannerDismiss(): {
  isDismissed: boolean;
  dismiss: () => void;
} {
  const isDismissed = useSyncExternalStore(
    subscribeDismiss,
    () => bannerDismissed,
    () => bannerDismissed,
  );
  const dismiss = useCallback(() => {
    bannerDismissed = true;
    dismissListeners.forEach((cb) => cb());
  }, []);
  return { isDismissed, dismiss };
}
