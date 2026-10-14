// Bluetooth mesh: the running service. Glues the radio (modules/moby-mesh), the relay
// rules (./relay) and the API (gateway uploads + alerts) together. One instance per app.
//
//   radio hears bytes ──decode──▶ relay.receive ──▶ saved on the phone
//   on every change: relay.broadcastSet ──encode──▶ radio.setBroadcast (radio rotates them)
//   when online:     relay.pendingUploads ──▶ POST /v1/mesh/sync ──▶ relay.markUploaded
//                    GET /v1/mesh/alerts ──▶ relay.addAlert (we become a source for offline phones)
//
// Background: a foreground service keeps Moby running (with a notification). Android
// pauses JS timers in the background, so nothing important depends on them: the radio
// rotates packets natively, and uploads/saves are triggered by events (a packet heard,
// the connection coming back) as well as by timers.

import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { MobyMesh, type RadioState } from '../../modules/moby-mesh';
import { api } from '@/api/client';
import type { MeshRecord } from '@/api/types';
import { kv } from '@/lib/storage';
import {
  decodePacket, encodePacket, fromAlertRecord, meshKeyFromDigest, roundCoord, toSyncRecord, type MeshPacket,
} from './codec';
import { MeshRelay, type MeshEntry, type ReceiveResult } from './relay';

const ENABLED_KEY = 'mesh-enabled-v1';
const RELAY_KEY = 'mesh-relay-v1';
const SECRET_KEY = 'mesh-secret-v1';
const HEADLINES_KEY = 'mesh-headlines-v1';

/** How long each packet is on the air before the next one replaces it. */
const BROADCAST_MS = 1_500;
/** Re-send the broadcast set this often in the foreground, so expired packets drop off. */
const REFRESH_EVERY_MS = 30_000;
const UPLOAD_EVERY_MS = 60_000;
const ALERTS_EVERY_MS = 10 * 60_000;
/** "Phones nearby" means we heard one in the last two minutes. */
const NEARBY_WINDOW_MS = 2 * 60_000;

export type MeshStatus =
  | 'off'
  | 'unsupported'       // iPhone (for now), web, Expo Go, no Bluetooth LE
  | 'needs_permission'
  | 'bluetooth_off'
  | 'running';

export interface MeshSnapshot {
  status: MeshStatus;
  /** False on phones that can only listen. */
  canAdvertise: boolean;
  /** Heard any Moby phone in the last two minutes. (We can't count phones: Android gives
   *  every advertisement a fresh random address, which is good for privacy.) */
  hearingNearby: boolean;
  carrying: number;
  waitingToUpload: number;
  uploaded: number;
  /** Official alerts received from nearby phones (or fetched by us as a gateway). */
  alerts: { entry: MeshEntry; headline?: string }[];
  lastHeardAt?: number;
  lastError?: string;
  log: string[];
}

let relay = loadRelay();
let status: MeshStatus = 'off';
let canAdvertise = false;
let lastHeardAt: number | undefined;
let lastError: string | undefined;
let uploadedCount = 0;
let location: { lat: number; lon: number } | null = null;
const headlines: Record<string, string> = loadJson(HEADLINES_KEY, {});
const log: string[] = [];
const listeners = new Set<() => void>();
let timers: ReturnType<typeof setInterval>[] = [];
let subscriptions: { remove(): void }[] = [];
let lastAlertsFetch = 0;
let lastGatewayPass = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = kv.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function loadRelay(): MeshRelay {
  return MeshRelay.fromJSON(loadJson<MeshEntry[]>(RELAY_KEY, []));
}

/** Saving on every packet would hammer storage; once a second is plenty. */
function scheduleSave(): void {
  // In the background timers are paused, so save straight away.
  if (AppState.currentState !== 'active') {
    saveNow();
    return;
  }
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 1_000);
}

function saveNow(): void {
  try {
    kv.set(RELAY_KEY, JSON.stringify(relay));
  } catch {
    // Storage full: the mesh keeps working in memory.
  }
}

/** Hands the radio everything worth repeating; it rotates through them by itself. */
function syncBroadcast(): void {
  if (!MobyMesh || !canAdvertise || status !== 'running') return;
  try {
    MobyMesh.setBroadcast(relay.broadcastSet().map((p) => Array.from(encodePacket(p))), BROADCAST_MS);
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }
}

function note(line: string): void {
  const stamp = new Date().toTimeString().slice(0, 8);
  log.unshift(`${stamp} ${line}`);
  log.length = Math.min(log.length, 50);
}

function emit(): void {
  listeners.forEach((cb) => cb());
}

export function subscribeMesh(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getMeshSnapshot(): MeshSnapshot {
  return {
    status,
    canAdvertise,
    hearingNearby: lastHeardAt !== undefined && Date.now() - lastHeardAt < NEARBY_WINDOW_MS,
    carrying: relay.all().length,
    waitingToUpload: relay.pendingUploads().length,
    uploaded: uploadedCount,
    alerts: relay.alerts().map((entry) => ({ entry, headline: headlines[entry.packet.id] })),
    lastHeardAt,
    lastError,
    log: [...log],
  };
}

// ── Setting ──────────────────────────────────────────────────────────

export function isMeshAvailable(): boolean {
  return Platform.OS === 'android' && MobyMesh != null;
}

export function isMeshEnabled(): boolean {
  return kv.get(ENABLED_KEY) === '1';
}

export async function setMeshEnabled(on: boolean): Promise<MeshStatus> {
  kv.set(ENABLED_KEY, on ? '1' : '0');
  if (on) return startMesh();
  stopMesh();
  return status;
}

/** The gateway uses this to fetch alerts for where the phone is. */
export function setMeshLocation(lat: number, lon: number): void {
  location = { lat, lon };
}

// ── Identity ─────────────────────────────────────────────────────────

/** 4-byte reporter id for packets we make. Changes every day, so a phone can't be
 *  followed around by its broadcasts; within a day it lets the API cap one reporter. */
async function reporterId(): Promise<string> {
  let secret = kv.get(SECRET_KEY);
  if (!secret) {
    secret = Crypto.randomUUID();
    kv.set(SECRET_KEY, secret);
  }
  const day = new Date().toISOString().slice(0, 10);
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${secret}:${day}`);
  return digest.slice(0, 8);
}

function deviceId(): string {
  let id = kv.get('mesh-device-v1');
  if (!id) {
    id = Crypto.randomUUID();
    kv.set('mesh-device-v1', id);
  }
  return id;
}

// ── Reports out ──────────────────────────────────────────────────────

/**
 * Puts one of our own reports on the mesh (called by the report queue for reports made
 * with no signal). Only the structured fields travel; the note follows later, when
 * this phone itself reconnects and the queue sends the full report.
 */
export async function originateReport(r: {
  client_event_id: string;
  hazard_type: MeshPacket['hazard'];
  severity: MeshPacket['severity'];
  location?: { lat: number; lon: number } | null;
  observed_at: string;
}): Promise<void> {
  if (!isMeshEnabled() || !r.location) return;
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, r.client_event_id);
  relay.addOwn({
    kind: 'report',
    id: meshKeyFromDigest(digest),
    hazard: r.hazard_type,
    severity: r.severity,
    lat: roundCoord(r.location.lat),
    lon: roundCoord(r.location.lon),
    time: Math.floor(Date.parse(r.observed_at) / 60_000) * 60,
    reporter: await reporterId(),
    hops: 0,
  });
  note(`your report is on the mesh (${r.hazard_type}, ${r.severity})`);
  scheduleSave();
  syncBroadcast();
  emit();
}

// ── Radio ────────────────────────────────────────────────────────────

async function requestPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const wanted =
    Number(Platform.Version) >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  // Optional: shows the "sharing with nearby phones" notification while in the background.
  const optional = Number(Platform.Version) >= 33 ? [PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS] : [];
  const result = await PermissionsAndroid.requestMultiple([...wanted, ...optional]);
  return wanted.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

function onPacket(bytes: number[]): void {
  const packet = decodePacket(Uint8Array.from(bytes));
  if (!packet) return;
  lastHeardAt = Date.now();
  const result: ReceiveResult = relay.receive(packet);
  if (result === 'new') {
    note(`heard ${packet.kind} ${packet.hazard}/${packet.severity}, ${packet.hops} hop${packet.hops === 1 ? '' : 's'}`);
    scheduleSave();
    syncBroadcast();
    // Timers don't run in the background, so a new report is also the cue to upload it.
    if (packet.kind === 'report' && Date.now() - lastGatewayPass > UPLOAD_EVERY_MS) void gatewayPass();
  } else if (result !== 'duplicate') {
    note(`dropped a packet: ${result}`);
  }
  emit();
}

// ── Gateway ──────────────────────────────────────────────────────────

async function gatewayPass(): Promise<void> {
  lastGatewayPass = Date.now();
  const net = await NetInfo.fetch();
  if (!net.isConnected || net.isInternetReachable === false) return;

  const pending = relay.pendingUploads();
  if (pending.length > 0) {
    try {
      const res = await api.syncMeshRecords(deviceId(), pending.map(toSyncRecord));
      const done = [...(res.acknowledged ?? []), ...(res.rejected ?? []).map((r) => r.event_id ?? '')];
      relay.markUploaded(done);
      uploadedCount += res.acknowledged?.length ?? 0;
      note(`uploaded ${res.acknowledged?.length ?? 0} report(s) for nearby phones`);
      for (const r of res.rejected ?? []) note(`server refused ${r.event_id}: ${r.reason}`);
      scheduleSave();
    } catch (e) {
      lastError = `upload: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  if (location && Date.now() - lastAlertsFetch > ALERTS_EVERY_MS) {
    try {
      const res = (await api.getMeshAlerts(location.lat, location.lon)) as {
        records?: (MeshRecord & { headline?: string })[];
      };
      lastAlertsFetch = Date.now();
      let added = 0;
      for (const r of res.records ?? []) {
        const packet = fromAlertRecord(r);
        if (!packet) continue;
        if (r.headline) headlines[packet.id] = r.headline;
        const before = relay.all().length;
        relay.addAlert(packet);
        if (relay.all().length > before) added++;
      }
      if (added) note(`sharing ${added} official alert(s) with nearby phones`);
      syncBroadcast();
      kv.set(HEADLINES_KEY, JSON.stringify(headlines));
      scheduleSave();
    } catch (e) {
      lastError = `alerts: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  emit();
}

// ── Lifecycle ────────────────────────────────────────────────────────

export async function startMesh(): Promise<MeshStatus> {
  if (status === 'running') return status;
  if (!isMeshAvailable() || !MobyMesh) {
    status = 'unsupported';
    emit();
    return status;
  }
  if (!(await requestPermissions())) {
    status = 'needs_permission';
    emit();
    return status;
  }
  const radio: RadioState = MobyMesh.getState();
  if (!radio.supported) {
    status = 'unsupported';
  } else if (!radio.enabled) {
    status = 'bluetooth_off';
  } else {
    canAdvertise = radio.canAdvertise === true;
    subscriptions = [
      MobyMesh.addListener('onPacket', (e) => onPacket(e.bytes)),
      // The connection coming back is the cue to upload what we carry (works in the background).
      { remove: NetInfo.addEventListener((net) => {
        if (net.isConnected && net.isInternetReachable !== false && Date.now() - lastGatewayPass > 10_000) void gatewayPass();
      }) },
      MobyMesh.addListener('onStateChange', (e) => {
        // The module resumes the radio itself; we only keep the status honest.
        if (status === 'running' || status === 'bluetooth_off') {
          status = e.enabled ? 'running' : 'bluetooth_off';
          if (e.enabled) syncBroadcast();
          note(e.enabled ? 'Bluetooth back on: mesh resumed' : 'Bluetooth turned off: mesh paused');
          emit();
        }
      }),
      MobyMesh.addListener('onError', (e) => {
        lastError = `${e.where} failed (code ${e.code})`;
        note(lastError);
        emit();
      }),
    ];
    try {
      await MobyMesh.startScanning();
      timers = [
        setInterval(syncBroadcast, REFRESH_EVERY_MS),
        setInterval(() => void gatewayPass(), UPLOAD_EVERY_MS),
      ];
      status = 'running';
      syncBroadcast();
      if (!MobyMesh.setKeepRunning(true)) note('background mode unavailable: works while Moby is open');
      note(canAdvertise ? 'mesh on: listening and relaying' : 'mesh on: listening only (this phone cannot advertise)');
      void gatewayPass();
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      stopMesh();
      status = 'bluetooth_off';
    }
  }
  emit();
  return status;
}

export function stopMesh(): void {
  timers.forEach(clearInterval);
  timers = [];
  subscriptions.forEach((s) => s.remove());
  subscriptions = [];
  if (MobyMesh) {
    MobyMesh.stopScanning();
    MobyMesh.setBroadcast([], BROADCAST_MS);
    MobyMesh.setKeepRunning(false);
  }
  if (status === 'running') note('mesh off');
  status = 'off';
  lastHeardAt = undefined;
  emit();
}

/** Starts the mesh at app launch if the user turned it on before. */
export function resumeMeshIfEnabled(): void {
  if (isMeshEnabled() && isMeshAvailable()) void startMesh();
}

/** For the debug screen: forget everything this phone is carrying. */
export function clearMesh(): void {
  relay = new MeshRelay();
  kv.set(RELAY_KEY, '[]');
  syncBroadcast();
  emit();
}
