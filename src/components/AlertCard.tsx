import { Avatar, Card, Icon, Text } from 'react-native-paper';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { spacing, radius } from '@/theme/tokens';
import type { Theme } from '@/theme/tokens';
import { displayHeadline, formatTimeAgo, hazardIcon, isExpired, severityLabel, trustText } from '@/lib/alerts';
import { isDemoAlert } from '@/lib/tryMoby';
import { SeverityIndicator } from './SeverityIndicator';
import type { Alert } from '@/api/types';

interface AlertCardProps {
  alert: Alert;
  distanceKm?: number;
  onPress?: () => void;
}

/** `#RRGGBB` + alpha (0–1) → `#RRGGBBAA`. */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex.slice(0, 7)}${a}`;
}

// Trust treatments (home redesign spec v3, Part 3). The three levels must be
// distinguishable with the text unreadable: card mode, elevation and icon tint.
interface Treatment {
  mode: 'elevated' | 'outlined';
  cardColor: string;
  iconContainer: string;
  iconColor: string;
  /** Thick left edge in the severity colour; never on unverified reports. */
  edgeColor?: string;
  severityNeutral: boolean;
}

function treatmentFor(alert: Alert, theme: Theme): Treatment {
  const severityColor = theme.severity[alert.severity];
  switch (alert.verification_label) {
    case 'official_confirmed':
      return {
        mode: 'elevated',
        cardColor: theme.bg.raised,
        iconContainer: withAlpha(severityColor, 0.18),
        iconColor: severityColor,
        edgeColor: severityColor,
        severityNeutral: false,
      };
    case 'corroborated_report':
      return {
        mode: 'elevated',
        cardColor: theme.bg.raised,
        iconContainer: withAlpha(severityColor, 0.09),
        iconColor: severityColor,
        edgeColor: withAlpha(severityColor, 0.5),
        severityNeutral: false,
      };
    case 'unverified_report':
      // Never severity-tinted, never elevated, never a chip.
      return {
        mode: 'outlined',
        cardColor: theme.bg.recessed,
        iconContainer: theme.bg.raised,
        iconColor: theme.text.secondary,
        severityNeutral: true,
      };
  }
}

/**
 * Who says so, at a glance and in both themes: a filled blue pill with a check badge for an
 * official agency; a dashed violet pill with a question mark for unverified reports from
 * people nearby. Pills rather than Paper's Chip: Chip forces a single line, and the trust
 * label must never truncate (design system §8) — at 200% font scale it wraps instead.
 */
function TrustLabel({ alert, theme }: { alert: Alert; theme: Theme }) {
  const text = trustText(alert);
  const official = alert.verification_label === 'official_confirmed';
  const c = official ? theme.trust.official : theme.trust.unverified;
  return (
    <View
      style={[
        styles.pill,
        styles.trustPill,
        { backgroundColor: c.bg, borderColor: c.border, borderStyle: official ? 'solid' : 'dashed' },
      ]}
    >
      <Icon source={official ? 'check-decagram' : 'help-circle-outline'} size={16} color={c.text} />
      <Text variant="labelMedium" style={[styles.trustText, styles.trustTextFlex, { color: c.text }]}>
        {text}
      </Text>
    </View>
  );
}

/** "Demo · replay of 12 Jul, Dujiangyan": what a demo alert really was. */
export function demoText(alert: Alert): string {
  const r = alert.replay_of;
  if (!r) return 'Demo';
  const when = new Date(r.issued_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `Demo · replay of a real alert from ${when}${r.location_name ? `, ${r.location_name}` : ''}`;
}

/** Demo mode's replays: never mistaken for a current warning. */
export function DemoTag({ alert }: { alert: Alert }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.pill, styles.trustPill, { backgroundColor: theme.bg.recessed, borderColor: theme.text.secondary, borderStyle: 'dashed' }]}>
      <Icon source="play-circle-outline" size={16} color={theme.text.primary} />
      <Text variant="labelMedium" style={[styles.trustText, styles.trustTextFlex, { color: theme.text.primary }]}>
        {demoText(alert)}
      </Text>
    </View>
  );
}

export function AlertCard({ alert, distanceKm, onPress }: AlertCardProps) {
  const { theme } = useTheme();
  const t = treatmentFor(alert, theme);
  const expired = isExpired(alert);

  // Each fact once: the chip carries attribution, so metadata is place · distance · time.
  const meta = [
    expired ? 'Ended' : null,
    alert.location_name,
    distanceKm === undefined
      ? null
      : distanceKm === 0
        ? 'In the warning area'
        : distanceKm < 0.1
          ? '<0.1 km'
          : `${distanceKm.toFixed(1)} km`,
    formatTimeAgo(alert.issued_at),
    alert.translated ? 'Translated' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const demo = isDemoAlert(alert);
  const trust = demo ? `${demoText(alert)}. ${trustText(alert)}` : trustText(alert);

  return (
    <Card
      {...(t.mode === 'elevated'
        ? { mode: 'elevated' as const, elevation: 1 as const }
        : { mode: 'outlined' as const })}
      onPress={onPress}
      accessible
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${alert.headline}. ${severityLabel(alert.severity)}. ${trust}. ${meta}.`}
      style={[
        styles.card,
        { backgroundColor: t.cardColor, opacity: expired ? 0.7 : 1 },
        t.edgeColor && { borderLeftWidth: 6, borderLeftColor: t.edgeColor },
        // Single unverified reports: a dashed violet outline, matching their label.
        t.mode === 'outlined' && { borderColor: theme.trust.unverified.border, borderStyle: 'dashed' as const },
      ]}
      contentStyle={styles.content}
    >
      <View style={styles.row}>
        <Avatar.Icon
          size={44}
          icon={hazardIcon(alert.hazard_type)}
          color={t.iconColor}
          style={{ backgroundColor: t.iconContainer }}
        />

        <View style={styles.body}>
          <View style={styles.headlineRow}>
            <Text variant="titleMedium" numberOfLines={2} style={[styles.headline, { color: theme.text.primary }]}>
              {displayHeadline(alert.headline)}
            </Text>
            <SeverityIndicator severity={alert.severity} size="small" neutral={t.severityNeutral} />
          </View>

          <Text
            variant="bodyMedium"
            style={[styles.meta, { color: theme.text.secondary, fontVariant: ['tabular-nums'] }]}
          >
            {meta}
          </Text>

          <View style={styles.trustRow}>
            <TrustLabel alert={alert} theme={theme} />
          </View>
          {demo && (
            <View style={styles.trustRow}>
              <DemoTag alert={alert} />
            </View>
          )}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
  },
  content: {
    padding: spacing.cardPadding,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.scale[2],
  },
  body: {
    flex: 1,
  },
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.scale[2],
  },
  headline: {
    flex: 1,
  },
  meta: {
    marginTop: spacing.scale[0],
  },
  trustRow: {
    flexDirection: 'row',
    marginTop: spacing.scale[2],
  },
  pill: {
    flexShrink: 1,
    borderWidth: 1,
    borderRadius: radius.chip,
    paddingVertical: spacing.scale[0],
    paddingHorizontal: spacing.scale[2],
  },
  trustPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[1],
  },
  trustText: {
    fontWeight: '600',
  },
  trustTextFlex: {
    flexShrink: 1,
  },
});
