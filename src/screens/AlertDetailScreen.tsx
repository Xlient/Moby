import { useMemo, type CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { AlertCard } from '@/components/AlertCard';
import { BriefPanel } from '@/components/BriefPanel';
import { useBrief } from '@/hooks/useBrief';
import { useAlerts } from '@/hooks/useAlerts';

interface AlertDetailScreenProps {
  alertId: string;
  onBack: () => void;
}

export function AlertDetailScreen({ alertId, onBack }: AlertDetailScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const { alerts } = useAlerts();

  const alert = useMemo(
    () => alerts.find((a) => a.alert_id === alertId),
    [alerts, alertId],
  );

  const { state: briefState } = useBrief(alert?.event_id);

  const styles: Record<string, CSSProperties> = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
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
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    scrollArea: {
      flex: 1,
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      padding: r.gutter,
    },
    notFound: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
    },
    notFoundText: {
      ...typography.body,
      color: theme.text.secondary,
      fontVariantNumeric: undefined,
    },
    sectionTitle: {
      ...r.heading,
      color: theme.text.primary,
      margin: `${r.sectionGap}px 0 ${spacing.scale[3]}px 0`,
      fontVariantNumeric: undefined,
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button
          style={styles.backBtn}
          onClick={onBack}
          aria-label="Go back"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" stroke={theme.text.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h2 style={styles.headerTitle}>
          {alert ? alert.headline : 'Alert details'}
        </h2>
      </div>

      {!alert ? (
        <div style={styles.notFound}>
          <p style={styles.notFoundText}>
            This alert is no longer available.
          </p>
        </div>
      ) : (
        <div style={styles.scrollArea}>
          <AlertCard alert={alert} distanceKm={3.2} />
          <BriefPanel state={briefState} />
        </div>
      )}
    </div>
  );
}
