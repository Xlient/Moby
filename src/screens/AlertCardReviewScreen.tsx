import { View, ScrollView, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing } from '@/theme/tokens';
import { AlertCard } from '@/components/AlertCard';
import type { Alert, Severity, VerificationLabel } from '@/api/types';

const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];
const VERIFICATIONS: VerificationLabel[] = [
  'official_confirmed',
  'corroborated_report',
  'unverified_report',
];

const VERIFICATION_LABELS: Record<VerificationLabel, string> = {
  official_confirmed: 'Official Confirmed',
  corroborated_report: 'Corroborated Report',
  unverified_report: 'Unverified Report',
};

function makeAlert(severity: Severity, verification: VerificationLabel): Alert {
  return {
    alert_id: `${severity}-${verification}`,
    event_id: 'evt-001',
    headline: `${severity.charAt(0).toUpperCase() + severity.slice(1)} severity ${VERIFICATION_LABELS[verification].toLowerCase()} alert`,
    severity,
    issued_at: new Date(Date.now() - 42 * 60_000).toISOString(),
    verification_label: verification,
    source_attribution:
      verification === 'official_confirmed'
        ? 'National Weather Service'
        : verification === 'corroborated_report'
          ? 'Confirmed by 4 nearby'
          : undefined,
  };
}

interface AlertCardReviewScreenProps {
  onBack: () => void;
}

export function AlertCardReviewScreen({ onBack }: AlertCardReviewScreenProps) {
  const { theme, toggleTheme, isDark } = useTheme();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg.base }}
      contentContainerStyle={styles.scrollContent}
    >
      <View style={styles.header}>
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: theme.accent.calm,
            fontSize: typography.body.fontSize,
            fontWeight: 600,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          Back
        </button>
        <Text
          style={{
            color: theme.text.primary,
            fontSize: typography.title.fontSize,
            lineHeight: typography.title.lineHeight,
            fontWeight: '600',
          }}
        >
          Alert Card Review
        </Text>
        <button
          onClick={toggleTheme}
          style={{
            background: 'none',
            border: `1px solid ${theme.line.hairline}`,
            borderRadius: 8,
            color: theme.text.primary,
            fontSize: typography.label.fontSize,
            fontWeight: 500,
            cursor: 'pointer',
            padding: '6px 12px',
          }}
        >
          {isDark ? 'Light' : 'Dark'}
        </button>
      </View>

      {VERIFICATIONS.map((verification) => (
        <View key={verification} style={styles.section}>
          <Text
            style={{
              color: theme.text.secondary,
              fontSize: typography.heading.fontSize,
              lineHeight: typography.heading.lineHeight,
              fontWeight: '600',
              marginBottom: spacing.scale[2],
            }}
          >
            {VERIFICATION_LABELS[verification]}
          </Text>
          {SEVERITIES.map((severity) => (
            <View key={severity} style={styles.cardWrapper}>
              <AlertCard
                alert={makeAlert(severity, verification)}
                distanceKm={2.3}
              />
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: spacing.scale[3],
    paddingBottom: spacing.scale[7],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.scale[5],
  },
  section: {
    marginBottom: spacing.scale[5],
  },
  cardWrapper: {
    marginBottom: spacing.scale[2],
  },
});
