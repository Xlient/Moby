import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { AppState } from 'react-native';
import { api, ApiRequestError } from '@/api/client';
import type { ReportAccepted, ReportSubmission } from '@/api/types';
import { kv } from './storage';
import { approximate, getPrivacySettings } from './privacySettings';

// Offline-first report queue (design system: "Must complete fully offline and show
// 'Queued — will send when you have signal.'").
//
// A report is saved on the phone first, then sent whenever there's a connection.
// client_event_id is generated here and is the server's idempotency key, so a retry
// after a dropped response can never create a duplicate report.

export type QueuedState = 'queued' | 'sending' | 'received' | 'rejected';

export interface QueuedReport {
  submission: ReportSubmission;
  state: QueuedState;
  attempts: number;
  /** Epoch ms before which we won't retry (backoff after transient failures). */
  nextAttemptAt: number;
  createdAt: string;
  sentAt?: string;
  /** Server response once received (status pending → fused as fusion runs). */
  accepted?: ReportAccepted;
  /** Why the server refused it (rejected) or the last transient error. */
  error?: string;
}

const STORAGE_KEY = 'report-queue-v1';
/** Received/rejected entries are kept for the "your reports" list, then trimmed. */
const KEEP_DONE = 30;

let items: QueuedReport[] = load();
const listeners = new Set<() => void>();
let flushing: Promise<void> | null = null;

function load(): QueuedReport[] {
  try {
    const raw = kv.get(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as QueuedReport[]) : [];
    // A send interrupted by the app closing is simply retried.
    return parsed.map((r) => (r.state === 'sending' ? { ...r, state: 'queued' } : r));
  } catch {
    return [];
  }
}

function save(next: QueuedReport[]): void {
  const active = next.filter((r) => r.state === 'queued' || r.state === 'sending');
  const done = next.filter((r) => r.state === 'received' || r.state === 'rejected').slice(-KEEP_DONE);
  items = [...done, ...active].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  try {
    kv.set(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage full: the in-memory queue still sends this session.
  }
  listeners.forEach((cb) => cb());
}

function update(id: string, patch: Partial<QueuedReport>): void {
  save(items.map((r) => (r.submission.client_event_id === id ? { ...r, ...patch } : r)));
}

export function newClientEventId(): string {
  return Crypto.randomUUID();
}

/**
 * Saves the report on the phone and tries to send it straight away.
 * capturedOffline: whether the phone had no connection when the report was made
 * (the fusion pipeline treats late-arriving offline reports differently).
 */
export function enqueueReport(
  submission: Omit<ReportSubmission, 'captured_offline'>,
  capturedOffline: boolean,
): QueuedReport {
  // "Approximate location in reports" (Settings → Privacy & data): round before it leaves the phone.
  const loc = submission.location;
  const location = getPrivacySettings().approximateReports && loc
    ? { ...loc, ...approximate(loc.lat, loc.lon), accuracy_m: Math.max(loc.accuracy_m ?? 0, 500) }
    : loc;
  const entry: QueuedReport = {
    submission: { ...submission, location, captured_offline: capturedOffline },
    state: 'queued',
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: new Date().toISOString(),
  };
  save([...items, entry]);
  void flushReportQueue();
  return entry;
}

/** 4xx other than 408/429 means the server will never accept this report as-is. */
function isPermanent(err: unknown): boolean {
  return err instanceof ApiRequestError && err.status >= 400 && err.status < 500 && ![408, 429].includes(err.status);
}

function backoffMs(attempts: number): number {
  return Math.min(15 * 60_000, 5_000 * 2 ** Math.min(attempts, 8));
}

async function sendOne(r: QueuedReport): Promise<void> {
  const id = r.submission.client_event_id;
  update(id, { state: 'sending' });
  try {
    const accepted = await api.submitReport(r.submission);
    update(id, { state: 'received', accepted, sentAt: new Date().toISOString(), error: undefined });
  } catch (err) {
    const attempts = r.attempts + 1;
    if (isPermanent(err)) {
      update(id, { state: 'rejected', attempts, error: (err as Error).message });
    } else {
      update(id, {
        state: 'queued',
        attempts,
        nextAttemptAt: Date.now() + backoffMs(attempts),
        error: err instanceof Error ? err.message : 'Network error',
      });
    }
  }
}

/** Sends every queued report that's due. Safe to call often; runs one pass at a time. */
export function flushReportQueue(force = false): Promise<void> {
  if (flushing) return flushing;
  const run = async () => {
    // Loop until nothing is due, so reports queued during a pass go out in the same run.
    for (;;) {
      const due = items.filter((r) => r.state === 'queued' && (force || r.nextAttemptAt <= Date.now()));
      if (due.length === 0) return;
      for (const r of due) await sendOne(r);
      force = false; // a failed send has its backoff set; don't retry it in a tight loop
    }
  };
  // Clear the guard in .finally, which always runs after this assignment. (Clearing it
  // inside run() would race: with nothing to await, run() finishes synchronously and
  // the assignment below would then leave a settled promise in `flushing` forever.)
  const p: Promise<void> = run().finally(() => {
    if (flushing === p) flushing = null;
  });
  flushing = p;
  return p;
}

/** Refreshes fusion status for received reports (pending → fused). */
export async function refreshReportStatuses(): Promise<void> {
  const pending = items.filter((r) => r.state === 'received' && r.accepted?.status === 'pending');
  for (const r of pending) {
    try {
      const accepted = await api.getReportStatus(r.submission.client_event_id);
      update(r.submission.client_event_id, { accepted });
    } catch {
      // Offline or server busy: try again next time.
    }
  }
}

export function getQueuedReports(): QueuedReport[] {
  return items;
}

export function subscribeReportQueue(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Send whenever a connection appears, the app comes to the foreground, or a backoff
// period ends. Registered once, at import.
NetInfo.addEventListener((state) => {
  if (state.isConnected) void flushReportQueue(true);
});
AppState.addEventListener('change', (s) => {
  if (s === 'active') void flushReportQueue();
});
setInterval(() => {
  if (items.some((r) => r.state === 'queued')) void flushReportQueue();
}, 30_000);
