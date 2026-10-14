// Checks that keep the on-device model's answer tied to its sources. A port of
// moby/ai/grounding.py (the server's Ask Moby uses the same rules): a model may
// rephrase; it may not add facts or numbers. Keep the two in step.

const STOP = new Set(
  `a an and are as at be been but by can do does don't for from get go has have if in into
is it its keep make may more must no not of on or our out over own so some stay such than that the
their them then there these they this those through to up use very was we what when where which
while who will with you your yourself`.split(/\s+/),
);

export function norm(s: string): string {
  return s
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s'%-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/** Numbers as written, with decimal commas normalised ('2,5' == '2.5'). */
export function numbers(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));
}

/** Numbers in the output that aren't in the source (invented or changed). */
export function strayNumbers(output: string, source: string): string[] {
  const have = new Set(numbers(source));
  return [...new Set(numbers(output).filter((n) => !have.has(n)))].sort();
}

export function contentWords(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of norm(s).split(' ')) {
    const t = w.replace(/^['-]+|['-]+$/g, '');
    if (t.length > 2 && !STOP.has(t)) out.add(t);
  }
  return out;
}

/** Share of the output's content words that also appear in the source. */
export function support(output: string, source: string): number {
  const words = contentWords(output);
  const src = contentWords(source);
  let hit = 0;
  for (const w of words) if (src.has(w)) hit++;
  return hit / Math.max(1, words.size);
}
