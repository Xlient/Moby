import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { GuidanceCard } from '@/api/types';
import { useOnlineStatus } from './useOnlineStatus';
import { kv } from '@/lib/storage';

const CACHE_KEY = 'cached-guidance-cards';
const CACHE_TS_KEY = 'cached-guidance-ts';
const STALE_DAYS = 90;

function getPersistedCards(): { cards: GuidanceCard[]; cachedAt: string | null } {
  try {
    const raw = kv.get(CACHE_KEY);
    const ts = kv.get(CACHE_TS_KEY);
    if (raw) return { cards: JSON.parse(raw) as GuidanceCard[], cachedAt: ts };
  } catch { /* ignore */ }
  return { cards: [], cachedAt: null };
}

function persistCards(cards: GuidanceCard[]): void {
  try {
    kv.set(CACHE_KEY, JSON.stringify(cards));
    kv.set(CACHE_TS_KEY, new Date().toISOString());
  } catch { /* quota */ }
}

export function useGuidanceCards(hazardType?: string) {
  const isOnline = useOnlineStatus();
  const persisted = getPersistedCards();

  const query = useQuery({
    queryKey: ['guidance-cards', hazardType],
    queryFn: async () => {
      const data = await api.getGuidanceCards({
        region: 'US',
        hazard_type: hazardType as 'flood' | undefined,
      });
      const list = data.cards ?? [];
      persistCards(list);
      return list;
    },
    staleTime: 24 * 60 * 60_000,
    gcTime: 7 * 24 * 60 * 60_000,
    placeholderData: persisted.cards.length > 0 ? persisted.cards : undefined,
    enabled: isOnline,
  });

  const cards = query.data ?? persisted.cards;
  const cachedAt = query.dataUpdatedAt
    ? new Date(query.dataUpdatedAt).toISOString()
    : persisted.cachedAt;

  const isStale = cachedAt
    ? Date.now() - new Date(cachedAt).getTime() > STALE_DAYS * 86_400_000
    : false;

  return {
    cards,
    loading: query.isLoading && !query.isPlaceholderData,
    error: query.error && cards.length === 0
      ? 'Could not load guidance cards.'
      : null,
    isStale,
    cachedAt,
    refetch: query.refetch,
  };
}
