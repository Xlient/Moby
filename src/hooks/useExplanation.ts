import { useQuery } from '@tanstack/react-query';
import { api, ApiRequestError } from '@/api/client';
import type { AlertExplanation } from '@/api/types';

type Pending = { status: 'pending'; retry_after_seconds?: number };

/**
 * "What this means for you" for an official alert. Written by Nemotron Super on first view
 * and cached per event; while it's being written the API answers 202 and we poll.
 * Anything else (404, rejected by the grounding checks, offline) shows nothing: the
 * agency's own text is always on screen anyway.
 */
export function useExplanation(eventId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ['explanation', eventId],
    queryFn: (): Promise<AlertExplanation | Pending> => api.getExplanation(eventId!),
    enabled: enabled && !!eventId,
    retry: (count, err) => !(err instanceof ApiRequestError && err.status === 404) && count < 1,
    staleTime: 30 * 60_000,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data || !('status' in data)) return false;
      // Give up polling after ~2 minutes: the explainer loop runs every 15 s.
      return q.state.dataUpdateCount < 24 ? (data.retry_after_seconds || 5) * 1000 : false;
    },
  });
  const data = query.data;
  return {
    explanation: data && 'summary' in data ? data : undefined,
    pending: query.isLoading || (!!data && 'status' in data),
  };
}
