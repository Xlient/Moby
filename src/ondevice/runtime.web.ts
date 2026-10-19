// Web build: llama.rn is native-only (importing it crashes the web bundle at startup), and
// offline answers are Android-only anyway (model.ts unsupportedReason), so the model is
// never 'ready' here. Same API as runtime.ts; nothing ever runs.

import { NO_ANSWER, type LocalAnswer } from './answer';
import type { LocalSource } from './retrieve';
import type { GuidanceCard } from '@/api/types';

export function warmUp(): Promise<never> {
  return Promise.reject(new Error('offline answers are not available on the web'));
}

export async function releaseModel(): Promise<void> {}

export interface LocalRun {
  sources: LocalSource[];
  result: Promise<LocalAnswer>;
  stop: () => void;
}

export function askOnDevice(_question: string, _cards: GuidanceCard[]): LocalRun {
  return { sources: [], result: Promise.resolve({ ...NO_ANSWER, withheld: 'web' }), stop: () => {} };
}
