// Runs NVIDIA Nemotron 3 Nano 4B on the phone with llama.rn (llama.cpp for React Native).
// One model in memory at a time, loaded on first use and released after a few idle
// minutes, so it doesn't hold ~3 GB of memory while Moby sits in the background.

import { initLlama, type LlamaContext } from 'llama.rn';
import { ANSWER_SCHEMA, buildPrompt, finish, NO_ANSWER, type LocalAnswer } from './answer';
import { getModelState } from './model';
import { rankCards, type LocalSource } from './retrieve';
import type { GuidanceCard } from '@/api/types';

/** Sources given to the model, and how much of each. Phones read prompts slowly
 *  (~50 tokens/s), so fewer, shorter sources mean a faster answer. */
const MAX_SOURCES = 3;
const MAX_SOURCE_CHARS = 500;
const MAX_ANSWER_TOKENS = 220;
const IDLE_RELEASE_MS = 3 * 60_000;

let context: LlamaContext | null = null;
let loading: Promise<LlamaContext> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function touch(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void releaseModel(), IDLE_RELEASE_MS);
}

/** Loads the model (5–10 s on a phone). Safe to call early, e.g. when Ask Moby opens offline. */
export function warmUp(): Promise<LlamaContext> {
  const s = getModelState();
  if (s.kind !== 'ready') return Promise.reject(new Error('model not downloaded'));
  if (context) {
    touch();
    return Promise.resolve(context);
  }
  loading ??= initLlama({
    model: s.path,
    n_ctx: 2048,
    n_batch: 256,
    // CPU only for now: GPU (OpenCL) support varies by phone and isn't worth a crash.
    n_gpu_layers: 0,
    use_mlock: false,
  })
    .then((ctx) => {
      context = ctx;
      touch();
      return ctx;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

export async function releaseModel(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const ctx = context;
  context = null;
  await ctx?.release().catch(() => {});
}

export interface LocalRun {
  /** The saved cards the answer may use: shown straight away, before the model finishes. */
  sources: LocalSource[];
  result: Promise<LocalAnswer>;
  stop: () => void;
}

/**
 * Answers from saved guidance only. Returns the matching cards immediately and the
 * model's checked answer later. No matching card → no model call, just "no answer".
 */
export function askOnDevice(question: string, cards: GuidanceCard[]): LocalRun {
  const sources = rankCards(question, cards, { limit: MAX_SOURCES }).map((r) => ({
    ...r.source,
    text: r.source.text.length > MAX_SOURCE_CHARS ? `${r.source.text.slice(0, MAX_SOURCE_CHARS)}…` : r.source.text,
  }));
  if (sources.length === 0) {
    return { sources, result: Promise.resolve({ ...NO_ANSWER, withheld: 'no saved guidance matches' }), stop: () => {} };
  }
  let stopped = false;
  const result = (async (): Promise<LocalAnswer> => {
    const ctx = await warmUp();
    if (stopped) return NO_ANSWER;
    const out = await ctx.completion({
      prompt: buildPrompt(question, sources),
      n_predict: MAX_ANSWER_TOKENS,
      temperature: 0,
      stop: ['<|im_end|>'],
      response_format: { type: 'json_schema', json_schema: { strict: true, schema: ANSWER_SCHEMA } },
    });
    touch();
    return finish(out.text, sources);
  })().catch((e: unknown) => ({ ...NO_ANSWER, withheld: e instanceof Error ? e.message : String(e) }));
  return {
    sources,
    result,
    stop: () => {
      stopped = true;
      void context?.stopCompletion();
    },
  };
}
