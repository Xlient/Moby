import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { hiddenAlertsText } from './hiddenAlerts';

test('nothing hidden: nothing to say', () => {
  assert.equal(hiddenAlertsText({ reports: 0, other: 0 }, 10, 'corroborated'), null);
});

test('a single report hidden by the default says why, not "alert types"', () => {
  const text = hiddenAlertsText({ reports: 1, other: 0 }, 10, 'corroborated')!;
  assert.match(text, /^1 report from just one person nearby is hidden: you see reports once 2 or more people agree\./);
  assert.match(text, /Settings → Alert types\.$/);
});

test('official only: reports hidden by that choice', () => {
  assert.match(hiddenAlertsText({ reports: 2, other: 0 }, 10, 'off')!, /^2 reports from people nearby are hidden: you chose official warnings only\./);
});

test('types and severity are named as the reason for other alerts', () => {
  assert.match(
    hiddenAlertsText({ reports: 0, other: 3 }, 25, 'all')!,
    /^3 other alerts are active within 25 km but not among the types or severity you chose\./,
  );
});

test('both reasons, each once', () => {
  const text = hiddenAlertsText({ reports: 1, other: 1 }, 10, 'corroborated')!;
  assert.match(text, /1 other alert is active/);
  assert.match(text, /1 report from just one person/);
  assert.equal(text.match(/Settings → Alert types/g)!.length, 1);
});
