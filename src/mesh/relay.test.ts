import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decodePacket, encodePacket, MAX_HOPS, type MeshPacket } from './codec';
import { MeshRelay } from './relay';

const T0 = Date.parse('2026-10-14T09:30:00Z');
const HOUR = 3_600_000;

function clock() {
  let t = T0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

let n = 0;
function packet(over: Partial<MeshPacket> = {}): MeshPacket {
  n += 1;
  return {
    kind: 'report',
    id: n.toString(16).padStart(16, '0'),
    hazard: 'flood',
    severity: 'high',
    lat: 27.7172,
    lon: 85.324,
    time: T0 / 1000,
    reporter: 'a1b2c3d4',
    hops: 0,
    ...over,
  };
}

test('a packet heard twice is stored once (seen-cache)', () => {
  const relay = new MeshRelay({ now: clock().now });
  const p = packet({ hops: 2 });
  assert.equal(relay.receive(p), 'new');
  assert.equal(relay.receive({ ...p, hops: 4 }), 'duplicate');
  assert.equal(relay.all().length, 1);
  assert.equal(relay.all()[0]!.heardCount, 2);
});

test('the shortest path wins', () => {
  const relay = new MeshRelay({ now: clock().now });
  const p = packet({ hops: 5 });
  relay.receive(p);
  relay.receive({ ...p, hops: 1 });
  assert.equal(relay.nextBroadcast()!.hops, 2);
});

test('hop limit: stored for upload, but not repeated past MAX_HOPS', () => {
  const relay = new MeshRelay({ now: clock().now });
  const last = packet({ hops: MAX_HOPS });
  assert.equal(relay.receive(last), 'new');
  assert.equal(relay.nextBroadcast(), null);
  assert.equal(relay.pendingUploads().length, 1);
  assert.equal(relay.receive(packet({ hops: MAX_HOPS + 1 })), 'too_many_hops');
});

test('old packets are dropped', () => {
  const c = clock();
  const relay = new MeshRelay({ now: c.now });
  assert.equal(relay.receive(packet({ time: (T0 - 25 * HOUR) / 1000 })), 'stale');
  relay.receive(packet());
  c.advance(25 * HOUR);
  assert.equal(relay.nextBroadcast(), null);
  assert.equal(relay.all().length, 0);
});

test('one reporter cannot flood the mesh', () => {
  const relay = new MeshRelay({ now: clock().now, perReporterPerHour: 3 });
  const results = [1, 2, 3, 4].map(() => relay.receive(packet({ reporter: 'deadbeef' })));
  assert.deepEqual(results, ['new', 'new', 'new', 'rate_limited']);
  assert.equal(relay.receive(packet({ reporter: '0badf00d' })), 'new');
});

test('broadcast rotation: new packets go out first, alerts before reports, everything in turn', () => {
  const relay = new MeshRelay({ now: clock().now });
  const heard = packet({ hops: 1 });
  const alert = packet({ kind: 'alert', reporter: '00000000' });
  relay.receive(heard);
  relay.addAlert(alert);
  const own = packet({ reporter: '11111111' });
  relay.addOwn(own);
  const order = [1, 2, 3, 4, 5, 6].map(() => relay.nextBroadcast()!);
  assert.deepEqual(order.slice(0, 3).map((p) => p.id), [alert.id, own.id, heard.id]);
  assert.deepEqual(order.slice(3).map((p) => p.id).sort(), [alert.id, own.id, heard.id].sort());
  assert.equal(order.find((p) => p.id === heard.id)!.hops, 2);   // heard at 1, repeated at 2
  assert.equal(order.find((p) => p.id === own.id)!.hops, 0);     // our own report starts at 0
});

test('three phones in a line: A → B → C', () => {
  const c = clock();
  const [a, b, cc] = [new MeshRelay({ now: c.now }), new MeshRelay({ now: c.now }), new MeshRelay({ now: c.now })];
  const report = packet({ reporter: 'aaaaaaaa' });
  a.addOwn(report);
  const radio = (from: MeshRelay, to: MeshRelay) => {
    const p = from.nextBroadcast();
    if (p) to.receive(decodePacket(encodePacket(p))!);   // through the real wire format
  };
  radio(a, b);
  radio(b, cc);
  assert.equal(cc.pendingUploads()[0]!.id, report.id);
  assert.equal(cc.pendingUploads()[0]!.hops, 1);          // A→B is hop 0, B→C is hop 1
});

test('gateway hand-over: uploaded reports are not uploaded again', () => {
  const relay = new MeshRelay({ now: clock().now });
  const [p1, p2] = [packet(), packet()];
  relay.receive(p1);
  relay.receive(p2);
  relay.markUploaded([p1.id]);
  assert.deepEqual(relay.pendingUploads().map((p) => p.id), [p2.id]);
  assert.ok(relay.nextBroadcast(), 'uploaded reports are still repeated for phones further away');
});

test('alerts are listed for the offline phone, newest first, and never uploaded', () => {
  const relay = new MeshRelay({ now: clock().now });
  const older = packet({ kind: 'alert', time: T0 / 1000 - 600 });
  const newer = packet({ kind: 'alert' });
  relay.receive(older);
  relay.receive(newer);
  assert.deepEqual(relay.alerts().map((e) => e.packet.id), [newer.id, older.id]);
  assert.equal(relay.pendingUploads().length, 0);
});

test('memory is bounded, and our own reports are kept', () => {
  const relay = new MeshRelay({ now: clock().now, maxEntries: 5, perReporterPerHour: 100 });
  const own = packet({ reporter: '22222222' });
  relay.addOwn(own);
  for (let i = 0; i < 20; i++) relay.receive(packet());
  assert.equal(relay.all().length, 5);
  assert.ok(relay.all().some((e) => e.packet.id === own.id));
});

test('survives an app restart (JSON round trip)', () => {
  const c = clock();
  const relay = new MeshRelay({ now: c.now });
  relay.addOwn(packet());
  relay.receive(packet({ hops: 3 }));
  const restored = MeshRelay.fromJSON(JSON.parse(JSON.stringify(relay)), { now: c.now });
  assert.deepEqual(restored.all(), relay.all());
});

test('broadcast set for the radio: priorities, hop + 1, nothing past the limit', () => {
  const c = clock();
  const relay = new MeshRelay({ now: c.now });
  const old = packet({ hops: 2 });
  relay.receive(old);
  c.advance(60_000);
  const recent = packet({ hops: 0 });
  relay.receive(recent);
  relay.receive(packet({ hops: MAX_HOPS }));          // kept for upload, never repeated
  const alert = packet({ kind: 'alert' });
  relay.addAlert(alert);
  const own = packet({ reporter: '33333333' });
  relay.addOwn(own);
  const set = relay.broadcastSet();
  assert.deepEqual(set.map((p) => p.id), [alert.id, own.id, recent.id, old.id]);
  assert.deepEqual(set.map((p) => p.hops), [0, 0, 1, 3]);
  assert.equal(relay.broadcastSet(2).length, 2);
});
