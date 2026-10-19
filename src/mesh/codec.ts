// Bluetooth mesh: the radio format (wire format v1).
//
// A packet is 24 bytes, sent as the manufacturer-specific data of a plain Bluetooth LE
// advertisement. Nearby phones only have to *listen*: no pairing, no connection.
// A legacy advertisement holds 31 bytes; 24 fits even when Android adds its 3-byte
// flags field (31 - 3 flags - 2 field header - 2 company id = 24).
//
//   byte  0      magic 0x4D ('M'), so we ignore other apps using the test company id
//   byte  1      version (2 bits) | kind (1 bit) | hazard (3 bits) | severity (2 bits)
//   bytes 2-9    id: 8 bytes. Reports: sha256(client_event_id)[:8]. Alerts: from the server.
//   bytes 10-12  latitude  × 1e4, signed 24-bit (about 11 m; rounding is also a privacy feature)
//   bytes 13-15  longitude × 1e4, signed 24-bit
//   bytes 16-18  minutes since 2024-01-01 UTC, unsigned 24-bit (good until 2055)
//   bytes 19-22  reporter: 4-byte id that rotates daily (00000000 for official alerts)
//   byte  23     hops travelled so far (0 = sent by the phone that made it)
//
// Free text never travels: it's too big, and it's the riskiest thing to relay. The
// reporter's own phone sends the full report when it reconnects (the API merges the two).
//
// This file has no dependencies so it can be unit-tested with plain Node
// (`npm run test:mesh`). Keep it in step with moby/api/mesh.py.

import type { MeshRecord } from '@/api/types';

/** Bluetooth SIG "reserved for testing" company id. Fine for a prototype; a release
 *  should use a registered id or a 128-bit service UUID (see docs/mesh-guide.md). */
export const COMPANY_ID = 0xffff;
export const MAGIC = 0x4d;
export const WIRE_VERSION = 1;
export const PACKET_BYTES = 24;
/** Phones stop relaying a packet after this many hops (the API rejects more). */
export const MAX_HOPS = 8;

// Order is the wire format: never reorder, only append (and the API must follow).
// 'sos' is not a hazard: it's a person asking for help (severity critical) or saying
// they're safe now (severity low). Phones from before it was added drop it as unknown.
export const HAZARDS = ['flood', 'fire', 'earthquake', 'storm', 'landslide', 'other', 'sos'] as const;
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type MeshHazard = (typeof HAZARDS)[number];
export type MeshSeverity = (typeof SEVERITIES)[number];

const EPOCH_2024_S = Date.UTC(2024, 0, 1) / 1000;
const INT24_MAX = 0x7fffff;

export interface MeshPacket {
  kind: 'report' | 'alert';
  /** 16 hex chars. */
  id: string;
  hazard: MeshHazard;
  severity: MeshSeverity;
  /** Degrees, rounded to 1e-4. */
  lat: number;
  lon: number;
  /** Unix seconds, rounded down to the minute. */
  time: number;
  /** 8 hex chars. */
  reporter: string;
  hops: number;
}

export class MeshCodecError extends Error {}

/** A call for help from the "I need help" screen. */
export function isSosHelp(p: Pick<MeshPacket, 'hazard' | 'severity'>): boolean {
  return p.hazard === 'sos' && p.severity === 'critical';
}

/** "I'm safe now", from the same sender (same daily reporter id) as their call for help. */
export function isSosSafe(p: Pick<MeshPacket, 'hazard' | 'severity'>): boolean {
  return p.hazard === 'sos' && p.severity === 'low';
}

/** The 8-byte mesh id of a report, from the hex sha256 of its client_event_id. */
export function meshKeyFromDigest(sha256Hex: string): string {
  return sha256Hex.slice(0, 16).toLowerCase();
}

export function roundCoord(deg: number): number {
  return Math.round(deg * 1e4) / 1e4;
}

function writeInt24(out: Uint8Array, at: number, v: number): void {
  const u = v < 0 ? v + 0x1000000 : v;
  out[at] = (u >> 16) & 0xff;
  out[at + 1] = (u >> 8) & 0xff;
  out[at + 2] = u & 0xff;
}

function readUint24(b: Uint8Array, at: number): number {
  return ((b[at] ?? 0) << 16) | ((b[at + 1] ?? 0) << 8) | (b[at + 2] ?? 0);
}

function readInt24(b: Uint8Array, at: number): number {
  const u = readUint24(b, at);
  return u & 0x800000 ? u - 0x1000000 : u;
}

function writeHex(out: Uint8Array, at: number, hex: string, bytes: number): void {
  if (!new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(hex)) {
    throw new MeshCodecError(`expected ${bytes * 2} lowercase hex chars, got "${hex}"`);
  }
  for (let i = 0; i < bytes; i++) out[at + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
}

function readHex(b: Uint8Array, at: number, bytes: number): string {
  let s = '';
  for (let i = 0; i < bytes; i++) s += (b[at + i] ?? 0).toString(16).padStart(2, '0');
  return s;
}

export function encodePacket(p: MeshPacket): Uint8Array {
  const hazard = HAZARDS.indexOf(p.hazard);
  const severity = SEVERITIES.indexOf(p.severity);
  if (hazard < 0) throw new MeshCodecError(`unknown hazard ${p.hazard}`);
  if (severity < 0) throw new MeshCodecError(`unknown severity ${p.severity}`);
  if (!(Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)) throw new MeshCodecError('bad location');
  if (!(p.hops >= 0 && p.hops <= 255)) throw new MeshCodecError('bad hop count');
  const minutes = Math.floor((p.time - EPOCH_2024_S) / 60);
  if (!(minutes >= 0 && minutes <= 0xffffff)) throw new MeshCodecError('time out of range');

  const out = new Uint8Array(PACKET_BYTES);
  out[0] = MAGIC;
  out[1] = (WIRE_VERSION << 6) | ((p.kind === 'alert' ? 1 : 0) << 5) | (hazard << 2) | severity;
  writeHex(out, 2, p.id, 8);
  // Clamp: 180.0000 × 1e4 = 1,800,000 fits easily in 24 bits; clamp only guards rounding.
  writeInt24(out, 10, Math.max(-INT24_MAX, Math.min(INT24_MAX, Math.round(p.lat * 1e4))));
  writeInt24(out, 13, Math.max(-INT24_MAX, Math.min(INT24_MAX, Math.round(p.lon * 1e4))));
  out[16] = (minutes >> 16) & 0xff;
  out[17] = (minutes >> 8) & 0xff;
  out[18] = minutes & 0xff;
  writeHex(out, 19, p.reporter, 4);
  out[23] = p.hops;
  return out;
}

/** Decodes a packet, or returns null for anything that isn't a Moby v1 packet
 *  (other apps share the test company id, and radios deliver garbage). */
export function decodePacket(b: Uint8Array): MeshPacket | null {
  if (b.length !== PACKET_BYTES || b[0] !== MAGIC) return null;
  const head = b[1] ?? 0;
  if (head >> 6 !== WIRE_VERSION) return null;
  const hazard = HAZARDS[(head >> 2) & 0b111];
  const severity = SEVERITIES[head & 0b11];
  if (!hazard || !severity) return null;
  const lat = readInt24(b, 10) / 1e4;
  const lon = readInt24(b, 13) / 1e4;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    kind: (head >> 5) & 1 ? 'alert' : 'report',
    id: readHex(b, 2, 8),
    hazard,
    severity,
    lat,
    lon,
    time: EPOCH_2024_S + readUint24(b, 16) * 60,
    reporter: readHex(b, 19, 4),
    hops: b[23] ?? 0,
  };
}

/** The JSON mirror the gateway uploads (POST /v1/mesh/sync). */
export function toSyncRecord(p: MeshPacket): MeshRecord {
  return {
    event_id: p.id,
    hazard_type: HAZARDS.indexOf(p.hazard),
    lat_e6: Math.round(p.lat * 1e6),
    lon_e6: Math.round(p.lon * 1e6),
    severity: SEVERITIES.indexOf(p.severity),
    hop_count: p.hops,
    timestamp: p.time,
    reporter_hash: p.reporter,
    relayed_by: [],
  };
}

/** An official alert from GET /v1/mesh/alerts, ready to broadcast. */
export function fromAlertRecord(r: MeshRecord): MeshPacket | null {
  const hazard = HAZARDS[r.hazard_type];
  const severity = SEVERITIES[r.severity];
  if (!hazard || !severity || !/^[0-9a-f]{16}$/.test(r.event_id)) return null;
  return {
    kind: 'alert',
    id: r.event_id,
    hazard,
    severity,
    lat: roundCoord(r.lat_e6 / 1e6),
    lon: roundCoord(r.lon_e6 / 1e6),
    time: Math.floor(r.timestamp / 60) * 60,
    reporter: '00000000',
    hops: 0,
  };
}
