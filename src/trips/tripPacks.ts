import { useSyncExternalStore } from 'react';
import type { GuidanceCard, TripBrief } from '@/api/types';
import type { EmergencyNumbers } from '@/data/emergencyNumbers';
import { kv } from '@/lib/storage';

// "Before you go" offline safety packs: the briefing as Moby returned it, plus the
// country's emergency numbers and the matching guidance cards, saved on the phone so the
// whole pack opens with no signal. Packs never refresh themselves: the screen always shows
// when one was saved and that it may be out of date. Nothing here leaves the phone.

const STORAGE_KEY = 'trip-packs';
export const MAX_PACKS = 5;

export interface TripPack {
  id: string;
  savedAt: string;
  /** e.g. "Phakding, Nepal" or "Dropped pin" */
  label: string;
  brief: TripBrief;
  emergency?: EmergencyNumbers;
  guidance: GuidanceCard[];
}

function read(): TripPack[] {
  try {
    const raw = kv.get(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TripPack[]) : [];
  } catch {
    return [];
  }
}

let packs: TripPack[] = read();
const listeners = new Set<() => void>();

function write(next: TripPack[]) {
  packs = next;
  try {
    kv.set(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage full or unavailable: keep the in-memory copy */
  }
  listeners.forEach((cb) => cb());
}

export function useTripPacks(): TripPack[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => packs,
    () => packs,
  );
}

/** Saves a pack (newest first); the same briefing saved again replaces its older copy. */
export function saveTripPack(pack: Omit<TripPack, 'id' | 'savedAt'>): TripPack {
  const saved: TripPack = {
    ...pack,
    id: `${pack.brief.generated_at}-${pack.brief.destination.lat}-${pack.brief.destination.lon}`,
    savedAt: new Date().toISOString(),
  };
  write([saved, ...packs.filter((p) => p.id !== saved.id)].slice(0, MAX_PACKS));
  return saved;
}

export function deleteTripPack(id: string) {
  write(packs.filter((p) => p.id !== id));
}
