import { useMemo, useState } from 'react';
import { View, StyleSheet, Linking, Pressable } from 'react-native';
import { Avatar, Icon, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { isGuidanceStale } from '@/guidance/guidanceStore';
import { guidanceSteps } from '@/guidance/steps';
import { hazardIcon } from '@/lib/alerts';
import type { GuidanceCard as GuidanceCardType } from '@/api/types';

interface GuidanceCardProps {
  card: GuidanceCardType;
  /** Shorter layout for the alert detail screen. */
  compact?: boolean;
}

/** Steps shown before "N more steps"; the first thing to do and the key fact always show. */
const VISIBLE_STEPS = 3;

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
 *
 * The body is split for scanning under stress — the first thing to do, then do and
 * don't steps, then one key fact — keeping the source's exact words (guidance/steps.ts).
 */
export function GuidanceCard({ card, compact = false }: GuidanceCardProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const stale = isGuidanceStale(card);
  const { first, steps, fact } = useMemo(() => guidanceSteps(card.body), [card.body]);
  const [expanded, setExpanded] = useState(false);
  const shownCount = compact ? 2 : VISIBLE_STEPS;
  const hidden = Math.max(0, steps.length - shownCount);
  const shown = expanded ? steps : steps.slice(0, shownCount);

  return (
    <View style={[styles.card, { backgroundColor: theme.bg.raised, padding: r.cardPadding }]}>
      <View style={styles.header}>
        <Avatar.Icon
          size={44}
          icon={hazardIcon(card.hazard_type)}
          color={theme.brand.onSoft}
          style={{ backgroundColor: theme.brand.soft }}
        />
        <View style={styles.headerText}>
          {card.applies_when && !compact && (
            <View style={[styles.when, { backgroundColor: theme.bg.recessed }]}>
              <Text style={[typography.label, { color: theme.text.secondary }]}>
                {card.applies_when.charAt(0).toUpperCase() + card.applies_when.slice(1)}
              </Text>
            </View>
          )}
          <Text accessibilityRole="header" style={[r.heading, { color: theme.text.primary }]}>
            {card.title}
          </Text>
        </View>
      </View>

      <View style={[styles.first, { backgroundColor: theme.brand.navy }]}>
        <View style={[styles.firstMark, { backgroundColor: theme.brand.pop }]} />
        <View style={styles.flex}>
          <Text style={[typography.meta, { color: theme.brand.onNavySecondary }]}>Do this first</Text>
          <Text style={[typography.bodyStrong, { color: theme.brand.onNavy }]}>{first}</Text>
        </View>
      </View>

      {shown.length > 0 && (
        <View style={styles.steps}>
          {shown.map((step) => (
            <View key={step.text} style={styles.step}>
              <Icon
                source={step.kind === 'dont' ? 'close-circle-outline' : 'check-circle-outline'}
                size={22}
                color={step.kind === 'dont' ? theme.text.primary : theme.brand.primary}
              />
              <Text
                style={[typography.body, styles.flex, { color: theme.text.primary }]}
                accessibilityLabel={`${step.kind === 'dont' ? 'Don’t: ' : ''}${step.text}`}
              >
                {step.text}
              </Text>
            </View>
          ))}
        </View>
      )}

      {fact && (
        <View style={[styles.fact, { backgroundColor: theme.brand.soft }]}>
          <Icon source="ruler" size={22} color={theme.brand.onSoft} />
          <Text style={[typography.body, styles.flex, { color: theme.brand.onSoft }]}>{fact}</Text>
        </View>
      )}

      {hidden > 0 && (
        <Pressable
          onPress={() => setExpanded((e) => !e)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          style={[styles.more, { borderColor: theme.line.hairline }]}
        >
          <Icon source={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={theme.text.primary} />
          <Text style={[typography.label, { color: theme.text.primary }]}>
            {expanded ? 'Show fewer steps' : `${hidden} more step${hidden === 1 ? '' : 's'}`}
          </Text>
        </Pressable>
      )}

      <View style={[styles.metaRow, { borderTopColor: theme.line.hairline }]}>
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
        <Text style={[typography.meta, { color: theme.text.secondary }]}>
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
    gap: spacing.scale[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[3],
  },
  headerText: {
    flex: 1,
    alignItems: 'flex-start',
    gap: spacing.scale[1],
  },
  when: {
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: spacing.scale[2],
  },
  first: {
    flexDirection: 'row',
    gap: spacing.scale[3],
    padding: spacing.scale[3],
    borderRadius: radius.card,
  },
  firstMark: {
    width: 4,
    borderRadius: 2,
  },
  flex: {
    flex: 1,
  },
  steps: {
    gap: spacing.scale[2],
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.scale[2],
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.scale[2],
    padding: spacing.scale[3],
    borderRadius: radius.chip,
  },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.scale[1],
    minHeight: spacing.minTapTarget,
    paddingHorizontal: spacing.scale[3],
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  source: {
    textDecorationLine: 'underline',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.scale[1],
    paddingTop: spacing.scale[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
