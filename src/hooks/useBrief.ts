import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { SituationalBrief, BriefPending } from '@/api/types';

type BriefState =
  | { status: 'idle' }
  | { status: 'pending'; retryAfterSeconds: number }
  | { status: 'ready'; brief: SituationalBrief }
  | { status: 'failed'; error: string };

export function useBrief(eventId: string | undefined): {
  state: BriefState;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: ['brief', eventId],
    queryFn: async (): Promise<SituationalBrief | BriefPending> => {
      return api.getEventBrief(eventId!);
    },
    enabled: !!eventId,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && 'status' in data && (data as BriefPending).status === 'pending') {
        return ((data as BriefPending).retry_after_seconds || 15) * 1000;
      }
      return false;
    },
  });

  if (!eventId) {
    return { state: { status: 'idle' }, refetch: () => {} };
  }

  if (query.isLoading) {
    return { state: { status: 'pending', retryAfterSeconds: 0 }, refetch: query.refetch };
  }

  if (query.error) {
    return {
      state: { status: 'failed', error: 'Could not load the situational brief.' },
      refetch: query.refetch,
    };
  }

  const data = query.data;
  if (data && 'summary' in data) {
    return { state: { status: 'ready', brief: data as SituationalBrief }, refetch: query.refetch };
  }

  if (data && 'status' in data) {
    const pending = data as BriefPending;
    return { state: { status: 'pending', retryAfterSeconds: pending.retry_after_seconds }, refetch: query.refetch };
  }

  return { state: { status: 'idle' }, refetch: query.refetch };
}
