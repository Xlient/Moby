import { initializeApp, getApps, getApp } from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import type { Auth, Persistence } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { env } from '@/config/env';
import { asyncStorage } from '@/lib/storage';
import { connectEmulators } from './firebaseEmulators';

// Native (Android/iOS). The web variant lives in firebase.web.ts.

const { initializeAuth, getAuth } = firebaseAuth;
// Present at runtime in Firebase's React Native build (Metro resolves it via the
// "react-native" export condition) but missing from the published web typings.
const { getReactNativePersistence } = firebaseAuth as typeof firebaseAuth & {
  getReactNativePersistence: (storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<unknown>;
  }) => Persistence;
};

export const isFirebaseConfigured: boolean =
  !!env.firebase.apiKey && !!env.firebase.projectId;

let auth: Auth | null = null;
let db: Firestore | null = null;

if (isFirebaseConfigured) {
  if (getApps().length === 0) {
    const app = initializeApp(env.firebase);
    // Persist the session on-device so users stay signed in across restarts
    // (and while offline).
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(asyncStorage),
    });
    db = getFirestore(app);
    connectEmulators(auth, db);
  } else {
    // Fast Refresh re-evaluates this module; the app (and its emulator wiring) already exist.
    auth = getAuth(getApp());
    db = getFirestore(getApp());
  }
}

export { auth, db };
