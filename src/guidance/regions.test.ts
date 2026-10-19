import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GuidanceCard } from '@/api/types';
import { FALLBACK_CARDS } from './fallbackCards';
import { guidanceRegionFor, mergeGuidance, regionsToSync } from './regions';

const card = (card_id: string, priority: number, source_name = 'FEMA Ready.gov'): GuidanceCard => ({
  card_id,
  hazard_type: 'earthquake',
  title: card_id,
  body: 'Drop, cover and hold on until the shaking stops.',
  priority,
  source_name,
  source_url: 'https://www.ready.gov/earthquakes',
  last_reviewed_at: '2026-10-18T12:00:00Z',
  is_critical_fallback: false,
});

const MEM = 'Ministry of Emergency Management (China)';

test('syncs US always, plus the local bundle where the server has one', () => {
  assert.deepEqual(regionsToSync('CN'), ['US', 'CN']);
  assert.deepEqual(regionsToSync('US'), ['US']);
  assert.deepEqual(regionsToSync('NP'), ['US']); // no NP bundle yet
  assert.deepEqual(regionsToSync(undefined), ['US']); // no fix yet
  assert.equal(guidanceRegionFor('JP'), undefined);
});

test('in China, Chinese agencies come first, then US and built-in cards', () => {
  const merged = mergeGuidance(
    { US: [card('us-a', 5)], CN: [card('cn-b', 40, MEM), card('cn-a', 10, MEM)] },
    [card('fallback-x', 1)],
    'CN',
  );
  assert.deepEqual(
    merged.map((c) => c.card_id),
    ['cn-a', 'cn-b', 'fallback-x', 'us-a'],
  );
  assert.equal(merged[0]!.source_name, MEM);
});

test('outside China the saved CN cards stay, ordered by urgency', () => {
  const merged = mergeGuidance({ US: [card('us-a', 5)], CN: [card('cn-a', 10, MEM)] }, [], 'US');
  assert.deepEqual(
    merged.map((c) => c.card_id),
    ['us-a', 'cn-a'],
  );
});

test('synced cards replace built-ins with the same id; built-ins show before any sync', () => {
  const id = FALLBACK_CARDS[0]!.card_id;
  const merged = mergeGuidance({ US: [{ ...card(id, 3), title: 'Synced' }] }, FALLBACK_CARDS);
  assert.equal(merged.filter((c) => c.card_id === id).length, 1);
  assert.equal(merged.find((c) => c.card_id === id)!.title, 'Synced');
  assert.equal(mergeGuidance({}, FALLBACK_CARDS).length, FALLBACK_CARDS.length);
});
