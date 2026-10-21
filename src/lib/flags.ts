import type { ContentFlag } from '@/api/types';

// "This looks wrong" (server: moby/api/flags.py). Google Play asks for a way to report AI
// output and other people's content without leaving the app. A flag hides nothing by
// itself; local partners look at it in the console.

export type FlagKind = ContentFlag['kind'];
export type FlagReason = ContentFlag['reason'];

/** What's being flagged: stored content by its id, the rest by its text. */
export type FlagTarget =
  | { kind: 'explanation' | 'brief' | 'community_report'; targetId: string }
  | { kind: 'ask_answer' | 'trip_brief'; excerpt: string };

export const FLAG_REASONS: { value: FlagReason; label: string }[] = [
  { value: 'wrong', label: 'Wrong or misleading' },
  { value: 'harmful', label: 'Offensive or harmful' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Something else' },
];

/** Same limits as the server: longer excerpts are cut there anyway, notes are refused. */
export const EXCERPT_CHARS = 2000;
export const NOTE_CHARS = 500;

export function buildFlag(target: FlagTarget, reason: FlagReason, note?: string): ContentFlag {
  const trimmed = note?.trim().slice(0, NOTE_CHARS);
  return {
    kind: target.kind,
    reason,
    ...('targetId' in target ? { target_id: target.targetId } : { excerpt: target.excerpt.trim().slice(0, EXCERPT_CHARS) }),
    ...(trimmed ? { note: trimmed } : {}),
  };
}

/** What to tell someone whose flag didn't send. */
export function flagErrorMessage(status: number | undefined): string {
  if (status === 401) return 'Sign in to send this.';
  if (status === 429) return 'You’ve sent a lot of these just now. Please try again in a few minutes.';
  if (status === 404) return 'This has changed since you opened it. Close and reopen it, then try again.';
  return 'Couldn’t send that. Check your connection and try again.';
}
