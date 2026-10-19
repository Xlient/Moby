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

import { MAX_HOPS, isSosHelp, isSosSafe, type MeshPacket } from './codec';

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
  /** How long we keep repeating a report / an alert / an SOS, from when it was made. */
  reportTtlMs?: number;
  alertTtlMs?: number;
  sosTtlMs?: number;
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
  private readonly sosTtlMs: number;
  private readonly maxEntries: number;
  private readonly perReporterPerHour: number;

  constructor(opts: RelayOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.reportTtlMs = opts.reportTtlMs ?? 24 * HOUR;
    this.alertTtlMs = opts.alertTtlMs ?? 12 * HOUR;
    // Long enough for someone hurt to be found; short enough that an old call doesn't
    // send people looking for someone who was rescued hours ago.
    this.sosTtlMs = opts.sosTtlMs ?? 6 * HOUR;
    this.maxEntries = opts.maxEntries ?? 200;
    this.perReporterPerHour = opts.perReporterPerHour ?? 10;
  }

  private ttl(p: MeshPacket): number {
    if (p.hazard === 'sos') return this.sosTtlMs;
    return p.kind === 'alert' ? this.alertTtlMs : this.reportTtlMs;
  }

  /** When this sender last said they're safe (unix s), if we've heard it. */
  private safeSince(reporter: string): number | undefined {
    let latest: number | undefined;
    for (const e of this.entries.values()) {
      if (isSosSafe(e.packet) && e.packet.reporter === reporter && this.isLive(e.packet)) {
        latest = Math.max(latest ?? 0, e.packet.time);
      }
    }
    return latest;
  }

  /** A call for help that its sender has since cancelled ("I'm safe"). */
  private isAnswered(p: MeshPacket): boolean {
    if (!isSosHelp(p)) return false;
    const safe = this.safeSince(p.reporter);
    return safe !== undefined && safe >= p.time;
  }

  /** What goes on the air first: calls for help, then official alerts, then our own, then the rest. */
  private rank(e: MeshEntry): number {
    if (e.packet.hazard === 'sos') return 0;
    if (e.packet.kind === 'alert') return 1;
    return e.own ? 2 : 3;
  }

  /** Worth repeating: live, hops left, and not a call for help its sender has cancelled. */
  private repeatable(e: MeshEntry): boolean {
    return this.isLive(e.packet) && (e.own || e.packet.hops + 1 <= MAX_HOPS) && !this.isAnswered(e.packet);
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
      // We're its first broadcaster, so it goes out at hop 0, like our own reports.
      own: true,
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
    const candidates = [...this.entries.values()].filter((e) => this.repeatable(e));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.sentCount - b.sentCount || this.rank(a) - this.rank(b) || a.firstHeardAt - b.firstHeardAt);
    const pick = candidates[0]!;
    pick.sentCount += 1;
    return { ...pick.packet, hops: pick.own ? 0 : pick.packet.hops + 1 };
  }

  /**
   * Everything worth repeating right now, ready to hand to the radio, which rotates
   * through it on its own (so it keeps going while the app is in the background, when
   * JavaScript timers are paused). Calls for help first, then alerts, then our own
   * reports, then the newest. Hop counts are already + 1 (0 for our own).
   */
  broadcastSet(limit = 20): MeshPacket[] {
    this.prune();
    return [...this.entries.values()]
      .filter((e) => this.repeatable(e))
      .sort((a, b) => this.rank(a) - this.rank(b) || b.firstHeardAt - a.firstHeardAt)
      .slice(0, limit)
      .map((e) => ({ ...e.packet, hops: e.own ? 0 : e.packet.hops + 1 }));
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

  /**
   * Calls for help from other phones, one per sender (their latest), newest first.
   * `safe` is set once the sender said they're safe. Nobody has checked any of them.
   */
  sosCalls(): { entry: MeshEntry; safe: boolean }[] {
    const latest = new Map<string, MeshEntry>();
    for (const e of this.entries.values()) {
      if (e.own || !isSosHelp(e.packet) || !this.isLive(e.packet)) continue;
      const seen = latest.get(e.packet.reporter);
      if (!seen || e.packet.time > seen.packet.time) latest.set(e.packet.reporter, e);
    }
    return [...latest.values()]
      .sort((a, b) => b.packet.time - a.packet.time)
      .map((entry) => ({ entry, safe: this.isAnswered(entry.packet) }));
  }

  /** Our own call for help while it's still going out (not cancelled, not expired). */
  ownSos(): MeshEntry | undefined {
    return [...this.entries.values()]
      .filter((e) => e.own && isSosHelp(e.packet) && this.isLive(e.packet) && !this.isAnswered(e.packet))
      .sort((a, b) => b.packet.time - a.packet.time)[0];
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
