import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
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
 * Watched areas. Signed in, they live in Firestore under the user's account and
 * update live. Without Firebase configured, the mock API's sample areas are shown.
 */
export function useSubscriptions(): UseSubscriptionsResult {
  const { user, isConfigured } = useAuth();
  const useFirestore = isConfigured && !!user;

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

  const mock = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => api.getSubscriptions(),
    enabled: !useFirestore,
    staleTime: 2 * 60_000,
  });

  const add = useCallback(
    async (subscription: NewSubscription) => {
      if (!user) throw new Error('Sign in to save areas.');
      await addSubscription(user.uid, subscription);
    },
    [user],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!user) throw new Error('Sign in to change your areas.');
      await removeSubscription(user.uid, id);
    },
    [user],
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
    subscriptions: mock.data ?? [],
    loading: mock.isLoading,
    error: mock.error ? 'Could not load your areas.' : null,
    canEdit: false,
    addSubscription: add,
    deleteSubscription: remove,
  };
}
