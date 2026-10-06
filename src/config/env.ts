/**
 * Build-time configuration. Expo inlines `process.env.EXPO_PUBLIC_*` into the
 * bundle, so these must be referenced with dot access (no destructuring or
 * dynamic keys). See .env.example.
 */
const apiUrl = process.env.EXPO_PUBLIC_API_URL || '';
const useMockRaw = process.env.EXPO_PUBLIC_USE_MOCK;

export const env = {
  apiUrl: apiUrl || 'https://api.example.dev/v1',
  /** Mock data unless a real API URL is configured (override with EXPO_PUBLIC_USE_MOCK). */
  useMock: useMockRaw ? useMockRaw === 'true' : !apiUrl,
  /** OAuth web client ID used for Google Sign-In on Android/iOS (see .env.example). */
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
  /** Official builds only: send Firebase App Check tokens (see src/lib/appCheck.ts). */
  appCheck: process.env.EXPO_PUBLIC_APP_CHECK === 'true',
  /** Development builds: a debug token registered in the Firebase console. */
  appCheckDebugToken: process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN ?? '',
  firebase: {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
    /**
     * Host of the local Firebase Emulator Suite (e.g. "localhost"). When set, Auth and
     * Firestore talk to the emulators instead of a real project. See `npm run emulators`.
     */
    emulatorHost: process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST ?? '',
  },
} as const;
