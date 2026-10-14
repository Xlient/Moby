import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  decodePacket, encodePacket, fromAlertRecord, meshKeyFromDigest, PACKET_BYTES, toSyncRecord,
  type MeshPacket,
} from './codec';

const minute = (iso: string) => Date.parse(iso) / 1000;

const report: MeshPacket = {
  kind: 'report',
  id: '0123456789abcdef',
  hazard: 'flood',
  severity: 'high',
  lat: 27.7172,
  lon: 85.324,
  time: minute('2026-10-14T09:30:00Z'),
  reporter: 'a1b2c3d4',
  hops: 3,
};

test('a packet fits a Bluetooth LE advertisement', () => {
  assert.equal(encodePacket(report).length, PACKET_BYTES);
  assert.ok(PACKET_BYTES <= 31 - 3 - 2 - 2, 'room for flags + field header + company id');
});

test('round trip: what one phone sends, the next decodes', () => {
  assert.deepEqual(decodePacket(encodePacket(report)), report);
  const alert: MeshPacket = { ...report, kind: 'alert', hazard: 'other', severity: 'critical', lat: -90, lon: -180, hops: 0 };
  assert.deepEqual(decodePacket(encodePacket(alert)), alert);
  const east: MeshPacket = { ...report, lat: 89.9999, lon: 179.9999 };
  assert.deepEqual(decodePacket(encodePacket(east)), east);
});

test('times travel at minute resolution', () => {
  const p = decodePacket(encodePacket({ ...report, time: report.time + 59 }))!;
  assert.equal(p.time, report.time);
});

test('other apps and corrupted packets are ignored, not crashed on', () => {
  const bytes = encodePacket(report);
  assert.equal(decodePacket(bytes.slice(0, 20)), null);
  const notOurs = bytes.slice();
  notOurs[0] = 0x00;
  assert.equal(decodePacket(notOurs), null);
  const futureVersion = bytes.slice();
  futureVersion[1] = (2 << 6) | (futureVersion[1]! & 0x3f);
  assert.equal(decodePacket(futureVersion), null);
  const badHazard = bytes.slice();
  badHazard[1] = (1 << 6) | (7 << 2);
  assert.equal(decodePacket(badHazard), null);
});

test('encoding refuses bad input', () => {
  assert.throws(() => encodePacket({ ...report, id: 'xyz' }));
  assert.throws(() => encodePacket({ ...report, reporter: 'A1B2C3D4' }));
  assert.throws(() => encodePacket({ ...report, lat: 91 }));
  assert.throws(() => encodePacket({ ...report, time: minute('2020-01-01T00:00:00Z') }));
});

test('the mesh key matches the API (moby/api/reports.py mesh_key)', () => {
  const digest = createHash('sha256').update('00000000-0000-4000-8000-000000000000').digest('hex');
  assert.equal(meshKeyFromDigest(digest), 'db8055e0e0307d5a');
});

test('the gateway upload record mirrors the packet', () => {
  assert.deepEqual(toSyncRecord(report), {
    event_id: '0123456789abcdef',
    hazard_type: 0,
    lat_e6: 27_717_200,
    lon_e6: 85_324_000,
    severity: 2,
    hop_count: 3,
    timestamp: report.time,
    reporter_hash: 'a1b2c3d4',
    relayed_by: [],
  });
});

test('official alerts from the API become broadcastable packets', () => {
  const p = fromAlertRecord({
    event_id: 'fedcba9876543210', hazard_type: 3, lat_e6: 14_599_512, lon_e6: 120_984_222,
    severity: 3, hop_count: 0, timestamp: report.time + 17, reporter_hash: '00000000',
  })!;
  assert.equal(p.kind, 'alert');
  assert.equal(p.hazard, 'storm');
  assert.equal(p.lat, 14.5995);
  assert.equal(p.time, report.time);
  assert.deepEqual(decodePacket(encodePacket(p)), p);
  assert.equal(fromAlertRecord({ ...toSyncRecord(report), hazard_type: 99 }), null);
});
