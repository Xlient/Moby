import { useState, useEffect, useCallback } from 'react';
import { api } from '@/api/client';
import type { GuidanceCard } from '@/api/types';
import { useOnlineStatus } from './useOnlineStatus';

const CACHE_KEY = 'cached-guidance-cards';
const CACHE_TS_KEY = 'cached-guidance-ts';
const STALE_DAYS = 90;

function getCachedCards(): { cards: GuidanceCard[]; cachedAt: string | null } {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const ts = localStorage.getItem(CACHE_TS_KEY);
    if (raw) return { cards: JSON.parse(raw) as GuidanceCard[], cachedAt: ts };
  } catch { /* ignore */ }
  return { cards: [], cachedAt: null };
}

function cacheCards(cards: GuidanceCard[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cards));
    localStorage.setItem(CACHE_TS_KEY, new Date().toISOString());
  } catch { /* quota */ }
}

export function useGuidanceCards(hazardType?: string) {
  const isOnline = useOnlineStatus();
  const [cards, setCards] = useState<GuidanceCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const isStale = cachedAt
    ? Date.now() - new Date(cachedAt).getTime() > STALE_DAYS * 86_400_000
    : false;

  const fetchCards = useCallback(async () => {
    if (!isOnline) {
      const cached = getCachedCards();
      setCards(cached.cards);
      setCachedAt(cached.cachedAt);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await api.getGuidanceCards({
        region: 'US',
        hazard_type: hazardType as 'flood' | undefined,
      });
      const list = data.cards ?? [];
      setCards(list);
      cacheCards(list);
      setCachedAt(new Date().toISOString());
      setError(null);
    } catch {
      const cached = getCachedCards();
      if (cached.cards.length > 0) {
        setCards(cached.cards);
        setCachedAt(cached.cachedAt);
      } else {
        setError('Could not load guidance cards.');
      }
    } finally {
      setLoading(false);
    }
  }, [isOnline, hazardType]);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  return { cards, loading, error, isStale, cachedAt, refetch: fetchCards };
}
