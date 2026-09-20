import { useState, useCallback, type CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { spacing } from '@/theme/tokens';
import { StatusBlock } from '@/components/StatusBlock';
import { AlertCard } from '@/components/AlertCard';
import { useAlerts } from '@/hooks/useAlerts';

interface HomeScreenProps {
  onAlertPress: (alertId: string) => void;
  onGuidancePress: () => void;
  onReportPress: () => void;
}

export function HomeScreen({ onAlertPress, onGuidancePress, onReportPress }: HomeScreenProps) {
  const { theme } = useTheme();
  const [locationAvailable] = useState(true);

  const { alerts, loading, error, isOffline, cachedAt, refetch } = useAlerts(
    37.7749,
    -122.4194,
    50,
  );

  const activeAlerts = alerts.filter(
    (a) => !a.expires_at || new Date(a.expires_at).getTime() > Date.now()
  );

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const styles: Record<string, CSSProperties> = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100%',
    },
    scrollArea: {
      flex: 1,
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
    },
    alertList: {
      padding: `0 ${spacing.screenGutter}px`,
      display: 'flex',
      flexDirection: 'column',
      gap: spacing.scale[3],
      paddingBottom: spacing.scale[4],
    },
    actions: {
      display: 'flex',
      borderTop: `1px solid ${theme.line.hairline}`,
      backgroundColor: theme.bg.raised,
    },
    actionBtn: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: spacing.minTapTarget + 8,
      background: 'none',
      border: 'none',
      color: theme.text.primary,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: 16,
      fontWeight: 600,
      cursor: 'pointer',
    },
    actionDivider: {
      width: 1,
      backgroundColor: theme.line.hairline,
    },
    refreshHint: {
      textAlign: 'center',
      color: theme.text.faint,
      fontSize: 13,
      padding: `${spacing.scale[2]}px 0`,
      cursor: 'pointer',
      background: 'none',
      border: 'none',
      width: '100%',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      minHeight: spacing.minTapTarget,
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.scrollArea}>
        <StatusBlock
          alerts={alerts}
          loading={loading}
          error={error}
          isOffline={isOffline}
          cachedAt={cachedAt}
          locationAvailable={locationAvailable}
        />

        {activeAlerts.length > 0 && (
          <div style={styles.alertList}>
            {activeAlerts.map((alert) => (
              <AlertCard
                key={alert.alert_id}
                alert={alert}
                distanceKm={3.2}
                onPress={() => onAlertPress(alert.alert_id)}
              />
            ))}
          </div>
        )}

        {!loading && (
          <button
            style={styles.refreshHint}
            onClick={handleRefresh}
            aria-label="Refresh alerts"
          >
            Tap to refresh
          </button>
        )}
      </div>

      <div style={styles.actions}>
        <button
          style={styles.actionBtn}
          onClick={onGuidancePress}
          aria-label="View safety guidance"
        >
          Guidance
        </button>
        <div style={styles.actionDivider} />
        <button
          style={styles.actionBtn}
          onClick={onReportPress}
          aria-label="Submit a hazard report"
        >
          Report
        </button>
      </div>
    </div>
  );
}
