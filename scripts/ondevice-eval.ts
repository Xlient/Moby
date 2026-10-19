// Evaluates offline Ask Moby with the real model, on a laptop: the same retrieval, prompt
// and checks as the app (src/ondevice/*), with llama.cpp's server standing in for
// llama.rn on the phone.
//
//   llama-server -m nemotron-3-nano-4b-q4_k_m.gguf -c 2048 --port 8090
//   node --import ./scripts/ts-test-hooks.mjs scripts/ondevice-eval.ts
//
// Prints each question, the answer (or why it was withheld) and timings. Speeds on a
// laptop are much higher than on a phone; use this for answer quality, not speed.

import { FALLBACK_CARDS } from '../src/guidance/fallbackCards';
import { ANSWER_SCHEMA, buildPrompt, finish } from '../src/ondevice/answer';
import { rankCards } from '../src/ondevice/retrieve';

const SERVER = process.env.LLAMA_SERVER ?? 'http://127.0.0.1:8090';
const MAX_SOURCES = 3;
const MAX_SOURCE_CHARS = 500;

// 'either': withholding is also a good outcome (the user then sees the saved cards).
const QUESTIONS: { q: string; expect: 'answer' | 'none' | 'either' }[] = [
  { q: 'The river is rising fast near our hotel. What should we do?', expect: 'answer' },
  { q: 'My car is stuck and water is coming in', expect: 'answer' },
  { q: 'The ground is shaking, what do I do?', expect: 'answer' },
  { q: 'What should I do after an earthquake?', expect: 'answer' },
  { q: 'A tornado warning was just issued and we are in a car', expect: 'answer' },
  { q: 'There is smoke coming toward us from the hills', expect: 'answer' },
  { q: 'Is it safe to drive through 30 cm of moving water?', expect: 'either' },
  { q: 'How many days of water should I store?', expect: 'none' },
  { q: 'Who won the football game last night?', expect: 'none' },
  { q: 'Write me a poem about the sea', expect: 'none' },
];

async function complete(prompt: string): Promise<{ text: string; ms: number; promptTokens: number; genTokens: number }> {
  const t0 = Date.now();
  const res = await fetch(`${SERVER}/completion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt,
      n_predict: 220,
      temperature: 0,
      stop: ['<|im_end|>'],
      json_schema: ANSWER_SCHEMA,
      cache_prompt: false,
    }),
  });
  const body = (await res.json()) as { content: string; timings?: { prompt_n: number; predicted_n: number } };
  return {
    text: body.content,
    ms: Date.now() - t0,
    promptTokens: body.timings?.prompt_n ?? 0,
    genTokens: body.timings?.predicted_n ?? 0,
  };
}

let ok = 0;
for (const { q, expect } of QUESTIONS) {
  const sources = rankCards(q, FALLBACK_CARDS, { limit: MAX_SOURCES }).map((r) => ({
    ...r.source,
    text: r.source.text.length > MAX_SOURCE_CHARS ? `${r.source.text.slice(0, MAX_SOURCE_CHARS)}…` : r.source.text,
  }));
  console.log(`\nQ: ${q}`);
  console.log(`   sources: ${sources.map((s) => s.title).join(' | ') || '(none: model not called)'}`);
  if (sources.length === 0) {
    const pass = expect !== 'answer';
    ok += Number(pass);
    console.log(`   → no answer (no saved guidance)   ${pass ? 'OK' : 'EXPECTED AN ANSWER'}`);
    continue;
  }
  const r = await complete(buildPrompt(q, sources));
  const out = finish(r.text, sources);
  const answered = !!out.answer;
  const pass = expect === 'either' || (expect === 'answer') === answered;
  ok += Number(pass);
  console.log(`   ${r.promptTokens} prompt + ${r.genTokens} generated tokens, ${r.ms} ms`);
  console.log(answered ? `   → ${out.answer}` : `   → withheld: ${out.withheld}   raw: ${r.text.slice(0, 160)}`);
  console.log(`   ${pass ? 'OK' : expect === 'answer' ? 'EXPECTED AN ANSWER' : 'EXPECTED NO ANSWER'}`);
}
console.log(`\n${ok}/${QUESTIONS.length} as expected`);
