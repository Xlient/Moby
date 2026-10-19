import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { formatAccuracy, formatCoords, formatUtcTime, helpMessage } from './helpMessage';

test('coordinates are written in full, five decimals', () => {
  assert.equal(formatCoords(27.7172, 85.324), '27.71720, 85.32400');
  assert.equal(formatCoords(-33.8688, -151.2093), '-33.86880, -151.20930');
});

test('accuracy reads as metres or kilometres, or not at all', () => {
  assert.equal(formatAccuracy(12.4), '±12 m');
  assert.equal(formatAccuracy(2500), '±2.5 km');
  assert.equal(formatAccuracy(null), null);
});

test('time is UTC so it means the same thing to whoever reads it', () => {
  assert.equal(formatUtcTime('2026-10-20T09:05:00+05:45'), '03:20 UTC');
});

test('the message has the location, its accuracy and time, and a map link', () => {
  const msg = helpMessage({ lat: 27.7172, lon: 85.324, accuracyM: 8, at: '2026-10-20T03:20:00Z' });
  assert.match(msg, /^I need help\./);
  assert.match(msg, /27\.71720, 85\.32400 \(±8 m\) at 03:20 UTC/);
  assert.match(msg, /openstreetmap\.org\/\?mlat=27\.71720&mlon=85\.32400/);
});

test('no accuracy: the message leaves it out rather than guessing', () => {
  const msg = helpMessage({ lat: 1, lon: 2, accuracyM: null, at: '2026-10-20T03:20:00Z' });
  assert.match(msg, /1\.00000, 2\.00000 at 03:20 UTC/);
});
