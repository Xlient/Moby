import type { GuidanceCard, RegionCode } from '@/api/types';

// Which guidance bundles a phone keeps, and how they're merged. Plain TypeScript (no
// React) so `npm run test:guidance` can run it under node.

/** Countries the server publishes guidance bundles for (contract RegionCode). */
export const GUIDANCE_REGIONS: readonly RegionCode[] = ['US', 'CN'];

/** The bundle for the country the phone is in, if there is one. */
export function guidanceRegionFor(country: string | undefined): RegionCode | undefined {
  return GUIDANCE_REGIONS.find((r) => r === country);
}

/** US always (the reviewed baseline), plus the local country's bundle when it has one. */
export function regionsToSync(country: string | undefined): RegionCode[] {
  const local = guidanceRegionFor(country);
  return local && local !== 'US' ? ['US', local] : ['US'];
}

/**
 * Synced bundles plus the built-in cards, without duplicate ids. The local country's
 * agencies come first (that's whose instructions apply here), then the rest; within
 * each, most urgent first.
 */
export function mergeGuidance(
  bundles: Partial<Record<RegionCode, GuidanceCard[]>>,
  builtIn: GuidanceCard[],
  local?: RegionCode,
): GuidanceCard[] {
  const localIds = new Set((local ? bundles[local] : undefined)?.map((c) => c.card_id));
  const seen = new Set<string>();
  const cards: GuidanceCard[] = [];
  for (const c of [...Object.values(bundles).flatMap((b) => b ?? []), ...builtIn]) {
    if (seen.has(c.card_id)) continue;
    seen.add(c.card_id);
    cards.push(c);
  }
  return cards.sort(
    (a, b) =>
      Number(!localIds.has(a.card_id)) - Number(!localIds.has(b.card_id)) ||
      (a.priority ?? 50) - (b.priority ?? 50) ||
      Number(!!b.is_critical_fallback) - Number(!!a.is_critical_fallback) ||
      a.title.localeCompare(b.title),
  );
}
