import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { randomUUID } from 'expo-crypto';
import { kv } from '@/lib/storage';

// Push notifications (FCM on Android). The server picks the channel per message
// (moby/delivery/fcm.py): CRITICAL_CHANNEL for critical alerts, "alerts" for the rest.
//
// Critical alerts sound like an emergency: their own tone (assets/sounds/moby_alarm.wav,
// bundled by the expo-notifications plugin in app.json), a long vibration, and through
// Do Not Disturb once the person grants Moby DND access. The ringer's silent/vibrate mode
// still mutes them: see the note on audioAttributes below.
//
// Android never lets an app change a channel's sound, so the tone needs a new channel.
// Servers deployed before it still send channel "critical": that channel is deleted here,
// and Firebase then uses the manifest default (app.json `defaultChannel`), which is
// CRITICAL_CHANNEL. While the app is open, Expo shows pushes itself and would use a
// plain fallback instead, so the handler below re-shows critical pushes on the alarm channel.

export const CRITICAL_CHANNEL = 'critical_alarm';
const LEGACY_CRITICAL_CHANNEL = 'critical';
const ALARM_SOUND = 'moby_alarm.wav';

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

const SHOW = { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
const HIDE = { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };

/** A critical push Expo is about to show on some other channel (see the note at the top). */
function criticalPushOffChannel(n: Notifications.Notification): boolean {
  const trigger = n.request.trigger;
  if (Platform.OS !== 'android' || !trigger || !('type' in trigger) || trigger.type !== 'push') return false;
  return (
    n.request.content.data?.severity === 'critical' &&
    (trigger as Notifications.PushNotificationTrigger).remoteMessage?.notification?.channelId !== CRITICAL_CHANNEL
  );
}

// An alert that arrives while the app is open still shows: it's a warning, not chatter.
if (pushSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      if (!criticalPushOffChannel(n)) return SHOW;
      const { title, body, data } = n.request.content;
      await Notifications.scheduleNotificationAsync({
        identifier: n.request.identifier,
        content: { title, body, data, sound: ALARM_SOUND, priority: Notifications.AndroidNotificationPriority.MAX },
        trigger: { channelId: CRITICAL_CHANNEL },
      });
      return HIDE;
    },
  });
}

async function ensureCriticalChannel(): Promise<Notifications.NotificationChannel | null> {
  return Notifications.setNotificationChannelAsync(CRITICAL_CHANNEL, {
    name: 'Critical alerts',
    description: 'Life-threatening hazards near you or your saved areas. Plays an alarm tone, through Do Not Disturb if you allow it.',
    importance: Notifications.AndroidImportance.MAX,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: ALARM_SOUND,
    // Alarm volume up to Android 14. Android 15+ turns alarm usage back into notification
    // usage unless the notification's category is "alarm", which pushes can't set.
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.ALARM,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
    },
    // Android keeps this only while Moby has Do Not Disturb access (criticalBypassesDnd).
    bypassDnd: true,
    enableVibrate: true,
    vibrationPattern: [0, 500, 250, 500, 250, 500],
  });
}

async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.deleteNotificationChannelAsync(LEGACY_CRITICAL_CHANNEL);
  await ensureCriticalChannel();
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

/**
 * Android: does the critical alarm sound through Do Not Disturb? Only with DND access,
 * which the person grants in system settings. Re-applying the channel lets Android pick
 * up access granted after the channel was made. null where it doesn't apply.
 */
export async function criticalBypassesDnd(): Promise<boolean | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const channel = await ensureCriticalChannel();
    return channel?.bypassDnd ?? false;
  } catch {
    return false;
  }
}

/** The system screen where the person lets Moby through Do Not Disturb. */
export function openDndAccessSettings(): Promise<void> {
  return Linking.sendIntent('android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS').catch(() =>
    Linking.openSettings(),
  );
}

/** A local critical notification, so people can hear what a real one sounds like. */
export async function playTestAlarm(): Promise<void> {
  await ensureChannels();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Test: critical alert',
      body: 'This is how Moby sounds when a life-threatening hazard is near you. Nothing is happening.',
      sound: ALARM_SOUND,
      priority: Notifications.AndroidNotificationPriority.MAX,
      data: { test: true },
    },
    trigger: Platform.OS === 'android' ? { channelId: CRITICAL_CHANNEL } : null,
  });
}

/** The alert a notification is about (set by the server in the FCM data block). */
export function alertIdOf(response: Notifications.NotificationResponse | null): string | null {
  const id = response?.notification.request.content.data?.alert_id;
  return typeof id === 'string' ? id : null;
}
