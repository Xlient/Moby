import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_CARDS } from './fallbackCards';
import { guidanceSteps, splitSentences } from './steps';

const flood = FALLBACK_CARDS.find((c) => c.card_id === 'fallback-flood-warning')!;

test('the first sentence is the thing to do first', () => {
  assert.equal(guidanceSteps(flood.body).first, 'Find safe shelter right away.');
});

test('"Do not" sentences become don’t steps, word for word', () => {
  const { steps } = guidanceSteps(flood.body);
  assert.deepEqual(steps[0], { kind: 'dont', text: 'Do not walk, swim or drive through flood waters.' });
  assert.ok(steps.some((s) => s.kind === 'dont' && s.text.startsWith('Stay off bridges')));
  assert.ok(steps.some((s) => s.kind === 'do' && s.text.startsWith('Evacuate if told')));
});

test('a number with a unit becomes the key fact, once', () => {
  const { fact, steps } = guidanceSteps(flood.body);
  assert.match(fact ?? '', /^Just six inches of moving water/);
  assert.ok(!steps.some((s) => s.text === fact));
});

test('no sentence is lost or reworded', () => {
  for (const card of FALLBACK_CARDS) {
    const { first, steps, fact } = guidanceSteps(card.body);
    const all = [first, ...(fact ? [fact] : []), ...steps.map((s) => s.text)].sort();
    assert.deepEqual(all, [...splitSentences(card.body)].sort(), card.card_id);
    assert.equal(splitSentences(card.body).join(' '), card.body.trim().replace(/\s+/g, ' '), card.card_id);
  }
});

test('abbreviations do not split a sentence', () => {
  assert.deepEqual(splitSentences('Call the U.S. Coast Guard on channel 16. Stay with the boat.'), [
    'Call the U.S. Coast Guard on channel 16.',
    'Stay with the boat.',
  ]);
});

test('a body with no full stop is one step', () => {
  assert.deepEqual(guidanceSteps('Move to higher ground'), { first: 'Move to higher ground', steps: [], fact: undefined });
});

test('"Do not forget" is a reminder, not a don’t', () => {
  const { steps } = guidanceSteps('Go to an interior room. Do not forget pets if time allows. Never use an elevator.');
  assert.deepEqual(steps.map((s) => s.kind), ['do', 'dont']);
});
