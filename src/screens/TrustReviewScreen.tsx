import type { CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { AlertCard } from '@/components/AlertCard';
import type { Alert, Severity, VerificationLabel } from '@/api/types';

const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];
const VERIFICATIONS: VerificationLabel[] = [
  'official_confirmed',
  'corroborated_report',
  'unverified_report',
];

const VERIFICATION_LABELS: Record<VerificationLabel, string> = {
  official_confirmed: 'Official confirmed',
  corroborated_report: 'Corroborated report',
  unverified_report: 'Unverified report',
};

function makeAlert(severity: Severity, verification: VerificationLabel): Alert {
  return {
    alert_id: `dev-${verification}-${severity}`,
    event_id: `event-dev-${verification}-${severity}`,
    headline: `${severity.charAt(0).toUpperCase() + severity.slice(1)} ${VERIFICATION_LABELS[verification]}`,
    body: `Sample alert body for ${severity} severity with ${VERIFICATION_LABELS[verification].toLowerCase()} trust level.`,
    severity,
    location: { lat: 37.77, lon: -122.42, accuracy_m: 500, frame: 'WGS84' },
    affected_radius_km: 10,
    issued_at: new Date(Date.now() - 15 * 60_000).toISOString(),
    expires_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    verification_label: verification,
    source_attribution:
      verification === 'official_confirmed'
        ? 'National Weather Service'
        : verification === 'corroborated_report'
          ? 'Confirmed by 4 nearby'
          : undefined,
  };
}

interface TrustReviewScreenProps {
  onBack: () => void;
}

export function TrustReviewScreen({ onBack }: TrustReviewScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();

  const styles: Record<string, CSSProperties> = {
    container: {
      height: '100%',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      backgroundColor: theme.bg.base,
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      padding: `${spacing.scale[2]}px ${r.gutter}px`,
      borderBottom: `1px solid ${theme.line.hairline}`,
      backgroundColor: theme.bg.raised,
      minHeight: spacing.minTapTarget + 8,
    },
    backBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: spacing.minTapTarget,
      minHeight: spacing.minTapTarget,
      background: 'none',
      border: 'none',
      color: theme.text.primary,
      cursor: 'pointer',
      padding: 0,
      marginRight: spacing.scale[2],
    },
    headerTitle: {
      ...r.heading,
      color: theme.text.primary,
      margin: 0,
      fontVariantNumeric: undefined,
    },
    section: {
      padding: `${r.sectionGap}px ${r.gutter}px 0`,
    },
    sectionTitle: {
      ...r.heading,
      color: theme.text.primary,
      margin: `0 0 ${spacing.scale[3]}px 0`,
      fontVariantNumeric: undefined,
    },
    cardGap: {
      display: 'flex',
      flexDirection: 'column',
      gap: spacing.scale[3],
      paddingBottom: r.sectionGap,
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack} aria-label="Go back">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" stroke={theme.text.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h2 style={styles.headerTitle}>Trust treatments</h2>
      </div>

      {VERIFICATIONS.map((v) => (
        <div key={v} style={styles.section}>
          <h3 style={styles.sectionTitle}>{VERIFICATION_LABELS[v]}</h3>
          <div style={styles.cardGap}>
            {SEVERITIES.map((s) => (
              <AlertCard key={`${v}-${s}`} alert={makeAlert(s, v)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
