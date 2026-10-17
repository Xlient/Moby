// The on-device model: NVIDIA Nemotron 3 Nano 4B (Q4_K_M GGUF, from NVIDIA's own
// Hugging Face repo). Downloaded on request over Wi-Fi, never bundled with the app.
// See docs/ondevice-guide.md.

import NetInfo from '@react-native-community/netinfo';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
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
const RESUME_KEY = 'ondevice-model-resume-v1'; // no longer read (the .part size is the resume point); cleared on delete
const KEEP_AWAKE_TAG = 'moby-model-download';

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
    const offset = await resumeOffset();
    set(
      offset
        ? { kind: 'downloading', received: Number(offset), total: NANO_MODEL.bytes, paused: true }
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

/**
 * Where to resume from: the size of the partial file. Android resumes by byte offset
 * (it requests "Range: bytes=N-" and appends to the .part file), so the file on disk is
 * the truth whatever stopped the download: Pause, the network dropping when the screen
 * turned off, or the app being closed. Only a Pause used to record a resume point, so any
 * other stop restarted 2.8 GB from zero.
 */
async function resumeOffset(): Promise<string | undefined> {
  const part = await LegacyFS.getInfoAsync(PART);
  return part.exists && part.size > 0 && part.size < NANO_MODEL.bytes ? String(part.size) : undefined;
}

/** Starts (or resumes) the download. The caller checks Wi-Fi and asks the user first. */
export async function startDownload(): Promise<void> {
  if (unsupportedReason()) return;
  if (freeDiskBytes() < NANO_MODEL.bytes + NANO_MODEL.spareDiskBytes) {
    set({ kind: 'error', message: 'Not enough free space: the model needs about 3 GB, plus 1 GB to spare.' });
    return;
  }
  await LegacyFS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  const resume = await resumeOffset();
  download = LegacyFS.createDownloadResumable(NANO_MODEL.url, PART, {}, onProgress, resume);
  set({ kind: 'downloading', received: resume ? Number(resume) : 0, total: NANO_MODEL.bytes, paused: false });
  // Keep the screen on while this screen is open: when it turns off, Android cuts the
  // app's network and the download stops (it now resumes from where it got to).
  await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
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
    // Network dropped (often: the screen turned off): the .part file keeps what arrived,
    // and the next try resumes from its size.
    const received = state.kind === 'downloading' ? state.received : 0;
    set({ kind: 'downloading', received, total: NANO_MODEL.bytes, paused: true });
    if (__DEV__) console.log('model download paused:', e instanceof Error ? e.message : e);
  } finally {
    download = null;
    deactivateKeepAwake(KEEP_AWAKE_TAG);
  }
}

export async function pauseDownload(): Promise<void> {
  if (!download) return;
  try {
    await download.pauseAsync();
  } catch {
    // Already finished or failed.
  }
  if (state.kind === 'downloading') set({ ...state, paused: true });
}

export async function deleteModel(): Promise<void> {
  await pauseDownload();
  await LegacyFS.deleteAsync(FINAL, { idempotent: true });
  await LegacyFS.deleteAsync(PART, { idempotent: true });
  kv.set(RESUME_KEY, '');
  set(unsupportedReason() ? { kind: 'unsupported', reason: unsupportedReason()! } : { kind: 'not_downloaded' });
}
