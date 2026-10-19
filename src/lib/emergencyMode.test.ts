import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Alert } from '@/api/types';
import { EMERGENCY_DISTANCE_KM, emergencyAlert, qualifiesForEmergency, type Candidate } from './emergencyMode';

const NOW = Date.parse('2026-10-20T12:00:00Z');

function candidate(over: Partial<Alert> = {}, distanceKm = 0): Candidate {
  const alert = {
    alert_id: 'a1',
    event_id: 'e1',
    headline: 'Flash Flood Warning',
    hazard_type: 'flood',
    severity: 'critical',
    verification_label: 'official_confirmed',
    issued_at: '2026-10-20T11:00:00Z',
    expires_at: '2026-10-20T18:00:00Z',
    ...over,
  } as Alert;
  return { alert, distanceKm };
}

test('an official high or critical warning you are inside opens emergency mode', () => {
  assert.equal(qualifiesForEmergency(candidate(), NOW), true);
  assert.equal(qualifiesForEmergency(candidate({ severity: 'high' }), NOW), true);
});

test('lower severities never take over the screen', () => {
  assert.equal(qualifiesForEmergency(candidate({ severity: 'medium' }), NOW), false);
  assert.equal(qualifiesForEmergency(candidate({ severity: 'low' }), NOW), false);
});

test('community reports never trigger it, however many people reported', () => {
  assert.equal(qualifiesForEmergency(candidate({ verification_label: 'corroborated_report' }), NOW), false);
  assert.equal(qualifiesForEmergency(candidate({ verification_label: 'unverified_report' }), NOW), false);
});

test('only inside the area or right next to it', () => {
  assert.equal(qualifiesForEmergency(candidate({}, EMERGENCY_DISTANCE_KM), NOW), true);
  assert.equal(qualifiesForEmergency(candidate({}, EMERGENCY_DISTANCE_KM + 0.1), NOW), false);
});

test('an expired warning does not', () => {
  assert.equal(qualifiesForEmergency(candidate({ expires_at: '2026-10-20T11:59:00Z' }), NOW), false);
  // No expiry given: still in force.
  assert.equal(qualifiesForEmergency(candidate({ expires_at: undefined }), NOW), true);
});

test('picks the most severe, then the newest', () => {
  const high = candidate({ alert_id: 'high', severity: 'high', issued_at: '2026-10-20T11:50:00Z' });
  const oldCritical = candidate({ alert_id: 'old', issued_at: '2026-10-20T09:00:00Z' });
  const newCritical = candidate({ alert_id: 'new', issued_at: '2026-10-20T11:00:00Z' });
  assert.equal(emergencyAlert([high, oldCritical, newCritical], NOW)?.alert.alert_id, 'new');
  assert.equal(emergencyAlert([candidate({ severity: 'medium' })], NOW), null);
  assert.equal(emergencyAlert([], NOW), null);
});
