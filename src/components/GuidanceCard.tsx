import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import type { GuidanceCard as GuidanceCardType } from '@/api/types';

interface GuidanceCardProps {
  card: GuidanceCardType;
  isStale?: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Formatted by hand: Hermes' Intl support varies by Android build.
function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function GuidanceCard({ card, isStale = false }: GuidanceCardProps) {
  const { theme } = useTheme();
  const r = useResponsive();

  return (
    <View
      style={[styles.card, { backgroundColor: theme.bg.raised, padding: r.cardPadding }]}
      accessibilityLabel={card.title}
    >
      <Text accessibilityRole="header" style={[r.heading, { color: theme.text.primary }]}>
        {card.title}
      </Text>
      <Text style={[typography.body, styles.body, { color: theme.text.primary }]}>
        {card.body}
      </Text>
      <View style={styles.metaRow}>
        <Text style={[typography.meta, { color: theme.text.secondary }]}>
          {card.source_name}
        </Text>
        <Text
          style={[
            typography.meta,
            { color: isStale ? theme.text.secondary : theme.text.faint },
          ]}
        >
          {isStale ? 'Last updated ' : 'Reviewed '}
          {formatDate(card.last_reviewed_at)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
  },
  body: {
    marginTop: spacing.scale[2],
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginTop: spacing.scale[3],
    gap: spacing.scale[1],
  },
});
