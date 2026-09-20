import { useState, useEffect, useCallback } from 'react';
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
  const [state, setState] = useState<BriefState>({ status: 'idle' });

  const fetchBrief = useCallback(async () => {
    if (!eventId) return;

    setState({ status: 'pending', retryAfterSeconds: 0 });

    try {
      const result = await api.getEventBrief(eventId);

      if (result && 'summary' in result) {
        setState({ status: 'ready', brief: result as SituationalBrief });
      } else if (result && 'status' in result) {
        const pending = result as BriefPending;
        setState({ status: 'pending', retryAfterSeconds: pending.retry_after_seconds });
      } else {
        setState({ status: 'failed', error: 'Brief not available for this event.' });
      }
    } catch {
      setState({ status: 'failed', error: 'Could not load the situational brief.' });
    }
  }, [eventId]);

  useEffect(() => {
    fetchBrief();
  }, [fetchBrief]);

  useEffect(() => {
    if (state.status === 'pending' && state.retryAfterSeconds > 0) {
      const timer = setTimeout(fetchBrief, state.retryAfterSeconds * 1000);
      return () => clearTimeout(timer);
    }
  }, [state, fetchBrief]);

  return { state, refetch: fetchBrief };
}
