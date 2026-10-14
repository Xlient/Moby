// Bluetooth mesh: the relay rules ("gossip"), with no radio and no React.
//
// Every phone in the mesh does the same three things:
//   1. hear   – packets from nearby phones go through `receive()`. Duplicates, stale
//               packets, packets past the hop limit and floods from one reporter are dropped.
//   2. repeat – `nextBroadcast()` picks the next packet to advertise, round-robin, with
//               its hop count + 1. Fresh packets first; alerts and our own reports first.
//   3. hand over – reports wait in `pendingUploads()` until a phone with signal (a
//               gateway) uploads them; then `markUploaded()`.
//
// Time is injected (`now`) so the tests can fast-forward. See docs/mesh-guide.md.

import { MAX_HOPS, type MeshPacket } from './codec';

export type ReceiveResult = 'new' | 'duplicate' | 'stale' | 'too_many_hops' | 'rate_limited';

export interface MeshEntry {
  packet: MeshPacket;
  /** We made it (our own report) rather than heard it. */
  own: boolean;
  firstHeardAt: number;
  /** How many times nearby phones repeated it to us: a rough "how far has it spread". */
  heardCount: number;
  /** How many times we've broadcast it. */
  sentCount: number;
  /** Reports only: uploaded and acknowledged by the API. */
  uploaded: boolean;
}

export interface RelayOptions {
  now?: () => number;
  /** How long we keep repeating a report / an alert, from when it was made. */
  reportTtlMs?: number;
  alertTtlMs?: number;
  /** Most packets one phone keeps; oldest, already-uploaded ones go first. */
  maxEntries?: number;
  /** Most new reports we accept per reporter id per hour (flood protection). */
  perReporterPerHour?: number;
}

const HOUR = 3_600_000;

export class MeshRelay {
  private entries = new Map<string, MeshEntry>();
  private readonly now: () => number;
  private readonly reportTtlMs: number;
  private readonly alertTtlMs: number;
  private readonly maxEntries: number;
  private readonly perReporterPerHour: number;

  constructor(opts: RelayOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.reportTtlMs = opts.reportTtlMs ?? 24 * HOUR;
    this.alertTtlMs = opts.alertTtlMs ?? 12 * HOUR;
    this.maxEntries = opts.maxEntries ?? 200;
    this.perReporterPerHour = opts.perReporterPerHour ?? 10;
  }

  private ttl(p: MeshPacket): number {
    return p.kind === 'alert' ? this.alertTtlMs : this.reportTtlMs;
  }

  private isLive(p: MeshPacket): boolean {
    const age = this.now() - p.time * 1000;
    // A clock a few minutes fast on the sender's phone is normal; hours is not.
    return age < this.ttl(p) && age > -10 * 60_000;
  }

  /** A report this phone made (works with no signal at all). */
  addOwn(packet: MeshPacket): void {
    const existing = this.entries.get(packet.id);
    if (existing) {
      existing.own = true;
      return;
    }
    this.entries.set(packet.id, {
      packet: { ...packet, hops: 0 },
      own: true,
      firstHeardAt: this.now(),
      heardCount: 0,
      sentCount: 0,
      uploaded: false,
    });
    this.trim();
  }

  /** An official alert fetched by this phone as a gateway. */
  addAlert(packet: MeshPacket): void {
    if (this.entries.has(packet.id) || !this.isLive(packet)) return;
    this.entries.set(packet.id, {
      packet: { ...packet, kind: 'alert', hops: 0 },
      own: false,
      firstHeardAt: this.now(),
      heardCount: 0,
      sentCount: 0,
      uploaded: true, // alerts are never uploaded
    });
    this.trim();
  }

  /** A packet heard from a nearby phone. */
  receive(packet: MeshPacket): ReceiveResult {
    const existing = this.entries.get(packet.id);
    if (existing) {
      existing.heardCount += 1;
      // Keep the shortest path we've seen: fewer hops = more relaying left in it.
      if (packet.hops < existing.packet.hops) existing.packet = { ...existing.packet, hops: packet.hops };
      return 'duplicate';
    }
    if (!this.isLive(packet)) return 'stale';
    if (packet.hops > MAX_HOPS) return 'too_many_hops';
    if (packet.kind === 'report') {
      const since = this.now() - HOUR;
      let recent = 0;
      for (const e of this.entries.values()) {
        if (e.packet.kind === 'report' && e.packet.reporter === packet.reporter && e.firstHeardAt > since) recent++;
      }
      if (recent >= this.perReporterPerHour) return 'rate_limited';
    }
    this.entries.set(packet.id, {
      packet,
      own: false,
      firstHeardAt: this.now(),
      heardCount: 1,
      sentCount: 0,
      uploaded: false,
    });
    this.trim();
    return 'new';
  }

  /**
   * The next packet to advertise, already carrying hop count + 1 (or 0 for our own),
   * or null when there's nothing to repeat. Least-sent first, so a new packet goes out
   * right away; ties go to alerts, then our own reports, then the oldest. Because
   * sentCount goes up each time, everything takes its turn.
   */
  nextBroadcast(): MeshPacket | null {
    this.prune();
    const candidates = [...this.entries.values()].filter(
      (e) => this.isLive(e.packet) && (e.own || e.packet.hops + 1 <= MAX_HOPS),
    );
    if (candidates.length === 0) return null;
    const rank = (e: MeshEntry) => (e.packet.kind === 'alert' ? 0 : e.own ? 1 : 2);
    candidates.sort((a, b) => a.sentCount - b.sentCount || rank(a) - rank(b) || a.firstHeardAt - b.firstHeardAt);
    const pick = candidates[0]!;
    pick.sentCount += 1;
    return { ...pick.packet, hops: pick.own ? 0 : pick.packet.hops + 1 };
  }

  /** Reports waiting for a gateway (any phone with signal) to upload them. */
  pendingUploads(limit = 200): MeshPacket[] {
    return [...this.entries.values()]
      .filter((e) => e.packet.kind === 'report' && !e.uploaded && this.isLive(e.packet))
      .slice(0, limit)
      .map((e) => e.packet);
  }

  markUploaded(ids: Iterable<string>): void {
    for (const id of ids) {
      const e = this.entries.get(id);
      if (e) e.uploaded = true;
    }
  }

  /** Live official alerts, newest first, for the "from nearby phones" list. */
  alerts(): MeshEntry[] {
    return [...this.entries.values()]
      .filter((e) => e.packet.kind === 'alert' && this.isLive(e.packet))
      .sort((a, b) => b.packet.time - a.packet.time);
  }

  /** Everything this phone is carrying, for the debug screen. */
  all(): MeshEntry[] {
    return [...this.entries.values()];
  }

  prune(): void {
    for (const [id, e] of this.entries) {
      if (!this.isLive(e.packet)) this.entries.delete(id);
    }
  }

  private trim(): void {
    if (this.entries.size <= this.maxEntries) return;
    this.prune();
    // Drop what matters least first: uploaded reports, then the oldest heard.
    const order = [...this.entries.entries()].sort(
      ([, a], [, b]) => Number(b.uploaded) - Number(a.uploaded) || a.firstHeardAt - b.firstHeardAt,
    );
    for (const [id, e] of order) {
      if (this.entries.size <= this.maxEntries) break;
      if (!e.own) this.entries.delete(id);
    }
  }

  toJSON(): MeshEntry[] {
    return this.all();
  }

  static fromJSON(saved: MeshEntry[], opts: RelayOptions = {}): MeshRelay {
    const relay = new MeshRelay(opts);
    for (const e of saved) relay.entries.set(e.packet.id, e);
    relay.prune();
    return relay;
  }
}
