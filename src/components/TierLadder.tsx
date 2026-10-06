import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing } from '@/theme/tokens';
import type { Alert, VerificationLabel } from '@/api/types';

const STEPS: { label: VerificationLabel; title: string; body: string }[] = [
  {
    label: 'unverified_report',
    title: 'Reported',
    body: 'Someone nearby sent a report. Not checked yet.',
  },
  {
    label: 'corroborated_report',
    title: 'Corroborated',
    body: 'Separate people reported the same thing, so a reviewer is checking it.',
  },
  {
    label: 'official_confirmed',
    title: 'Confirmed',
    body: 'An official agency issued it, or a reviewer confirmed the reports.',
  },
];

/**
 * How sure Moby is about this alert (plan §10 tiers 0 → 1 → 2), so a community report
 * is never read as an official warning. Official alerts start at the top step.
 */
export function TierLadder({ alert }: { alert: Alert }) {
  const { theme } = useTheme();
  const current = STEPS.findIndex((s) => s.label === alert.verification_label);
  const official = alert.verification_label === 'official_confirmed' && !alert.corroboration_count;

  return (
    <View
      style={[styles.box, { backgroundColor: theme.bg.raised }]}
      accessible
      accessibilityLabel={`Verification: ${STEPS[current]?.title ?? 'unknown'}. ${STEPS[current]?.body ?? ''}`}
    >
      <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.text.primary }}>
        How sure we are
      </Text>
      {official ? (
        <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
          Issued by {alert.source_attribution ?? 'an official agency'}. Moby shows it as the agency wrote it.
        </Text>
      ) : (
        STEPS.map((step, i) => {
          const reached = i <= current;
          const isNow = i === current;
          const color = reached ? theme.accent.calm : theme.line.hairline;
          return (
            <View key={step.label} style={styles.step}>
              <View style={styles.rail}>
                <View style={[styles.dot, { borderColor: color, backgroundColor: reached ? color : theme.bg.raised }]} />
                {i < STEPS.length - 1 && <View style={[styles.line, { backgroundColor: i < current ? color : theme.line.hairline }]} />}
              </View>
              <View style={styles.text}>
                <Text
                  variant={isNow ? 'titleSmall' : 'bodyMedium'}
                  style={{ color: reached ? theme.text.primary : theme.text.faint }}
                >
                  {step.title}
                  {isNow ? ' · now' : ''}
                </Text>
                {isNow && (
                  <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
                    {step.body}
                  </Text>
                )}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: spacing.scale[4],
    padding: spacing.cardPadding,
    borderRadius: 16,
    gap: spacing.scale[2],
  },
  step: { flexDirection: 'row', gap: spacing.scale[3] },
  rail: { alignItems: 'center', width: 14 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, marginTop: 4 },
  line: { width: 2, flex: 1, minHeight: 12, marginVertical: 2 },
  text: { flex: 1, paddingBottom: spacing.scale[2], gap: 2 },
});
