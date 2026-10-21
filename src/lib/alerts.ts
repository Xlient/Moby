import type { Alert, HazardType, ObservedEffect, Severity } from '@/api/types';

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function severityLabel(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

/** MaterialCommunityIcons names (home redesign spec v3, Part 1). */
const HAZARD_ICONS: Record<HazardType, string> = {
  flood: 'waves',
  fire: 'fire',
  earthquake: 'pulse',
  storm: 'weather-lightning-rainy',
  landslide: 'image-filter-hdr',
  other: 'alert-circle-outline',
};

export function hazardIcon(hazard: HazardType | undefined): string {
  return HAZARD_ICONS[hazard ?? 'other'];
}

/**
 * The trust text for a card. Always present, never truncated (design system §8).
 * Official: the agency. Community reports are never reviewed before people see them,
 * so they always say "Unverified" and how many different people reported it.
 */
export function trustText(alert: Alert): string {
  const disagree = alert.reports_disagree ? ' · reports disagree' : '';
  switch (alert.verification_label) {
    case 'official_confirmed':
      return alert.source_attribution ?? 'Official source';
    case 'corroborated_report':
      return alert.corroboration_count
        ? `Unverified · ${alert.corroboration_count} people reported${disagree}`
        : `Unverified · several people reported${disagree}`;
    case 'unverified_report':
      return `Unverified · 1 report${disagree}`;
  }
}

export function formatTimeAgo(isoDate: string, now: number = Date.now()): string {
  const minutes = Math.floor((now - new Date(isoDate).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function isExpired(alert: Alert, now: number = Date.now()): boolean {
  return !!alert.expires_at && new Date(alert.expires_at).getTime() <= now;
}

/** Highest severity first; newest first within a severity. */
export function compareAlerts(a: Alert, b: Alert): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  return new Date(b.issued_at).getTime() - new Date(a.issued_at).getTime();
}

/**
 * Map pin outline per severity, in a 24×24 box. Shape carries severity alongside
 * color (design system §7): circle, triangle, square, diamond.
 */
export function pinPath(severity: Severity): string {
  switch (severity) {
    case 'critical':
      return 'M12 2L22 12L12 22L2 12Z';
    case 'high':
      return 'M3 3h18v18H3z';
    case 'medium':
      return 'M12 3L2 21h20Z';
    case 'low':
      return 'M12 21a9 9 0 110-18 9 9 0 010 18z';
  }
}

const EFFECT_LABELS: Record<ObservedEffect, string> = {
  rising_water: 'Rising water',
  smoke_or_fire_visible: 'Smoke or flames',
  ground_shaking: 'Shaking',
  blocked_road: 'Blocked road or trail',
  structural_damage: 'Damage to buildings',
  other: 'Other observation',
};

export function effectLabel(effect: ObservedEffect | undefined): string {
  return effect ? EFFECT_LABELS[effect] : 'No details given';
}

/** "At the spot" / "200 m away" / "1.2 km away", from a distance already rounded to 100 m. */
export function formatDistanceFromEvent(m: number): string {
  if (m < 100) return 'At the spot';
  if (m < 1000) return `${m} m away`;
  return `${(m / 1000).toFixed(1)} km away`;
}

// "Shibing County Meteorological Observatory issues a yellow lightning warning [Level III/Heavy]":
// Chinese weather offices start every headline with their own name, so a two-line card shows
// only "Shibing County Meteorological Ob…". The place is already on the card's location line.
// Lifted or cancelled warnings keep their full headline, so that meaning is never dropped.
const ISSUER_PREFIX =
  /^.+?\bMeteorological\s+(?:Observatory|Station|Bureau|Service|Cent(?:er|re))\s+(?:(?:upgrades|updates|issued|issues|releases)(?:\s+and\s+(?:issues|releases))?)\s+(?:an?\s+|the\s+)?/i;

/** The headline for a title: without the issuing office's name in front, when it has one. */
export function displayHeadline(headline: string): string {
  const rest = headline.replace(ISSUER_PREFIX, '');
  if (rest === headline || rest.length < 4) return headline;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
