import { useState, type CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { StatusStrip } from '@/components/StatusStrip';
import { AlertCard } from '@/components/AlertCard';
import { AlertArrival } from '@/components/AlertArrival';
import { useAlerts } from '@/hooks/useAlerts';
import { useNewAlertIds } from '@/hooks/useNewAlertIds';
import { useSubscriptions } from '@/hooks/useSubscriptions';
import type { Alert } from '@/api/types';

interface HomeScreenProps {
  onAlertPress: (alertId: string) => void;
  onGuidancePress: () => void;
  onReportPress: () => void;
  onMapPress: () => void;
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getUpdatedMinutesAgo(cachedAt: string | null): number | null {
  if (!cachedAt) return null;
  return Math.floor((Date.now() - new Date(cachedAt).getTime()) / 60_000);
}

function getNearbyAlerts(alerts: Alert[]): Alert[] {
  return alerts.filter(
    (a) =>
      (a.verification_label === 'unverified_report' ||
        a.verification_label === 'corroborated_report') &&
      (!a.expires_at || new Date(a.expires_at).getTime() > Date.now())
  );
}

function getRecentAlerts(alerts: Alert[]): Alert[] {
  return alerts.filter(
    (a) => a.expires_at && new Date(a.expires_at).getTime() <= Date.now()
  );
}

export function HomeScreen({ onAlertPress, onGuidancePress, onReportPress, onMapPress }: HomeScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const [locationAvailable] = useState(true);

  const { subscriptions } = useSubscriptions();

  const { alerts, loading, error, isOffline, cachedAt } = useAlerts(37.7749, -122.4194, 50);

  const activeAlerts = alerts.filter(
    (a) =>
      a.verification_label === 'official_confirmed' &&
      (!a.expires_at || new Date(a.expires_at).getTime() > Date.now())
  );

  const newAlertIds = useNewAlertIds(activeAlerts.map((a) => a.alert_id));

  const nearbyAlerts = getNearbyAlerts(alerts);
  const recentAlerts = getRecentAlerts(alerts);
  const updatedMinutesAgo = getUpdatedMinutesAgo(cachedAt);

  const styles: Record<string, CSSProperties> = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    },
    scrollArea: {
      flex: 1,
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
    },
    section: {
      padding: `0 ${r.gutter}px`,
      marginTop: r.sectionGap,
    },
    sectionHeading: {
      ...r.heading,
      color: theme.text.primary,
      margin: `0 0 ${spacing.scale[2]}px 0`,
      fontVariantNumeric: undefined,
    },
    alertList: {
      display: 'flex',
      flexDirection: 'column',
      gap: spacing.scale[3],
    },
    nearbyRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: `${spacing.scale[2]}px ${r.cardPadding}px`,
      backgroundColor: theme.bg.recessed,
      borderRadius: radius.card,
      border: `1px solid ${theme.line.hairline}`,
      marginBottom: spacing.scale[1],
    },
    nearbyText: {
      ...typography.body,
      color: theme.text.primary,
      margin: 0,
      fontVariantNumeric: undefined,
      flex: 1,
      wordBreak: 'break-word' as const,
    },
    nearbyDistance: {
      ...typography.meta,
      color: theme.text.secondary,
      marginLeft: spacing.scale[2],
      flexShrink: 0,
    },
    mapPreview: {
      margin: `${r.sectionGap}px ${r.gutter}px 0`,
      aspectRatio: '16 / 10',
      backgroundColor: theme.bg.recessed,
      borderRadius: radius.card,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      border: `1px solid ${theme.line.hairline}`,
    },
    conditionsCard: {
      backgroundColor: theme.bg.raised,
      borderRadius: radius.card,
      boxShadow: theme.shadow,
      padding: r.cardPadding,
    },
    conditionsText: {
      ...typography.body,
      color: theme.text.primary,
      margin: 0,
      fontVariantNumeric: undefined,
    },
    recentRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: `${spacing.scale[2]}px 0`,
      borderBottom: `1px solid ${theme.line.hairline}`,
      gap: spacing.scale[2],
    },
    recentText: {
      ...typography.body,
      color: theme.text.secondary,
      margin: 0,
      fontVariantNumeric: undefined,
      flex: 1,
      wordBreak: 'break-word' as const,
    },
    recentTime: {
      ...typography.meta,
      color: theme.text.faint,
      flexShrink: 0,
    },
    actions: {
      display: 'flex',
      gap: spacing.scale[2],
      padding: `0 ${r.gutter}px`,
      marginTop: r.sectionGap,
      marginBottom: r.sectionGap,
    },
    actionBtn: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: spacing.minTapTarget,
      backgroundColor: theme.bg.raised,
      boxShadow: theme.shadow,
      border: 'none',
      borderRadius: radius.card,
      color: theme.text.primary,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.body.fontSize,
      fontWeight: 600,
      cursor: 'pointer',
    },
    errorText: {
      ...typography.body,
      color: theme.severity.critical,
      padding: `${spacing.scale[3]}px ${r.gutter}px`,
      fontVariantNumeric: undefined,
    },
    emptySection: {
      ...typography.meta,
      color: theme.text.faint,
      fontVariantNumeric: undefined,
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.scrollArea}>
        <StatusStrip
          areaCount={subscriptions.length}
          updatedMinutesAgo={updatedMinutesAgo}
          isOffline={isOffline}
          loading={loading}
          locationAvailable={locationAvailable}
        />

        {error && alerts.length === 0 && (
          <p style={styles.errorText}>{error}</p>
        )}

        {activeAlerts.length > 0 && (
          <div style={styles.section}>
            <div style={styles.alertList}>
              {activeAlerts.map((alert) => (
                <AlertArrival key={alert.alert_id} isNew={newAlertIds.has(alert.alert_id)}>
                  <AlertCard
                    alert={alert}
                    distanceKm={3.2}
                    onPress={() => onAlertPress(alert.alert_id)}
                  />
                </AlertArrival>
              ))}
            </div>
          </div>
        )}

        {nearbyAlerts.length > 0 && (
          <div style={styles.section}>
            <h2 style={styles.sectionHeading}>Nearby</h2>
            {nearbyAlerts.map((alert) => (
              <div
                key={alert.alert_id}
                style={styles.nearbyRow}
                role="button"
                tabIndex={0}
                onClick={() => onAlertPress(alert.alert_id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAlertPress(alert.alert_id); } }}
                aria-label={`${alert.headline}, nearby`}
              >
                <span style={styles.nearbyText}>{alert.headline}</span>
                {alert.affected_radius_km !== undefined && (
                  <span style={styles.nearbyDistance}>
                    {alert.affected_radius_km < 1
                      ? `${(alert.affected_radius_km * 1000).toFixed(0)} m`
                      : `${alert.affected_radius_km.toFixed(0)} km`}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <div
          style={styles.mapPreview}
          role="button"
          tabIndex={0}
          onClick={onMapPress}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onMapPress(); } }}
          aria-label="Open full map"
        >
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <path
              d="M3 9v30l14-8 14 8 14-8V1L31 9 17 1 3 9z"
              stroke={theme.text.faint}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M17 1v30M31 9v30" stroke={theme.text.faint} strokeWidth="2" />
          </svg>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionHeading}>Conditions</h2>
          <div style={styles.conditionsCard}>
            <p style={styles.conditionsText}>14\u00b0C \u00b7 Rain \u00b7 River rising</p>
          </div>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionHeading}>Recent</h2>
          {recentAlerts.length > 0 ? (
            recentAlerts.map((alert) => (
              <div key={alert.alert_id} style={styles.recentRow}>
                <span style={styles.recentText}>{alert.headline}</span>
                <span style={styles.recentTime}>
                  {alert.expires_at ? formatTimeAgo(alert.expires_at) : ''}
                </span>
              </div>
            ))
          ) : (
            <p style={styles.emptySection}>No recent events in your area</p>
          )}
        </div>

        <div style={styles.actions}>
          <button style={styles.actionBtn} onClick={onGuidancePress} aria-label="View safety guidance">
            What to do
          </button>
          <button style={styles.actionBtn} onClick={onReportPress} aria-label="Submit a hazard report">
            Report
          </button>
        </div>
      </div>
    </div>
  );
}
