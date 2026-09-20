import type { CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import type { GuidanceCard as GuidanceCardType } from '@/api/types';

interface GuidanceCardProps {
  card: GuidanceCardType;
  isStale?: boolean;
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function GuidanceCard({ card, isStale = false }: GuidanceCardProps) {
  const { theme } = useTheme();

  const styles: Record<string, CSSProperties> = {
    card: {
      backgroundColor: theme.bg.raised,
      borderRadius: radius.card,
      padding: spacing.cardPadding,
    },
    title: {
      ...typography.heading,
      color: theme.text.primary,
      margin: 0,
      fontVariantNumeric: undefined,
    },
    body: {
      ...typography.body,
      color: theme.text.primary,
      margin: `${spacing.scale[2]}px 0 0 0`,
      lineHeight: '25px',
      maxWidth: '70ch',
      fontVariantNumeric: undefined,
    },
    metaRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.scale[3],
      flexWrap: 'wrap',
      gap: spacing.scale[1],
    },
    source: {
      ...typography.meta,
      color: theme.text.secondary,
    },
    reviewDate: {
      ...typography.meta,
      color: isStale ? theme.text.secondary : theme.text.faint,
    },
  };

  return (
    <div style={styles.card} role="article" aria-label={card.title}>
      <h3 style={styles.title}>{card.title}</h3>
      <p style={styles.body}>{card.body}</p>
      <div style={styles.metaRow}>
        <span style={styles.source}>{card.source_name}</span>
        <span style={styles.reviewDate}>
          {isStale ? 'Last updated ' : 'Reviewed '}
          {formatDate(card.last_reviewed_at)}
        </span>
      </div>
    </div>
  );
}
