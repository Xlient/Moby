import { useMemo, useSyncExternalStore } from 'react';
import { api } from '@/api/client';
import type { GuidanceCard, HazardType, RegionCode } from '@/api/types';
import { kv } from '@/lib/storage';
import { FALLBACK_CARDS } from './fallbackCards';
import { GUIDANCE_REGIONS, guidanceRegionFor, mergeGuidance } from './regions';

// Offline guidance (plan v3 §8.1). Cards sync while connected and are read from the
// device with zero signal. The built-in fallback cards are always there, so the
// screen is never empty even before the first sync (or if the server has none).
// One bundle per region: the US one, plus the country the phone is in (e.g. CN) once
// it has synced there. A bundle stays saved after leaving, so it still works offline.

/** US keeps its original key, so phones that synced before regions keep their copy. */
const storageKey = (region: RegionCode) => (region === 'US' ? 'guidance-bundle' : `guidance-bundle-${region}`);

/** Shown as "last updated" when guidance is older than this. */
export const GUIDANCE_STALE_DAYS = 90;

interface StoredBundle {
  region: RegionCode;
  version: string;
  content_hash: string;
  synced_at: string;
  cards: GuidanceCard[];
}

type Stored = Partial<Record<RegionCode, StoredBundle>>;

function readStored(region: RegionCode): StoredBundle | null {
  try {
    const raw = kv.get(storageKey(region));
    return raw ? (JSON.parse(raw) as StoredBundle) : null;
  } catch {
    return null;
  }
}

let stored: Stored = Object.fromEntries(
  GUIDANCE_REGIONS.flatMap((r) => {
    const b = readStored(r);
    return b ? [[r, b]] : [];
  }),
);
const listeners = new Set<() => void>();

function setStored(next: StoredBundle) {
  stored = { ...stored, [next.region]: next };
  try {
    kv.set(storageKey(next.region), JSON.stringify(next));
  } catch {
    /* storage full or unavailable: keep the in-memory copy */
  }
  listeners.forEach((cb) => cb());
}

export interface GuidanceSnapshot {
  /** Synced cards plus the built-in ones: the local country's first, then most urgent first. */
  cards: GuidanceCard[];
  /** Version of the local (else US) synced bundle, if any. */
  version: string | null;
  syncedAt: string | null;
}

/** Guidance for a phone in `country` (ISO code from countryAt; undefined without a fix). */
export function useGuidance(country?: string): GuidanceSnapshot {
  const bundles = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => stored,
    () => stored,
  );
  const local = guidanceRegionFor(country);
  return useMemo(() => {
    const cards = mergeGuidance(
      Object.fromEntries(Object.entries(bundles).map(([r, b]) => [r, b?.cards ?? []])),
      FALLBACK_CARDS,
      local,
    );
    const shown = (local && bundles[local]) || bundles.US;
    return { cards, version: shown?.version ?? null, syncedAt: shown?.synced_at ?? null };
  }, [bundles, local]);
}

export function cardsForHazard(cards: GuidanceCard[], hazard: HazardType | undefined): GuidanceCard[] {
  return hazard ? cards.filter((c) => c.hazard_type === hazard) : cards;
}

const inFlight = new Map<RegionCode, Promise<void>>();

/**
 * Downloads a region's live bundle when its content_hash differs from the copy on the
 * device. Cheap when nothing changed (one small manifest request). Failures keep
 * the saved copy: guidance must never disappear because a sync failed.
 */
export function syncGuidance(region: RegionCode = 'US'): Promise<void> {
  const running = inFlight.get(region);
  if (running) return running;
  const p = (async () => {
    const manifest = await api.getGuidanceManifest(region);
    const live = manifest.bundles?.find((b) => b.region === region);
    if (!live) return; // nothing published: keep what we have (and the built-ins)
    if (stored[region]?.content_hash === live.content_hash) return;
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
    .catch((err) => console.warn(`Guidance sync (${region}) failed; keeping the saved copy`, err))
    .finally(() => {
      if (inFlight.get(region) === p) inFlight.delete(region);
    });
  inFlight.set(region, p);
  return p;
}

export function isGuidanceStale(card: GuidanceCard, now = Date.now()): boolean {
  return now - new Date(card.last_reviewed_at).getTime() > GUIDANCE_STALE_DAYS * 86_400_000;
}
