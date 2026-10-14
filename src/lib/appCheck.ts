import { Platform } from 'react-native';
import { env } from '@/config/env';

/**
 * Firebase App Check: proves to the Moby API that a request comes from the official,
 * signed app (Play Integrity on Android). The server rejects /v1/* calls without a
 * valid token (moby/api/appcheck.py), so builds from the public source can't use it.
 *
 * Enabled only in official builds (EXPO_PUBLIC_APP_CHECK=true, set in the release
 * workflow). Development builds use the debug provider; register the debug token the
 * app logs (Firebase console → App Check → Manage debug tokens) or set
 * EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN.
 *
 * Never blocks a request: if no token can be had, the request goes without one and
 * the server decides (it logs in 'monitor' mode, rejects in 'enforce').
 */

type TokenFn = () => Promise<string | null>;

let tokenFn: Promise<TokenFn> | null = null;

async function init(): Promise<TokenFn> {
  // Loaded lazily: public builds have the JS module but no Firebase app configured.
  const { getApp } = await import('@react-native-firebase/app');
  const { initializeAppCheck, getToken, ReactNativeFirebaseAppCheckProvider } = await import(
    '@react-native-firebase/app-check'
  );
  const provider = new ReactNativeFirebaseAppCheckProvider();
  provider.configure({
    android: {
      provider: __DEV__ ? 'debug' : 'playIntegrity',
      debugToken: env.appCheckDebugToken || undefined,
    },
    apple: {
      provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback',
      debugToken: env.appCheckDebugToken || undefined,
    },
  });
  const appCheck = await initializeAppCheck(getApp(), { provider, isTokenAutoRefreshEnabled: true });
  return async () => (await getToken(appCheck, false)).token;
}

export async function appCheckToken(): Promise<string | null> {
  if (!env.appCheck || env.useMock || Platform.OS === 'web') return null;
  try {
    tokenFn ??= init();
    return await (await tokenFn)();
  } catch (err) {
    tokenFn = null; // retry on the next request (e.g. Play services were updating)
    console.warn('App Check token unavailable', err);
    return null;
  }
}
