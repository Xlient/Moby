/**
 * Splits a guidance card's body into parts people can scan under stress: the first
 * thing to do, the rest as do / don't steps, and one key fact (a number worth
 * remembering, like "six inches of moving water"). Every sentence keeps the source's
 * exact wording: this only decides how each one is shown, never what it says.
 */

export type StepKind = 'do' | 'dont';

export interface GuidanceStep {
  kind: StepKind;
  text: string;
}

export interface GuidanceSteps {
  first: string;
  steps: GuidanceStep[];
  fact?: string;
}

// "Do not forget pets" is a reminder to do something: a cross beside it reads as a double negative.
const DONT = /^(do not|don[’']t|never|avoid|stay off|stay away)\b(?!\s+forget)/i;
// A number and a unit in the same sentence: the kind of fact worth pulling out.
const FACT =
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b[^.!?]*\b(inch(es)?|foot|feet|cm|centimet(er|re)s?|met(er|re)s?|km|miles?|minutes?|seconds?)\b/i;
// Ends a sentence: . ! or ? (plus any closing quote) before a space and a capital.
const BOUNDARY = /[.!?]["”’)]?\s+(?=["“‘(]?[A-Z0-9])/g;
// ...unless the word before is an abbreviation: "U.S.", "e.g.", "St."
const ABBREVIATION = /(\b([A-Za-z]\.){2,}|\b(e\.g|i\.e|etc|St|Mt|Dr|No|approx)\.)["”’)]?\s+$/;

export function splitSentences(body: string): string[] {
  const text = body.trim().replace(/\s+/g, ' ');
  const out: string[] = [];
  let start = 0;
  for (const m of text.matchAll(BOUNDARY)) {
    const end = m.index + m[0].length;
    if (ABBREVIATION.test(text.slice(start, end))) continue;
    out.push(text.slice(start, end).trim());
    start = end;
  }
  if (start < text.length) out.push(text.slice(start).trim());
  return out;
}

export function guidanceSteps(body: string): GuidanceSteps {
  const [first = '', ...rest] = splitSentences(body);
  let fact: string | undefined;
  const steps: GuidanceStep[] = [];
  for (const sentence of rest) {
    if (!fact && !DONT.test(sentence) && FACT.test(sentence)) {
      fact = sentence;
    } else {
      steps.push({ kind: DONT.test(sentence) ? 'dont' : 'do', text: sentence });
    }
  }
  return { first, steps, fact };
}
