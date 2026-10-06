import { View, StyleSheet, Linking, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { isGuidanceStale } from '@/guidance/guidanceStore';
import type { GuidanceCard as GuidanceCardType } from '@/api/types';

interface GuidanceCardProps {
  card: GuidanceCardType;
  /** Shorter layout for the alert detail screen. */
  compact?: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Formatted by hand: Hermes' Intl support varies by Android build.
function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * One piece of safety guidance. Deliberately styled unlike an alert (no severity
 * colour, no trust pill): it's advice from an official source, not a warning.
 * Source and date are always shown (plan v3 §8.2).
 */
export function GuidanceCard({ card, compact = false }: GuidanceCardProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const stale = isGuidanceStale(card);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.bg.raised, padding: r.cardPadding, borderLeftColor: theme.line.hairline },
      ]}
      accessibilityLabel={`${card.title}. ${card.body} Source: ${card.source_name}.`}
    >
      {card.applies_when && !compact && (
        <Text style={[typography.meta, styles.when, { color: theme.text.secondary }]}>
          {card.applies_when.charAt(0).toUpperCase() + card.applies_when.slice(1)}
        </Text>
      )}
      <Text accessibilityRole="header" style={[r.heading, { color: theme.text.primary }]}>
        {card.title}
      </Text>
      <Text style={[typography.body, styles.body, { color: theme.text.primary }]}>{card.body}</Text>
      <View style={styles.metaRow}>
        <Pressable
          onPress={() => Linking.openURL(card.source_url).catch(() => {})}
          accessibilityRole="link"
          accessibilityHint="Opens the official page in your browser"
          hitSlop={8}
        >
          <Text style={[typography.meta, styles.source, { color: theme.text.secondary }]}>
            {card.source_name}
          </Text>
        </Pressable>
        <Text style={[typography.meta, { color: stale ? theme.text.secondary : theme.text.faint }]}>
          {stale ? 'Older guidance · checked ' : 'Checked '}
          {formatDate(card.last_reviewed_at)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderLeftWidth: 3,
  },
  when: {
    marginBottom: spacing.scale[1],
  },
  body: {
    marginTop: spacing.scale[2],
  },
  source: {
    textDecorationLine: 'underline',
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
