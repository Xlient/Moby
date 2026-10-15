import { doc, getDoc } from 'firebase/firestore';
import type { QueryClient } from '@tanstack/react-query';
import { db, isFirebaseConfigured } from './firebase';
import { api } from './client';
import { env } from '@/config/env';

/**
 * Insurance for installed builds: the API address is baked in at build time, and a
 * Nebius endpoint gets a new URL if it ever has to be recreated. Firestore
 * `public/app.api_url` (the full base, ending in /v1; readable by anyone, writable only from the Firebase console)
 * overrides it, so a recreated backend can be pointed at without shipping a new app.
 * Absent, unreadable or not https: the built-in address stays.
 */
export async function applyApiOverride(queryClient: QueryClient): Promise<void> {
  if (env.useMock || !isFirebaseConfigured || !db) return;
  try {
    const snap = await Promise.race([
      getDoc(doc(db, 'public', 'app')),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ]);
    const url = snap.get('api_url');
    if (typeof url === 'string' && /^https:\/\/[^\s/]+/.test(url) && api.setBaseUrl(url)) {
      await queryClient.invalidateQueries();
    }
  } catch {
    // Offline or no access: keep the built-in address.
  }
}
