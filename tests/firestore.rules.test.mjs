// Security-rule tests for firestore.rules. Needs the Firestore emulator:
//   npm run emulators        (in one terminal)
//   npm run test:rules       (in another)
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const ALICE = { uid: 'alice', email: 'alice@example.com' };

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-moby-rules-test',
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

const alice = () => env.authenticatedContext(ALICE.uid, { email: ALICE.email }).firestore();
const bob = () => env.authenticatedContext('bob', { email: 'bob@example.com' }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

function newProfile(overrides = {}) {
  return {
    email: ALICE.email,
    display_name: 'Alice',
    home_region: 'US',
    roles: ['subscriber', 'reporter'],
    settings: { nearby_radius_km: 25 },
    created_at: serverTimestamp(),
    ...overrides,
  };
}

async function seedAliceProfile() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', ALICE.uid), {
      ...newProfile(),
      created_at: new Date(),
    });
  });
}

function newArea(overrides = {}) {
  return {
    region: 'US',
    label: 'Home',
    center: { lat: 37.77, lon: -122.42, frame: 'WGS84' },
    radius_km: 25,
    min_severity: 'medium',
    created_at: serverTimestamp(),
    ...overrides,
  };
}

describe('users/{uid}', () => {
  test('owner can create a well-formed profile', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users', ALICE.uid), newProfile()));
  });

  test('profile without a name is allowed', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users', ALICE.uid), newProfile({ display_name: null })));
  });

  test('cannot create a profile for someone else', async () => {
    await assertFails(setDoc(doc(bob(), 'users', ALICE.uid), newProfile()));
  });

  test('cannot grant yourself reviewer on create', async () => {
    await assertFails(
      setDoc(doc(alice(), 'users', ALICE.uid), newProfile({ roles: ['subscriber', 'reviewer'] })),
    );
  });

  test('email must match the signed-in account', async () => {
    await assertFails(
      setDoc(doc(alice(), 'users', ALICE.uid), newProfile({ email: 'someone@else.com' })),
    );
  });

  test('radius must be one of the offered options', async () => {
    await assertFails(
      setDoc(doc(alice(), 'users', ALICE.uid), newProfile({ settings: { nearby_radius_km: 7 } })),
    );
  });

  test('owner can read; others and signed-out users cannot', async () => {
    await seedAliceProfile();
    await assertSucceeds(getDoc(doc(alice(), 'users', ALICE.uid)));
    await assertFails(getDoc(doc(bob(), 'users', ALICE.uid)));
    await assertFails(getDoc(doc(anon(), 'users', ALICE.uid)));
  });

  test('owner can change name and radius', async () => {
    await seedAliceProfile();
    const ref = doc(alice(), 'users', ALICE.uid);
    await assertSucceeds(updateDoc(ref, { display_name: 'Ali' }));
    await assertSucceeds(updateDoc(ref, { 'settings.nearby_radius_km': 50 }));
  });

  test('owner cannot change roles, email or region', async () => {
    await seedAliceProfile();
    const ref = doc(alice(), 'users', ALICE.uid);
    await assertFails(updateDoc(ref, { roles: ['subscriber', 'reporter', 'admin'] }));
    await assertFails(updateDoc(ref, { email: 'new@example.com' }));
    await assertFails(updateDoc(ref, { home_region: 'CN' }));
  });

  test('owner can save alert preferences', async () => {
    await seedAliceProfile();
    await assertSucceeds(updateDoc(doc(alice(), 'users', ALICE.uid), {
      'settings.alert_preferences': { hazard_types: ['flood', 'fire'], min_severity: 'high', include_marine: true },
    }));
  });

  test('profile can be created with alert preferences', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users', ALICE.uid), newProfile({
      settings: { nearby_radius_km: 25,
                  alert_preferences: { hazard_types: ['flood'], min_severity: 'low', include_marine: false } },
    })));
  });

  test('rejects malformed alert preferences', async () => {
    await seedAliceProfile();
    const ref = doc(alice(), 'users', ALICE.uid);
    await assertFails(updateDoc(ref, { 'settings.alert_preferences': { hazard_types: ['tsunami'] } }));
    await assertFails(updateDoc(ref, { 'settings.alert_preferences': { min_severity: 'extreme' } }));
    await assertFails(updateDoc(ref, { 'settings.alert_preferences': { include_marine: 'yes' } }));
    await assertFails(updateDoc(ref, { 'settings.alert_preferences': { notify_everyone: true } }));
  });

  test('cannot add unknown settings', async () => {
    await seedAliceProfile();
    await assertFails(updateDoc(doc(alice(), 'users', ALICE.uid), { 'settings.debug': true }));
  });

  test('owners can delete their profile (account deletion), others cannot', async () => {
    await seedAliceProfile();
    await assertFails(deleteDoc(doc(bob(), 'users', ALICE.uid)));
    await assertSucceeds(deleteDoc(doc(alice(), 'users', ALICE.uid)));
  });
});

describe('users/{uid}/subscriptions', () => {
  const areas = (db) => collection(db, 'users', ALICE.uid, 'subscriptions');

  test('owner can add, read and remove an area', async () => {
    await seedAliceProfile();
    const ref = await assertSucceeds(addDoc(areas(alice()), newArea()));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(deleteDoc(ref));
  });

  test('others cannot add to or read your areas', async () => {
    await assertFails(addDoc(areas(bob()), newArea()));
    await assertFails(getDoc(doc(areas(bob()), 'x')));
  });

  test('rejects bad coordinates, severity and radius', async () => {
    await assertFails(addDoc(areas(alice()), newArea({ center: { lat: 123, lon: 0 } })));
    await assertFails(addDoc(areas(alice()), newArea({ min_severity: 'extreme' })));
    await assertFails(addDoc(areas(alice()), newArea({ radius_km: 0 })));
    await assertFails(addDoc(areas(alice()), newArea({ radius_km: 10_000 })));
  });

  test('rejects unknown fields', async () => {
    await assertFails(addDoc(areas(alice()), newArea({ is_official: true })));
  });
});

describe('everything else', () => {
  test('alerts cannot be written or read via Firestore', async () => {
    await assertFails(setDoc(doc(alice(), 'alerts', 'a1'), { headline: 'Fake warning' }));
    await assertFails(getDoc(doc(alice(), 'alerts', 'a1')));
  });
});
