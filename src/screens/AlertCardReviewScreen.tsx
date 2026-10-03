import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing } from '@/theme/tokens';
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

const HAZARD_BY_SEVERITY: Record<Severity, Alert['hazard_type']> = {
  low: 'earthquake',
  medium: 'landslide',
  high: 'fire',
  critical: 'flood',
};

function makeAlert(severity: Severity, verification: VerificationLabel): Alert {
  const headline = `${severity.charAt(0).toUpperCase() + severity.slice(1)} severity alert`;
  return {
    alert_id: `${severity}-${verification}`,
    event_id: 'evt-001',
    hazard_type: HAZARD_BY_SEVERITY[severity],
    headline,
    severity,
    issued_at: new Date(Date.now() - 42 * 60_000).toISOString(),
    verification_label: verification,
    source_attribution: verification === 'official_confirmed' ? 'National Weather Service' : undefined,
    corroboration_count: verification === 'corroborated_report' ? 4 : undefined,
    location_name: 'River Basin area',
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
        <Pressable onPress={onBack} accessibilityRole="button" style={styles.headerBtn}>
          <Text style={{ color: theme.accent.calm, fontSize: 17, fontWeight: '600' }}>Back</Text>
        </Pressable>
        <Text variant="titleLarge" style={{ color: theme.text.primary }}>
          Alert Card Review
        </Text>
        <Pressable
          onPress={toggleTheme}
          accessibilityRole="button"
          style={[styles.themeBtn, { borderColor: theme.line.hairline }]}
        >
          <Text style={{ color: theme.text.primary, fontSize: 13, fontWeight: '500' }}>
            {isDark ? 'Light' : 'Dark'}
          </Text>
        </Pressable>
      </View>

      <Text
        variant="bodyMedium"
        style={{ color: theme.text.faint, marginBottom: spacing.scale[4] }}
      >
        {SEVERITIES.length} severities x {VERIFICATIONS.length} trust levels = {SEVERITIES.length * VERIFICATIONS.length} combinations
      </Text>

      {VERIFICATIONS.map((verification) => (
        <View key={verification} style={styles.section}>
          <Text
            variant="titleMedium"
            style={{
              color: theme.text.secondary,
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
    marginBottom: spacing.scale[3],
  },
  section: {
    marginBottom: spacing.scale[5],
  },
  headerBtn: {
    minHeight: spacing.minTapTarget,
    justifyContent: 'center',
  },
  themeBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  cardWrapper: {
    marginBottom: spacing.scale[2],
  },
});
