import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { api } from '@/api/client';
import { env } from '@/config/env';
import { onBeforeSignOut, useAuth } from '@/auth/AuthContext';
import { useAlertPreferences } from '@/hooks/useAlertPreferences';
import { useNearbyRadius } from '@/hooks/useNearbyRadius';
import { fetchCenter, useUserCenterPassive } from '@/location/UserLocationContext';
import { alertIdOf, deviceId, pushSupported, setUpPush } from '@/lib/notifications';

/**
 * Keeps the backend in step with this phone so push matches what the app shows
 * (handoff contract 5): the push token, the person's alert preferences, and the
 * "near me" area (device position at ~1 km + the Home radius). Also opens the
 * alert when a notification is tapped.
 *
 * All best-effort: failures are retried on the next change or app start, and the
 * in-app list never depends on any of this.
 */
export function useBackendSync(onOpenAlert: (alertId: string) => void): void {
  const { user } = useAuth();
  const active = !!user && !env.useMock;
  const [prefs] = useAlertPreferences();
  const [radiusKm] = useNearbyRadius();
  const center = useUserCenterPassive();   // Home asks for location; sync never prompts

  // ── Push token ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!active || !pushSupported) return;
    let cancelled = false;
    let sent: string | null = null;   // the first fetch and the token listener often report the same token
    const register = (token: string, platform: 'android' | 'ios') => {
      if (token === sent) return;
      sent = token;
      api
        .registerDevice({ device_id: deviceId(), push_provider: platform === 'ios' ? 'apns' : 'fcm', push_token: token, platform })
        .catch((err) => {
          sent = null;
          console.warn('Could not register for push', err);
        });
    };
    setUpPush().then((r) => {
      if (!cancelled && r.status === 'ready') register(r.token, r.platform);
    });
    // FCM rotates tokens occasionally; keep the server's copy current.
    const sub = Notifications.addPushTokenListener((t) => register(String(t.data), t.type === 'ios' ? 'ios' : 'android'));
    // Signing out: this phone stops getting the person's alerts.
    const off = onBeforeSignOut(() => api.unregisterDevice(deviceId()).catch(() => {}));
    return () => {
      cancelled = true;
      sub.remove();
      off();
    };
  }, [active, user?.uid]);

  // ── Alert preferences ──────────────────────────────────────────────
  const sentPrefs = useRef<string | null>(null);
  useEffect(() => {
    if (!active) {
      sentPrefs.current = null;
      return;
    }
    const json = JSON.stringify(prefs);
    if (json === sentPrefs.current) return;
    api
      .putAlertPreferences(prefs)
      .then(() => {
        sentPrefs.current = json;
      })
      .catch((err) => console.warn('Could not sync alert preferences', err));
  }, [active, prefs]);

  // ── Near me ────────────────────────────────────────────────────────
  // Only a real device fix: never subscribe someone to the demo city.
  const sentNearMe = useRef<string | null>(null);
  const coarse = fetchCenter(center);
  useEffect(() => {
    if (!active) {
      sentNearMe.current = null;
      return;
    }
    if (center.source !== 'device') return;
    const key = `${coarse.lat},${coarse.lon},${radiusKm}`;
    if (key === sentNearMe.current) return;
    api
      .putNearMe(coarse, radiusKm)
      .then(() => {
        sentNearMe.current = key;
      })
      .catch((err) => console.warn('Could not sync near-me area', err));
  }, [active, center.source, coarse.lat, coarse.lon, radiusKm]);

  // ── Tapped notifications ───────────────────────────────────────────
  const openRef = useRef(onOpenAlert);
  openRef.current = onOpenAlert;
  useEffect(() => {
    if (!pushSupported || !user) return;
    // Cold start from a notification tap.
    Notifications.getLastNotificationResponseAsync().then((r) => {
      const id = alertIdOf(r);
      if (id) {
        openRef.current(id);
        Notifications.clearLastNotificationResponseAsync().catch(() => {});
      }
    });
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const id = alertIdOf(r);
      if (id) openRef.current(id);
    });
    return () => sub.remove();
  }, [user?.uid]);
}
