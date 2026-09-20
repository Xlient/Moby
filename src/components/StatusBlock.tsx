import type { CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import type { Alert } from '@/api/types';

interface StatusBlockProps {
  alerts: Alert[];
  loading: boolean;
  error: string | null;
  isOffline: boolean;
  cachedAt: string | null;
  locationAvailable: boolean;
}

function formatCheckedTime(cachedAt: string | null): string {
  if (!cachedAt) return '';
  const diff = Date.now() - new Date(cachedAt).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Checked just now';
  if (minutes < 60) return `Checked ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `Checked ${hours}h ago`;
}

function ClearIcon({ color }: { color: string }) {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="28" stroke={color} strokeWidth="3" fill="none" />
      <path
        d="M22 33l7 7 13-13"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function WarningIcon({ color }: { color: string }) {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path
        d="M32 8L4 56h56L32 8z"
        stroke={color}
        strokeWidth="3"
        fill="none"
        strokeLinejoin="round"
      />
      <line x1="32" y1="26" x2="32" y2="40" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="48" r="2" fill={color} />
    </svg>
  );
}

function OfflineIcon({ color }: { color: string }) {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="28" stroke={color} strokeWidth="3" fill="none" />
      <line x1="20" y1="32" x2="44" y2="32" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function LocationIcon({ color }: { color: string }) {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path
        d="M32 6C22.06 6 14 14.06 14 24c0 13.5 18 34 18 34s18-20.5 18-34c0-9.94-8.06-18-18-18z"
        stroke={color}
        strokeWidth="3"
        fill="none"
      />
      <circle cx="32" cy="24" r="7" stroke={color} strokeWidth="3" fill="none" />
      <line x1="12" y1="8" x2="52" y2="56" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function StatusBlock({
  alerts,
  loading,
  error,
  isOffline,
  cachedAt,
  locationAvailable,
}: StatusBlockProps) {
  const { theme } = useTheme();
  const r = useResponsive();

  const activeAlerts = alerts.filter(
    (a) => !a.expires_at || new Date(a.expires_at).getTime() > Date.now()
  );
  const highestSeverity = activeAlerts.length > 0
    ? (['critical', 'high', 'medium', 'low'] as const).find(
        (s) => activeAlerts.some((a) => a.severity === s)
      )
    : null;

  const styles: Record<string, CSSProperties> = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: `${r.sectionGap}px ${r.gutter}px`,
    },
    statusText: {
      ...r.title,
      color: theme.text.primary,
      margin: `${spacing.scale[3]}px 0 0 0`,
      fontVariantNumeric: undefined,
    },
    metaText: {
      ...typography.meta,
      color: theme.text.secondary,
      marginTop: spacing.scale[2],
    },
    errorText: {
      ...typography.body,
      color: theme.severity.critical,
      margin: `${spacing.scale[3]}px 0 0 0`,
      maxWidth: '70ch',
      fontVariantNumeric: undefined,
    },
    loadingDot: {
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      backgroundColor: theme.text.faint,
      margin: '0 4px',
    },
    loadingContainer: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: spacing.scale[3],
    },
  };

  if (loading) {
    return (
      <div style={styles.container} role="status" aria-label="Checking for alerts">
        <div style={styles.loadingContainer}>
          <span style={styles.loadingDot} />
          <span style={styles.loadingDot} />
          <span style={styles.loadingDot} />
        </div>
        <p style={{ ...styles.metaText, marginTop: spacing.scale[3] }}>
          Checking for alerts near you
        </p>
      </div>
    );
  }

  if (!locationAvailable) {
    return (
      <div style={styles.container} role="status">
        <LocationIcon color={theme.text.faint} />
        <p style={styles.statusText}>Location unavailable</p>
        <p style={styles.metaText}>
          Enable location access to check for alerts near you
        </p>
      </div>
    );
  }

  if (error && activeAlerts.length === 0) {
    return (
      <div style={styles.container} role="alert">
        <p style={styles.errorText}>{error}</p>
        <p style={styles.metaText}>
          Pull down to retry
        </p>
      </div>
    );
  }

  if (isOffline && activeAlerts.length === 0) {
    return (
      <div style={styles.container} role="status">
        <OfflineIcon color={theme.text.secondary} />
        <p style={styles.statusText}>No saved alerts</p>
        <p style={styles.metaText}>
          {cachedAt ? formatCheckedTime(cachedAt) : 'Connect to check for alerts'}
        </p>
      </div>
    );
  }

  if (activeAlerts.length === 0) {
    return (
      <div style={styles.container} role="status" aria-label="No active alerts near you">
        <ClearIcon color={theme.accent.calm} />
        <p style={styles.statusText}>No active alerts near you</p>
        <p style={styles.metaText}>{formatCheckedTime(cachedAt)}</p>
      </div>
    );
  }

  const severityColor = highestSeverity ? theme.severity[highestSeverity] : theme.severity.medium;

  return (
    <div style={styles.container} role="alert" aria-label={`${activeAlerts.length} active alert${activeAlerts.length > 1 ? 's' : ''} near you`}>
      <WarningIcon color={severityColor} />
      <p style={{ ...styles.statusText, color: severityColor }}>
        {activeAlerts.length} active alert{activeAlerts.length > 1 ? 's' : ''} near you
      </p>
      <p style={styles.metaText}>{formatCheckedTime(cachedAt)}</p>
    </div>
  );
}
