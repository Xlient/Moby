import { Platform } from 'react-native';
import { connectAuthEmulator, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { env } from '@/config/env';

// Ports match firebase.json.
const AUTH_PORT = 9099;
const FIRESTORE_PORT = 8080;

/**
 * Inside the Android emulator, "localhost" is the emulator itself; the host machine
 * is reachable at 10.0.2.2. Physical devices need the machine's LAN IP instead.
 */
function resolveHost(host: string): string {
  if (Platform.OS === 'android' && (host === 'localhost' || host === '127.0.0.1')) {
    return '10.0.2.2';
  }
  return host;
}

export function connectEmulators(auth: Auth, db: Firestore): void {
  if (!env.firebase.emulatorHost) return;
  const host = resolveHost(env.firebase.emulatorHost);
  connectAuthEmulator(auth, `http://${host}:${AUTH_PORT}`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, FIRESTORE_PORT);
}
