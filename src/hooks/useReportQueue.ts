import { useSyncExternalStore } from 'react';
import { getQueuedReports, subscribeReportQueue, type QueuedReport } from '@/lib/reportQueue';

/** The phone's reports, oldest first, re-rendering as they move through the queue. */
export function useReportQueue(): QueuedReport[] {
  return useSyncExternalStore(subscribeReportQueue, getQueuedReports, getQueuedReports);
}

export function useQueuedReport(clientEventId: string | null): QueuedReport | null {
  const all = useReportQueue();
  return clientEventId ? all.find((r) => r.submission.client_event_id === clientEventId) ?? null : null;
}
