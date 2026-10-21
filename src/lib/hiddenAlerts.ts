import type { CommunityReports } from '@/hooks/useAlertPreferences';

/** Alerts within the radius that the user's alert preferences hide, by reason. */
export interface HiddenAlerts {
  /** Community reports hidden by the "Reports from people nearby" choice. */
  reports: number;
  /** Everything else: hazard type, severity or marine. */
  other: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Why nearby alerts aren't shown, in words that point at the setting that hides them.
 * Null when nothing is hidden. Both settings live on Settings → Alert types.
 */
export function hiddenAlertsText(
  hidden: HiddenAlerts,
  radiusKm: number,
  communityReports: CommunityReports,
): string | null {
  const parts: string[] = [];
  if (hidden.other > 0) {
    parts.push(
      `${plural(hidden.other, 'other alert is', 'other alerts are')} active within ${radiusKm} km ` +
        'but not among the types or severity you chose.',
    );
  }
  if (hidden.reports > 0) {
    const reports = plural(hidden.reports, 'report', 'reports');
    parts.push(
      communityReports === 'off'
        ? `${reports} from people nearby ${hidden.reports === 1 ? 'is' : 'are'} hidden: you chose official warnings only.`
        : `${reports} from just one person nearby ${hidden.reports === 1 ? 'is' : 'are'} hidden: you see reports once 2 or more people agree.`,
    );
  }
  if (parts.length === 0) return null;
  return `${parts.join(' ')} Change what you see in Settings → Alert types.`;
}
