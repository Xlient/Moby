import { useSyncExternalStore } from 'react';
import { api } from '@/api/client';
import type { GuidanceCard, HazardType, RegionCode } from '@/api/types';
import { kv } from '@/lib/storage';
import { FALLBACK_CARDS } from './fallbackCards';

// Offline guidance (plan v3 §8.1). Cards sync while connected and are read from the
// device with zero signal. The built-in fallback cards are always there, so the
// screen is never empty even before the first sync (or if the server has none).

const STORAGE_KEY = 'guidance-bundle';

/** Shown as "last updated" when guidance is older than this. */
export const GUIDANCE_STALE_DAYS = 90;

interface StoredBundle {
  region: RegionCode;
  version: string;
  content_hash: string;
  synced_at: string;
  cards: GuidanceCard[];
}

function readStored(): StoredBundle | null {
  try {
    const raw = kv.get(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredBundle) : null;
  } catch {
    return null;
  }
}

let stored: StoredBundle | null = readStored();
const listeners = new Set<() => void>();

function setStored(next: StoredBundle | null) {
  stored = next;
  try {
    kv.set(STORAGE_KEY, next ? JSON.stringify(next) : '');
  } catch {
    /* storage full or unavailable: keep the in-memory copy */
  }
  snapshot = build();
  listeners.forEach((cb) => cb());
}

export interface GuidanceSnapshot {
  /** Synced cards plus the built-in ones, most urgent first. */
  cards: GuidanceCard[];
  /** Version of the synced bundle, if any. */
  version: string | null;
  syncedAt: string | null;
}

function build(): GuidanceSnapshot {
  const synced = stored?.cards ?? [];
  const ids = new Set(synced.map((c) => c.card_id));
  const cards = [...synced, ...FALLBACK_CARDS.filter((c) => !ids.has(c.card_id))].sort(
    (a, b) =>
      (a.priority ?? 50) - (b.priority ?? 50) ||
      Number(!!b.is_critical_fallback) - Number(!!a.is_critical_fallback) ||
      a.title.localeCompare(b.title),
  );
  return { cards, version: stored?.version ?? null, syncedAt: stored?.synced_at ?? null };
}

let snapshot: GuidanceSnapshot = build();

export function useGuidance(): GuidanceSnapshot {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => snapshot,
  );
}

export function cardsForHazard(cards: GuidanceCard[], hazard: HazardType | undefined): GuidanceCard[] {
  return hazard ? cards.filter((c) => c.hazard_type === hazard) : cards;
}

let inFlight: Promise<void> | null = null;

/**
 * Downloads the live bundle when its content_hash differs from the copy on the
 * device. Cheap when nothing changed (one small manifest request). Failures keep
 * the saved copy: guidance must never disappear because a sync failed.
 */
export function syncGuidance(region: RegionCode = 'US'): Promise<void> {
  if (inFlight) return inFlight;
  const p = (async () => {
    const manifest = await api.getGuidanceManifest(region);
    const live = manifest.bundles?.find((b) => b.region === region);
    if (!live) return; // nothing published: keep what we have (and the built-ins)
    if (stored && stored.region === region && stored.content_hash === live.content_hash) return;
    const { cards } = await api.getGuidanceCards({ region, bundle_version: live.version });
    if (!cards?.length) return;
    setStored({
      region,
      version: live.version,
      content_hash: live.content_hash,
      synced_at: new Date().toISOString(),
      cards,
    });
  })()
    .catch((err) => console.warn('Guidance sync failed; keeping the saved copy', err))
    .finally(() => {
      if (inFlight === p) inFlight = null;
    });
  inFlight = p;
  return p;
}

export function isGuidanceStale(card: GuidanceCard, now = Date.now()): boolean {
  return now - new Date(card.last_reviewed_at).getTime() > GUIDANCE_STALE_DAYS * 86_400_000;
}
