import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { callFirstLine } from './callFirst';

const src = 'https://www.gov.uk/';

test('unknown country: local emergency number, never 911', () => {
  assert.equal(callFirstLine(undefined), 'In immediate danger? Call your local emergency number first.');
});

test('one general number', () => {
  assert.equal(callFirstLine({ country: 'US', name: 'United States', general: '911', source: src }), 'In immediate danger? Call 911 first.');
  assert.equal(callFirstLine({ country: 'ES', name: 'Spain', general: '112', source: src }), 'In immediate danger? Call 112 first.');
});

test('separate numbers are listed (China)', () => {
  const cn = { country: 'CN', name: 'China', ambulance: '120', fire: '119', police: '110', source: src };
  assert.equal(callFirstLine(cn), 'In immediate danger? Call first: ambulance 120, fire 119, police 110.');
});

test('shared ambulance and fire number is said once (Japan)', () => {
  const jp = { country: 'JP', name: 'Japan', ambulance: '119', fire: '119', police: '110', source: src };
  assert.equal(callFirstLine(jp), 'In immediate danger? Call first: ambulance and fire 119, police 110.');
});
