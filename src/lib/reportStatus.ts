import type { QueuedReport } from './reportQueue';

export type ReportTone = 'waiting' | 'good' | 'problem';

export interface ReportStatus {
  title: string;
  detail: string;
  tone: ReportTone;
}

const TIER_TEXT = [
  'Shown, marked unverified, to people nearby who chose to see single reports.',
  'Others reported it too. People nearby who chose to are alerted, marked unverified.',
  'An official warning covers it too.',
] as const;

/**
 * Where one of the phone's reports is, in plain words: on the phone → received →
 * fused into an event by the pipeline (tier 0/1/2) or not processed.
 */
export function reportStatus(r: QueuedReport): ReportStatus {
  switch (r.state) {
    case 'queued':
      return {
        title: 'Saved on your phone',
        detail: r.attempts > 0 ? 'Will send when the connection allows.' : 'Sends when you have signal.',
        tone: 'waiting',
      };
    case 'sending':
      return { title: 'Sending…', detail: 'On its way.', tone: 'waiting' };
    case 'rejected':
      return { title: 'Not accepted', detail: r.error ?? 'The server couldn’t accept this report.', tone: 'problem' };
    case 'received':
      break;
  }
  const a = r.accepted;
  if (!a || a.status === 'pending') {
    return { title: 'Received', detail: 'Being checked against other reports and official sources.', tone: 'waiting' };
  }
  if (a.status === 'failed') {
    return { title: 'Couldn’t be processed', detail: 'It’s kept for reviewers, but won’t raise an alert on its own.', tone: 'problem' };
  }
  const tier = a.tier ?? 0;
  return {
    title: a.merged_into_existing ? 'Added to an existing report' : tier === 2 ? 'Matches an official warning' : 'Shared nearby',
    detail: TIER_TEXT[tier] ?? TIER_TEXT[0],
    tone: tier === 2 ? 'good' : 'waiting',
  };
}
