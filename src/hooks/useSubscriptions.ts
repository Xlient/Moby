import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { env } from '@/config/env';
import {
  addSubscription,
  removeSubscription,
  watchSubscriptions,
  type NewSubscription,
} from '@/api/userData';
import type { Subscription } from '@/api/types';

export interface UseSubscriptionsResult {
  subscriptions: Subscription[];
  loading: boolean;
  error: string | null;
  /** True when changes are saved to the user's account (otherwise read-only mock data). */
  canEdit: boolean;
  addSubscription: (subscription: NewSubscription) => Promise<void>;
  deleteSubscription: (id: string) => Promise<void>;
}

/**
 * Watched areas.
 * - Real API, signed in: stored on the server (`/subscriptions`), where the delivery
 *   worker matches them against new alerts to send push notifications.
 * - Mock API, signed in: Firestore under the user's account (demo builds).
 * - Otherwise: the mock API's sample areas, read-only.
 */
export function useSubscriptions(): UseSubscriptionsResult {
  const { user, isConfigured } = useAuth();
  const queryClient = useQueryClient();
  const useServer = !env.useMock && !!user;
  const useFirestore = !useServer && isConfigured && !!user;

  const [live, setLive] = useState<Subscription[] | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    if (!useFirestore || !user) return;
    setLive(null);
    setLiveError(null);
    return watchSubscriptions(
      user.uid,
      (subs) => {
        setLive(subs);
        setLiveError(null);
      },
      () => setLiveError('Could not load your areas.'),
    );
  }, [useFirestore, user]);

  // Server (useServer) or the mock API's samples: the same endpoint either way.
  const listed = useQuery({
    queryKey: ['subscriptions', useServer ? user?.uid : 'mock'],
    queryFn: () => api.getSubscriptions(),
    enabled: !useFirestore,
    staleTime: 2 * 60_000,
  });

  const add = useCallback(
    async (subscription: NewSubscription) => {
      if (!user) throw new Error('Sign in to save areas.');
      if (useServer) {
        await api.createSubscription(subscription);
        await queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      } else {
        await addSubscription(user.uid, subscription);
      }
    },
    [user, useServer, queryClient],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!user) throw new Error('Sign in to change your areas.');
      if (useServer) {
        await api.deleteSubscription(id);
        await queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      } else {
        await removeSubscription(user.uid, id);
      }
    },
    [user, useServer, queryClient],
  );

  if (useFirestore) {
    return {
      subscriptions: live ?? [],
      loading: live === null && !liveError,
      error: liveError,
      canEdit: true,
      addSubscription: add,
      deleteSubscription: remove,
    };
  }

  return {
    subscriptions: listed.data ?? [],
    loading: listed.isLoading,
    error: listed.error ? 'Could not load your areas.' : null,
    canEdit: useServer,
    addSubscription: add,
    deleteSubscription: remove,
  };
}
