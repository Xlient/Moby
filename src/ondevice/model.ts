// The on-device model: NVIDIA Nemotron 3 Nano 4B (Q4_K_M GGUF, from NVIDIA's own
// Hugging Face repo). Downloaded on request over Wi-Fi, never bundled with the app.
// See docs/ondevice-guide.md.

import NetInfo from '@react-native-community/netinfo';
import * as Device from 'expo-device';
import * as LegacyFS from 'expo-file-system/legacy';
import { Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { kv } from '@/lib/storage';

export const NANO_MODEL = {
  name: 'NVIDIA Nemotron 3 Nano 4B',
  license: 'NVIDIA Nemotron Open Model License',
  url: 'https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-4B-GGUF/resolve/main/NVIDIA-Nemotron3-Nano-4B-Q4_K_M.gguf',
  fileName: 'nemotron-3-nano-4b-q4_k_m.gguf',
  /** Exact size of the file (checked after download). */
  bytes: 2_837_072_864,
  /** sha256 published by Hugging Face for this file (x-linked-etag), for reference. */
  sha256: 'be5d9a656a51922f24f1f09a759cebb694e1f5d9728bf0ef9f8c972c5a0b5ef2',
  /** The model needs about 3 GB of memory while answering. Phones sold as "8 GB" report
   *  7–7.6 GiB; 6 GB phones would be squeezed and the app could be killed. */
  minRamBytes: 6.8 * 1024 ** 3,
  /** Keep this much disk free after the download. */
  spareDiskBytes: 1024 ** 3,
} as const;

export type ModelState =
  | { kind: 'unsupported'; reason: string }
  | { kind: 'not_downloaded' }
  | { kind: 'downloading'; received: number; total: number; paused: boolean }
  | { kind: 'ready'; path: string }
  | { kind: 'error'; message: string };

const DIR = `${LegacyFS.documentDirectory ?? ''}models/`;
const FINAL = `${DIR}${NANO_MODEL.fileName}`;
const PART = `${FINAL}.part`;
const RESUME_KEY = 'ondevice-model-resume-v1';

let state: ModelState = { kind: 'not_downloaded' };
let download: LegacyFS.DownloadResumable | null = null;
const listeners = new Set<() => void>();

function set(next: ModelState): void {
  state = next;
  listeners.forEach((cb) => cb());
}

export function subscribeModel(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getModelState(): ModelState {
  return state;
}

/** Why this phone can't run the model, or null if it can. */
export function unsupportedReason(): string | null {
  if (Platform.OS !== 'android') return 'Offline answers are on Android only for now.';
  if (!Device.isDevice) return 'Offline answers need a real phone (emulators are far too slow).';
  if ((Device.totalMemory ?? 0) < NANO_MODEL.minRamBytes) {
    return 'This phone has less than 8 GB of memory, which the offline model needs. Saved safety guidance still works offline.';
  }
  return null;
}

export function freeDiskBytes(): number {
  try {
    return Paths.availableDiskSpace;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Works out the current state from what's on disk. Call at startup. */
export async function refreshModelState(): Promise<ModelState> {
  const reason = unsupportedReason();
  if (reason) {
    set({ kind: 'unsupported', reason });
    return state;
  }
  if (state.kind === 'downloading') return state;
  const done = await LegacyFS.getInfoAsync(FINAL);
  if (done.exists && done.size === NANO_MODEL.bytes) {
    set({ kind: 'ready', path: FINAL });
  } else {
    const part = await LegacyFS.getInfoAsync(PART);
    set(
      part.exists && kv.get(RESUME_KEY)
        ? { kind: 'downloading', received: part.size, total: NANO_MODEL.bytes, paused: true }
        : { kind: 'not_downloaded' },
    );
  }
  return state;
}

export async function isOnWifi(): Promise<boolean> {
  const net = await NetInfo.fetch();
  return net.type === 'wifi' || net.type === 'ethernet';
}

function onProgress(p: LegacyFS.DownloadProgressData): void {
  set({
    kind: 'downloading',
    received: p.totalBytesWritten,
    total: p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : NANO_MODEL.bytes,
    paused: false,
  });
}

/** Starts (or resumes) the download. The caller checks Wi-Fi and asks the user first. */
export async function startDownload(): Promise<void> {
  if (unsupportedReason()) return;
  if (freeDiskBytes() < NANO_MODEL.bytes + NANO_MODEL.spareDiskBytes) {
    set({ kind: 'error', message: 'Not enough free space: the model needs about 3 GB, plus 1 GB to spare.' });
    return;
  }
  await LegacyFS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  const resume = kv.get(RESUME_KEY) ?? undefined;
  download = LegacyFS.createDownloadResumable(NANO_MODEL.url, PART, {}, onProgress, resume || undefined);
  set({ kind: 'downloading', received: state.kind === 'downloading' ? state.received : 0, total: NANO_MODEL.bytes, paused: false });
  try {
    const result = resume ? await download.resumeAsync() : await download.downloadAsync();
    if (!result) return; // paused
    const info = await LegacyFS.getInfoAsync(PART);
    if (!info.exists || info.size !== NANO_MODEL.bytes) {
      await LegacyFS.deleteAsync(PART, { idempotent: true });
      kv.set(RESUME_KEY, '');
      set({ kind: 'error', message: 'The download was incomplete. Please try again.' });
      return;
    }
    await LegacyFS.moveAsync({ from: PART, to: FINAL });
    kv.set(RESUME_KEY, '');
    set({ kind: 'ready', path: FINAL });
  } catch (e) {
    // Network dropped: keep what we have so the next try resumes.
    await saveResumeData();
    const received = state.kind === 'downloading' ? state.received : 0;
    set({ kind: 'downloading', received, total: NANO_MODEL.bytes, paused: true });
    if (__DEV__) console.log('model download paused:', e instanceof Error ? e.message : e);
  } finally {
    download = null;
  }
}

async function saveResumeData(): Promise<void> {
  try {
    const data = download?.savable();
    if (data?.resumeData) kv.set(RESUME_KEY, data.resumeData);
  } catch {
    // Nothing to save: the next try starts over.
  }
}

export async function pauseDownload(): Promise<void> {
  if (!download) return;
  try {
    await download.pauseAsync();
  } catch {
    // Already finished or failed.
  }
  await saveResumeData();
  if (state.kind === 'downloading') set({ ...state, paused: true });
}

export async function deleteModel(): Promise<void> {
  await pauseDownload();
  await LegacyFS.deleteAsync(FINAL, { idempotent: true });
  await LegacyFS.deleteAsync(PART, { idempotent: true });
  kv.set(RESUME_KEY, '');
  set(unsupportedReason() ? { kind: 'unsupported', reason: unsupportedReason()! } : { kind: 'not_downloaded' });
}
