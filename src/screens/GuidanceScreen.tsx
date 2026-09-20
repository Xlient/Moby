import type { CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing } from '@/theme/tokens';
import { GuidanceCard } from '@/components/GuidanceCard';
import { useGuidanceCards } from '@/hooks/useGuidanceCards';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResponsive } from '@/hooks/useResponsive';

interface GuidanceScreenProps {
  onBack: () => void;
}

export function GuidanceScreen({ onBack }: GuidanceScreenProps) {
  const { theme } = useTheme();
  const isOnline = useOnlineStatus();
  const { cards, loading, error, isStale, cachedAt } = useGuidanceCards();
  const r = useResponsive();

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
    },
    scrollArea: {
      flex: 1,
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      padding: r.gutter,
    },
    list: {
      display: 'flex',
      flexDirection: 'column',
      gap: spacing.scale[3],
    },
    statusText: {
      ...typography.body,
      color: theme.text.secondary,
      textAlign: 'center',
      padding: `${r.sectionGap}px 0`,
      fontVariantNumeric: undefined,
    },
    offlineNote: {
      ...typography.meta,
      color: theme.text.faint,
      textAlign: 'center',
      marginBottom: spacing.scale[3],
    },
    emptyState: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
      textAlign: 'center',
      padding: r.sectionGap,
    },
    emptyTitle: {
      ...r.heading,
      color: theme.text.primary,
      margin: 0,
      fontVariantNumeric: undefined,
    },
    emptyBody: {
      ...typography.body,
      color: theme.text.secondary,
      margin: `${spacing.scale[2]}px 0 0 0`,
      maxWidth: '40ch',
      fontVariantNumeric: undefined,
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
        <h2 style={styles.headerTitle}>Safety guidance</h2>
      </div>

      <div style={styles.scrollArea}>
        {loading && (
          <p style={styles.statusText}>Loading guidance cards</p>
        )}

        {error && cards.length === 0 && (
          <p style={styles.statusText}>{error}</p>
        )}

        {!loading && !error && cards.length === 0 && (
          <div style={styles.emptyState}>
            <h3 style={styles.emptyTitle}>No guidance cards available</h3>
            <p style={styles.emptyBody}>
              Guidance cards for your region will appear here when available.
            </p>
          </div>
        )}

        {cards.length > 0 && (
          <>
            {!isOnline && cachedAt && (
              <p style={styles.offlineNote}>
                Showing saved guidance
              </p>
            )}
            <div style={styles.list}>
              {cards.map((card) => (
                <GuidanceCard key={card.card_id} card={card} isStale={isStale} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
