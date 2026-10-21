import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { displayHeadline } from './alerts';

test('Chinese weather offices: the warning comes first, not the office', () => {
  assert.equal(
    displayHeadline('Shibing County Meteorological Observatory issues a yellow lightning warning [Level III/Heavy]'),
    'Yellow lightning warning [Level III/Heavy]',
  );
  assert.equal(
    displayHeadline('Cengong Meteorological Station issued a yellow rainstorm warning [Level III/heavy]'),
    'Yellow rainstorm warning [Level III/heavy]',
  );
  assert.equal(
    displayHeadline('Ningyang County Meteorological Observatory Upgrades and Issues Orange Fog Warning Signal [Level II/Major]'),
    'Orange Fog Warning Signal [Level II/Major]',
  );
  assert.equal(
    displayHeadline('Shouxian Meteorological Observatory updates heavy fog red warning [Level I/Extremely Severe]'),
    'Heavy fog red warning [Level I/Extremely Severe]',
  );
});

test('lifted or cancelled warnings keep their whole headline', () => {
  const lifted = 'Heze Meteorological Observatory lifts blue warning signal for strong winds';
  assert.equal(displayHeadline(lifted), lifted);
});

test('other agencies are left alone', () => {
  assert.equal(displayHeadline('Coastal flood warning'), 'Coastal flood warning');
  assert.equal(displayHeadline('Red Rain Warning for Italy'), 'Red Rain Warning for Italy');
  assert.equal(displayHeadline('M 4.0 - Near S. Coast Of Honshu, Japan'), 'M 4.0 - Near S. Coast Of Honshu, Japan');
});
