// Offline Ask Moby, step 1: find the saved guidance that answers the question.
//
// The server uses embeddings + pgvector; on the phone we keep it light and predictable:
// a small BM25 keyword ranker over the cards (title, when it applies, body), with
// hazard synonyms ("quake", "rising water") so everyday words find the right card.
// If nothing scores well enough we don't call the model at all: Moby says it has no
// saved guidance for that, instead of letting a small model improvise.

import type { GuidanceCard, HazardType } from '@/api/types';
import { contentWords } from './grounding';

export interface LocalSource {
  kind: 'guidance' | 'alert';
  id: string;
  title: string;
  publisher: string;
  url: string | null;
  text: string;
}

/** Words that point at a hazard, so the ranker can prefer that hazard's cards. */
const HAZARD_WORDS: Record<HazardType, string[]> = {
  flood: ['flood', 'flooding', 'flooded', 'water', 'river', 'rising', 'rain', 'flash', 'drown', 'creek', 'stream'],
  fire: ['fire', 'wildfire', 'smoke', 'burn', 'burning', 'flames', 'evacuate', 'ash', 'bushfire'],
  earthquake: ['earthquake', 'quake', 'shaking', 'shake', 'aftershock', 'tremor', 'tsunami'],
  storm: ['storm', 'hurricane', 'typhoon', 'cyclone', 'tornado', 'wind', 'lightning', 'thunder', 'hail'],
  landslide: ['landslide', 'mudslide', 'debris', 'slope', 'rockfall', 'mud'],
  other: [],
};

/** Crude stemming: enough that "flooded", "floods" and "flooding" meet. */
function stem(w: string): string {
  return w.replace(/(ings|ing|ed|es|s)$/, '') || w;
}

function terms(text: string): string[] {
  return [...contentWords(text)].map(stem);
}

export function detectHazard(question: string): HazardType | null {
  const words = new Set(terms(question));
  let best: HazardType | null = null;
  let bestHits = 0;
  for (const [hazard, list] of Object.entries(HAZARD_WORDS) as [HazardType, string[]][]) {
    const hits = list.filter((w) => words.has(stem(w))).length;
    if (hits > bestHits) {
      best = hazard;
      bestHits = hits;
    }
  }
  return best;
}

export function cardToSource(card: GuidanceCard): LocalSource {
  return {
    kind: 'guidance',
    id: card.card_id,
    title: card.title,
    publisher: card.source_name,
    url: card.source_url || null,
    text: [card.applies_when, card.body].filter(Boolean).join('\n'),
  };
}

export interface Ranked {
  source: LocalSource;
  score: number;
}

/**
 * The best-matching cards, best first. `minScore` is tuned on the built-in cards
 * (src/ondevice/retrieve.test.ts): on-topic questions score well above it,
 * off-topic ones ("who won the game?") below.
 */
export function rankCards(
  question: string,
  cards: GuidanceCard[],
  { limit = 3, minScore = 1.2, relativeCutoff = 0.65 } = {},
): Ranked[] {
  const q = [...new Set(terms(question))];
  if (q.length === 0 || cards.length === 0) return [];
  const hazard = detectHazard(question);
  const docs = cards.map((c) => {
    const words = terms(`${c.title} ${c.title} ${c.applies_when ?? ''} ${c.body}`);
    const tf = new Map<string, number>();
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { card: c, tf, len: words.length };
  });
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / docs.length;
  const df = new Map<string, number>();
  for (const t of q) df.set(t, docs.filter((d) => d.tf.has(t)).length);

  const k1 = 1.2;
  const b = 0.75;
  const ranked = docs.map((d) => {
    let score = 0;
    for (const t of q) {
      const f = d.tf.get(t) ?? 0;
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avgLen));
    }
    // A card for the hazard the question is about beats a generic one with similar words.
    if (score > 0 && hazard && d.card.hazard_type === hazard) score *= 1.5;
    return { source: cardToSource(d.card), score };
  });
  const sorted = ranked.filter((r) => r.score >= minScore).sort((a, b2) => b2.score - a.score);
  // A runner-up far behind the best match is usually about something else (the
  // "landslide" card for a question about smoke on the hills): leave it out.
  const best = sorted[0]?.score ?? 0;
  return sorted.filter((r) => r.score >= best * relativeCutoff).slice(0, limit);
}
