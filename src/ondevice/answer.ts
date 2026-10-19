// Offline Ask Moby, step 2: the prompt for NVIDIA Nemotron 3 Nano 4B, and the checks
// on what it says. Same rules as the server's Ask Moby (moby/ai/ask.py): answer only
// from the numbered sources, cite them, abstain otherwise; every number must appear in
// a cited source and most of the words too. If a check fails, the app shows "no
// answer" and the saved cards, never the unchecked text.
//
// No dependencies on React Native, so `npm run test:ondevice` runs it with plain Node.

import { strayNumbers, support } from './grounding';
import type { LocalSource } from './retrieve';

export const MAX_ANSWER_CHARS = 900;
export const MIN_ANSWER_SUPPORT = 0.5;

const RULES = `You are Moby, a hazard-safety assistant running on the user's phone with no internet.
Answer the question using ONLY the numbered sources.

Rules:
- If the sources don't answer it, return {"abstain": true}. Don't guess or use outside knowledge.
- Use only the sources that fit the question; ignore the others.
- At most 80 words, plain language, short steps. Cite the sources you use inline, like [1].
- Never say a place, route or action is safe, or that a danger has passed, unless a source says so.
- Only use numbers that appear in the sources. Don't give phone numbers (the app shows them).

Return ONLY JSON: {"answer": "...", "citations": [1], "abstain": false}`;

/** Forces the model's output into this shape (llama.rn turns it into a grammar). */
export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    citations: { type: 'array', items: { type: 'integer' } },
    abstain: { type: 'boolean' },
  },
  required: ['answer', 'citations', 'abstain'],
};

export function numbered(sources: LocalSource[]): string {
  const label = { alert: 'official alert', guidance: 'official guidance' } as const;
  return sources.map((s, i) => `[${i + 1}] (${label[s.kind]}) ${s.title} — ${s.publisher}\n${s.text}`).join('\n\n');
}

/**
 * The full prompt in the model's chat format (ChatML). The assistant turn starts with an
 * empty think block, which is how Nemotron 3 Nano's own chat template switches its
 * step-by-step reasoning off (`enable_thinking=False`): much faster on a phone.
 */
export function buildPrompt(question: string, sources: LocalSource[]): string {
  const q = question.replace(/<\|im_(start|end)\|>/g, '').trim();
  return (
    `<|im_start|>system\n${RULES}<|im_end|>\n` +
    `<|im_start|>user\nQuestion:\n<<<\n${q}\n>>>\n\nSources:\n${numbered(sources)}<|im_end|>\n` +
    `<|im_start|>assistant\n<think></think>`
  );
}

export interface ModelOutput {
  answer: string;
  citations: number[];
  abstain: boolean;
}

/** Tolerant: takes the first JSON object in the text; null if there isn't a usable one. */
export function parseOutput(text: string): ModelOutput | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(cleaned.slice(start, end + 1)) as Partial<ModelOutput>;
    return {
      answer: typeof raw.answer === 'string' ? raw.answer.trim() : '',
      citations: Array.isArray(raw.citations) ? raw.citations.filter((c): c is number => Number.isInteger(c)) : [],
      abstain: raw.abstain === true,
    };
  } catch {
    return null;
  }
}

/** Inline citations: [1], [1][2], and also [1, 2] / [1,2] (which must not read as "1.2"). */
const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

export function inlineCitations(answer: string): number[] {
  return [...answer.matchAll(CITATION)].flatMap((m) => m[1]!.split(',').map((n) => Number(n.trim())));
}

export function stripCitations(answer: string): string {
  return answer.replace(CITATION, '');
}

/** null if the answer is grounded in the sources it cites, else why not. */
export function check(out: ModelOutput, sources: LocalSource[]): string | null {
  if (out.abstain || !out.answer) return 'abstained';
  const valid = (c: number) => c >= 1 && c <= sources.length;
  const cited = new Set(out.citations.filter(valid));
  for (const c of inlineCitations(out.answer)) if (valid(c)) cited.add(c);
  if (cited.size === 0) return 'no valid citations';
  if (out.answer.length > MAX_ANSWER_CHARS) return 'answer too long';
  const text = stripCitations(out.answer);
  const citedText = [...cited].map((c) => `${sources[c - 1]!.title}\n${sources[c - 1]!.text}`).join('\n');
  const stray = strayNumbers(text, citedText);
  if (stray.length) return `numbers not in the sources: ${stray.join(', ')}`;
  if (support(text, citedText) < MIN_ANSWER_SUPPORT) return 'answer strays from its sources';
  out.citations = [...cited].sort((a, b) => a - b);
  return null;
}

export interface LocalAnswer {
  answer: string | null;
  abstained: boolean;
  /** Numbered as in the answer text. */
  sources: { n: number; kind: LocalSource['kind']; title: string; publisher: string; url: string | null }[];
  /** Why there's no answer, for the activity log (never shown as the answer). */
  withheld?: string;
}

export const NO_ANSWER: LocalAnswer = { answer: null, abstained: true, sources: [] };

/** Checks the model's raw text and renumbers citations to match the list the app shows. */
export function finish(rawText: string, sources: LocalSource[]): LocalAnswer {
  const out = parseOutput(rawText);
  if (!out) return { ...NO_ANSWER, withheld: 'no JSON in the output' };
  const problem = check(out, sources);
  if (problem) return { ...NO_ANSWER, withheld: problem };
  const renumber = new Map(out.citations.map((old, i) => [old, i + 1]));
  const text = out.answer
    .replace(CITATION, (_, list: string) =>
      list
        .split(',')
        .map((n) => renumber.get(Number(n.trim())))
        .filter((n): n is number => n !== undefined)
        .map((n) => `[${n}]`)
        .join(''),
    )
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
  return {
    answer: text,
    abstained: false,
    sources: out.citations.map((c, i) => {
      const s = sources[c - 1]!;
      return { n: i + 1, kind: s.kind, title: s.title.slice(0, 200), publisher: s.publisher, url: s.url };
    }),
  };
}
