import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { EventReports } from '@/api/types';

/**
 * Community reports behind an event, for alert detail. Official-only alerts have
 * none, so this is only enabled for community-sourced alerts.
 */
export function useEventReports(eventId: string | undefined, enabled: boolean) {
  const query = useQuery<EventReports>({
    queryKey: ['event-reports', eventId],
    queryFn: () => api.getEventReports(eventId!),
    enabled: !!eventId && enabled,
    staleTime: 60_000,
  });
  return { data: query.data, loading: query.isLoading, error: !!query.error, refetch: query.refetch };
}
