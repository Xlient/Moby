import { View, ScrollView, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { AlertCard } from '@/components/AlertCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import type { Alert, Severity, VerificationLabel } from '@/api/types';

const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];
const VERIFICATIONS: VerificationLabel[] = [
  'official_confirmed',
  'corroborated_report',
  'unverified_report',
];

const VERIFICATION_LABELS: Record<VerificationLabel, string> = {
  official_confirmed: 'Official confirmed',
  corroborated_report: 'Corroborated report',
  unverified_report: 'Unverified report',
};

function makeAlert(severity: Severity, verification: VerificationLabel): Alert {
  return {
    alert_id: `dev-${verification}-${severity}`,
    event_id: `event-dev-${verification}-${severity}`,
    headline: `${severity.charAt(0).toUpperCase() + severity.slice(1)} ${VERIFICATION_LABELS[verification]}`,
    body: `Sample alert body for ${severity} severity with ${VERIFICATION_LABELS[verification].toLowerCase()} trust level.`,
    severity,
    location: { lat: 37.77, lon: -122.42, accuracy_m: 500, frame: 'WGS84' },
    affected_radius_km: 10,
    issued_at: new Date(Date.now() - 15 * 60_000).toISOString(),
    expires_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    verification_label: verification,
    source_attribution:
      verification === 'official_confirmed'
        ? 'National Weather Service'
        : verification === 'corroborated_report'
          ? 'Confirmed by 4 nearby'
          : undefined,
  };
}

interface TrustReviewScreenProps {
  onBack: () => void;
}

export function TrustReviewScreen({ onBack }: TrustReviewScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();

  return (
    <View style={[styles.container, { backgroundColor: theme.bg.base }]}>
      <ScreenHeader title="Trust treatments" onBack={onBack} />
      <ScrollView style={styles.container}>
        {VERIFICATIONS.map((v) => (
          <View key={v} style={{ paddingTop: r.sectionGap, paddingHorizontal: r.gutter }}>
            <Text
              accessibilityRole="header"
              style={[r.heading, styles.sectionTitle, { color: theme.text.primary }]}
            >
              {VERIFICATION_LABELS[v]}
            </Text>
            <View style={[styles.cardGap, { paddingBottom: r.sectionGap }]}>
              {SEVERITIES.map((s) => (
                <AlertCard key={`${v}-${s}`} alert={makeAlert(s, v)} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sectionTitle: {
    marginBottom: spacing.scale[3],
  },
  cardGap: {
    gap: spacing.scale[3],
  },
});
