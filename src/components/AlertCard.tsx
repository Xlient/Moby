import type { CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import { TrustRule } from './TrustRule';
import { SeverityIndicator } from './SeverityIndicator';
import type { Alert } from '@/api/types';

interface AlertCardProps {
  alert: Alert;
  distanceKm?: number;
  onPress?: () => void;
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isExpired(alert: Alert): boolean {
  if (!alert.expires_at) return false;
  return new Date(alert.expires_at).getTime() < Date.now();
}

function getTrustText(alert: Alert): string {
  switch (alert.verification_label) {
    case 'official_confirmed':
      return alert.source_attribution ?? 'Official source';
    case 'corroborated_report':
      return alert.source_attribution ?? 'Confirmed by multiple people nearby';
    case 'unverified_report':
      return 'Unverified \u2014 single report';
  }
}

export function AlertCard({ alert, distanceKm, onPress }: AlertCardProps) {
  const { theme } = useTheme();
  const expired = isExpired(alert);
  const isOfficial = alert.verification_label === 'official_confirmed';
  const isUnverified = alert.verification_label === 'unverified_report';

  const cardBg = isUnverified ? theme.bg.base : theme.bg.raised;
  const cardBorder = isUnverified ? `1px solid ${theme.line.hairline}` : 'none';
  const opacity = expired ? 0.5 : 1;

  const styles: Record<string, CSSProperties> = {
    card: {
      position: 'relative',
      backgroundColor: cardBg,
      border: cardBorder,
      borderRadius: radius.card,
      padding: `0 0 0 0`,
      opacity,
      cursor: onPress ? 'pointer' : 'default',
      overflow: 'hidden',
    },
    sourceBand: {
      backgroundColor: theme.text.primary,
      padding: `${spacing.scale[1]}px ${spacing.alertCardPadding}px ${spacing.scale[1]}px ${spacing.alertCardPadding + 4}px`,
    },
    sourceBandText: {
      ...typography.micro,
      color: theme.bg.raised,
      fontVariantNumeric: undefined,
    },
    content: {
      padding: `${spacing.scale[2]}px ${spacing.alertCardPadding}px ${spacing.alertCardPadding}px ${spacing.alertCardPadding + 4}px`,
    },
    headerRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.scale[1],
    },
    headline: {
      ...typography.heading,
      color: theme.text.primary,
      margin: 0,
      fontVariantNumeric: undefined,
    },
    body: {
      ...typography.body,
      color: theme.text.primary,
      margin: `${spacing.scale[1]}px 0 0 0`,
      fontVariantNumeric: undefined,
      maxWidth: '70ch',
    },
    metaRow: {
      display: 'flex',
      alignItems: 'center',
      gap: spacing.scale[2],
      marginTop: spacing.scale[2],
    },
    metaText: {
      ...typography.meta,
      color: theme.text.secondary,
    },
    trustText: {
      ...typography.micro,
      color: theme.text.secondary,
      marginTop: spacing.scale[2],
      fontVariantNumeric: undefined,
    },
    expiredBadge: {
      ...typography.micro,
      color: theme.text.faint,
      fontVariantNumeric: undefined,
    },
    actions: {
      display: 'flex',
      borderTop: `1px solid ${theme.line.hairline}`,
      marginTop: spacing.scale[3],
    },
    actionBtn: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: spacing.minTapTarget,
      background: 'none',
      border: 'none',
      color: theme.text.primary,
      fontFamily: typography.body.fontFamily,
      fontSize: 15,
      fontWeight: 600,
      cursor: 'pointer',
    },
    actionDivider: {
      width: 1,
      backgroundColor: theme.line.hairline,
    },
  };

  const handleClick = () => onPress?.();
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPress?.();
    }
  };

  return (
    <div
      style={styles.card}
      role="article"
      aria-label={`${alert.verification_label === 'official_confirmed' ? 'Official' : alert.verification_label === 'corroborated_report' ? 'Corroborated' : 'Unverified'} ${alert.severity} alert: ${alert.headline}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={onPress ? 0 : undefined}
    >
      <TrustRule verification={alert.verification_label} severity={alert.severity} />

      {isOfficial && (
        <div style={styles.sourceBand}>
          <span style={styles.sourceBandText}>
            {alert.source_attribution ?? 'Official source'}
          </span>
        </div>
      )}

      <div style={styles.content}>
        <div style={styles.headerRow}>
          <SeverityIndicator severity={alert.severity} />
          {expired && <span style={styles.expiredBadge}>Expired</span>}
        </div>

        <h3 style={styles.headline}>{alert.headline}</h3>

        {alert.body && <p style={styles.body}>{alert.body}</p>}

        <div style={styles.metaRow}>
          {distanceKm !== undefined && (
            <span style={{ ...styles.metaText, fontVariantNumeric: 'tabular-nums' }}>
              {distanceKm.toFixed(1)} km
            </span>
          )}
          <span style={{ ...styles.metaText, fontVariantNumeric: 'tabular-nums' }}>
            {formatTimeAgo(alert.issued_at)}
          </span>
        </div>

        <div style={styles.trustText} aria-label={`Trust level: ${getTrustText(alert)}`}>
          {getTrustText(alert)}
        </div>
      </div>

      {onPress && (
        <div style={styles.actions}>
          <button
            style={styles.actionBtn}
            aria-label="View guidance for this alert"
            onClick={(e) => { e.stopPropagation(); onPress(); }}
          >
            What to do
          </button>
          <div style={styles.actionDivider} />
          <button
            style={styles.actionBtn}
            aria-label="View alert details"
            onClick={(e) => { e.stopPropagation(); onPress(); }}
          >
            Details
          </button>
        </div>
      )}
    </div>
  );
}
