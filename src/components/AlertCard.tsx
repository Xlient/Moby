import type { CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
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
  const isUnverified = alert.verification_label === 'unverified_report';
  const isCorroborated = alert.verification_label === 'corroborated_report';
  const r = useResponsive();

  const styles: Record<string, CSSProperties> = {
    card: {
      position: 'relative',
      backgroundColor: isUnverified ? theme.bg.recessed : theme.bg.raised,
      border: isUnverified ? `1px solid ${theme.line.hairline}` : 'none',
      borderRadius: radius.card,
      boxShadow: isUnverified ? 'none' : theme.shadow,
      opacity: expired ? 0.5 : 1,
      cursor: onPress ? 'pointer' : 'default',
      overflow: 'hidden',
    },
    content: {
      padding: `${spacing.scale[2]}px ${r.cardPadding}px ${r.cardPadding}px ${isUnverified ? r.cardPadding : r.cardPadding + 3}px`,
    },
    headerRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.scale[1],
    },
    headline: {
      ...r.heading,
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
    trustRow: {
      display: 'flex',
      alignItems: 'center',
      marginTop: spacing.scale[2],
    },
    pill: {
      ...typography.label,
      display: 'inline-flex',
      alignItems: 'center',
      padding: `${spacing.scale[0]}px ${spacing.scale[2]}px`,
      borderRadius: radius.pill,
      fontVariantNumeric: undefined,
    },
    pillFilled: {
      backgroundColor: theme.text.primary,
      color: theme.bg.raised,
    },
    pillOutline: {
      backgroundColor: 'transparent',
      border: `1px solid ${theme.text.secondary}`,
      color: theme.text.secondary,
    },
    trustTextPlain: {
      ...typography.label,
      color: theme.text.secondary,
      fontVariantNumeric: undefined,
    },
    expiredBadge: {
      ...typography.label,
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

  const trustLabel = getTrustText(alert);

  function renderTrust() {
    if (isUnverified) {
      return (
        <span style={styles.trustTextPlain} aria-label={`Trust level: ${trustLabel}`}>
          {trustLabel}
        </span>
      );
    }
    if (isCorroborated) {
      return (
        <span
          style={{ ...styles.pill, ...styles.pillOutline }}
          aria-label={`Trust level: ${trustLabel}`}
        >
          {trustLabel}
        </span>
      );
    }
    return (
      <span
        style={{ ...styles.pill, ...styles.pillFilled }}
        aria-label={`Trust level: ${trustLabel}`}
      >
        {trustLabel}
      </span>
    );
  }

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

        <div style={styles.trustRow}>
          {renderTrust()}
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
