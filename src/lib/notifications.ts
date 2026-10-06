import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { randomUUID } from 'expo-crypto';
import { kv } from '@/lib/storage';

// Push notifications (FCM on Android). The server picks the channel per message
// (moby/delivery/fcm.py): "critical" for critical alerts, "alerts" for the rest.

const DEVICE_ID_KEY = 'device-id';

/** Stable per install; the server keys push tokens by it. */
export function deviceId(): string {
  let id = kv.get(DEVICE_ID_KEY);
  if (!id) {
    id = randomUUID();
    kv.set(DEVICE_ID_KEY, id);
  }
  return id;
}

export const pushSupported = Platform.OS === 'android' || Platform.OS === 'ios';

// An alert that arrives while the app is open still shows: it's a warning, not chatter.
if (pushSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('critical', {
    name: 'Critical alerts',
    description: 'Life-threatening hazards near you or your saved areas.',
    importance: Notifications.AndroidImportance.MAX,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    vibrationPattern: [0, 500, 250, 500],
  });
  await Notifications.setNotificationChannelAsync('alerts', {
    name: 'Alerts',
    description: 'Confirmed hazards near you or your saved areas.',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export type PushSetup =
  | { status: 'ready'; token: string; platform: 'android' | 'ios' }
  | { status: 'denied' }
  | { status: 'unavailable'; reason: string };

/**
 * Channels, permission (Android 13+ asks), then this install's FCM/APNs token.
 * Never throws: push is a bonus on top of the in-app list, which works regardless.
 */
export async function setUpPush(): Promise<PushSetup> {
  if (!pushSupported) return { status: 'unavailable', reason: 'not a phone' };
  try {
    await ensureChannels();
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return { status: 'denied' };
    const token = await Notifications.getDevicePushTokenAsync();
    return { status: 'ready', token: String(token.data), platform: Platform.OS as 'android' | 'ios' };
  } catch (err) {
    return { status: 'unavailable', reason: err instanceof Error ? err.message : String(err) };
  }
}

/** The alert a notification is about (set by the server in the FCM data block). */
export function alertIdOf(response: Notifications.NotificationResponse | null): string | null {
  const id = response?.notification.request.content.data?.alert_id;
  return typeof id === 'string' ? id : null;
}
