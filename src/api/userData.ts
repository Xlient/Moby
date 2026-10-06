import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import { db } from './firebase';
import type { AlertPreferences, RegionCode, Severity, Subscription } from './types';

// ── Firestore layout ─────────────────────────────────────────────────
//
//   users/{uid}                       UserProfile
//   users/{uid}/subscriptions/{id}    StoredSubscription
//
// Only user-owned data lives here. Events, alerts and reports belong to the
// backend (Postgres + PostGIS); the app reaches them through the REST API.
// Field names follow api-contract-v1.yaml so records map 1:1 when the backend
// takes over subscriptions. Access rules: firestore.rules.

export interface UserSettings {
  nearby_radius_km: number;
  /** Absent on profiles created before alert preferences existed: means defaults. */
  alert_preferences?: AlertPreferences;
}

export interface UserProfile {
  email: string;
  display_name: string | null;
  home_region: RegionCode;
  /** Set on create only; the rules forbid clients changing it. */
  roles: ('subscriber' | 'reporter' | 'reviewer' | 'admin')[];
  settings: UserSettings;
  created_at: Timestamp | null;
}

type StoredSubscription = Omit<Subscription, 'subscription_id'> & {
  created_at: Timestamp | null;
};

export type NewSubscription = Omit<Subscription, 'subscription_id'>;

function requireDb() {
  if (!db) throw new Error('Firebase is not configured.');
  return db;
}

const userDoc = (uid: string) => doc(requireDb(), 'users', uid);
const subscriptionsCol = (uid: string) => collection(requireDb(), 'users', uid, 'subscriptions');

// ── Profile ──────────────────────────────────────────────────────────

/** Creates the profile on first sign-in. Leaves an existing profile untouched. */
export async function ensureUserProfile(
  user: FirebaseUser,
  defaults: { displayName?: string | null; nearbyRadiusKm: number; alertPreferences: AlertPreferences },
): Promise<void> {
  const ref = userDoc(user.uid);
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) return;
  await setDoc(ref, {
    email: user.email ?? '',
    display_name: defaults.displayName ?? user.displayName ?? null,
    home_region: 'US',
    roles: ['subscriber', 'reporter'],
    settings: { nearby_radius_km: defaults.nearbyRadiusKm, alert_preferences: defaults.alertPreferences },
    created_at: serverTimestamp(),
  });
}

export function watchUserProfile(
  uid: string,
  onChange: (profile: UserProfile | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    userDoc(uid),
    (snapshot) => onChange(snapshot.exists() ? (snapshot.data() as UserProfile) : null),
    onError,
  );
}

export async function updateDisplayName(uid: string, displayName: string): Promise<void> {
  await updateDoc(userDoc(uid), { display_name: displayName });
}

export async function updateUserSettings(uid: string, settings: Partial<UserSettings>): Promise<void> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    patch[`settings.${key}`] = value;
  }
  await updateDoc(userDoc(uid), patch);
}

// ── Subscriptions (watched areas) ────────────────────────────────────

export function watchSubscriptions(
  uid: string,
  onChange: (subscriptions: Subscription[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(subscriptionsCol(uid), orderBy('created_at', 'asc')),
    (snapshot) => {
      onChange(
        snapshot.docs.map((d) => {
          const { created_at: _createdAt, ...data } = d.data() as StoredSubscription;
          return { subscription_id: d.id, ...data };
        }),
      );
    },
    onError,
  );
}

export async function addSubscription(uid: string, subscription: NewSubscription): Promise<string> {
  const ref = await addDoc(subscriptionsCol(uid), {
    ...subscription,
    created_at: serverTimestamp(),
  });
  return ref.id;
}

/** Account deletion: the profile and every saved area (owner-only, see firestore.rules). */
export async function deleteUserData(uid: string): Promise<void> {
  const areas = await getDocs(subscriptionsCol(uid));
  await Promise.all(areas.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(userDoc(uid));
}

export async function removeSubscription(uid: string, subscriptionId: string): Promise<void> {
  await deleteDoc(doc(subscriptionsCol(uid), subscriptionId));
}

export const SEVERITY_OPTIONS: readonly Severity[] = ['low', 'medium', 'high', 'critical'];
