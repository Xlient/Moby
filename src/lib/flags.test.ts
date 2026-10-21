import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildFlag, EXCERPT_CHARS, flagErrorMessage, NOTE_CHARS } from './flags';

test('stored content is flagged by id', () => {
  assert.deepEqual(buildFlag({ kind: 'explanation', targetId: 'e1' }, 'wrong'), {
    kind: 'explanation',
    reason: 'wrong',
    target_id: 'e1',
  });
});

test('unstored content carries its text, trimmed and capped', () => {
  const flag = buildFlag({ kind: 'ask_answer', excerpt: `  ${'a'.repeat(EXCERPT_CHARS + 50)}` }, 'harmful');
  assert.equal(flag.excerpt?.length, EXCERPT_CHARS);
  assert.equal(flag.target_id, undefined);
});

test('a blank note is left out; a long one is cut to the server limit', () => {
  assert.equal(buildFlag({ kind: 'brief', targetId: 'e1' }, 'other', '   ').note, undefined);
  assert.equal(buildFlag({ kind: 'brief', targetId: 'e1' }, 'other', 'n'.repeat(600)).note?.length, NOTE_CHARS);
});

test('errors say what to do', () => {
  assert.match(flagErrorMessage(401), /Sign in/);
  assert.match(flagErrorMessage(429), /few minutes/);
  assert.match(flagErrorMessage(undefined), /connection/);
});
