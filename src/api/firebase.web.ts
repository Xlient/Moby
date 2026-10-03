import { initializeApp, getApps } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { env } from '@/config/env';
import { connectEmulators } from './firebaseEmulators';

export const isFirebaseConfigured: boolean =
  !!env.firebase.apiKey && !!env.firebase.projectId;

let auth: Auth | null = null;
let db: Firestore | null = null;

if (isFirebaseConfigured) {
  const isFirstInit = getApps().length === 0;
  const app = isFirstInit ? initializeApp(env.firebase) : getApps()[0]!;
  auth = getAuth(app);
  db = getFirestore(app);
  if (isFirstInit) connectEmulators(auth, db);
}

export { auth, db };
