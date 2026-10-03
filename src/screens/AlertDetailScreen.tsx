import { useMemo } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { typography } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { AlertCard } from '@/components/AlertCard';
import { BriefPanel } from '@/components/BriefPanel';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useBrief } from '@/hooks/useBrief';
import { useAlerts } from '@/hooks/useAlerts';
import { USER_CENTER, distanceKm } from '@/lib/geo';

interface AlertDetailScreenProps {
  alertId: string;
  onBack: () => void;
}

export function AlertDetailScreen({ alertId, onBack }: AlertDetailScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const { isEnabled } = useFeatureFlags();
  const { alerts } = useAlerts();

  const alert = useMemo(
    () => alerts.find((a) => a.alert_id === alertId),
    [alerts, alertId],
  );

  const { state: briefState } = useBrief(alert?.event_id);

  const distance = alert?.location
    ? Math.round(distanceKm(USER_CENTER.lat, USER_CENTER.lon, alert.location.lat, alert.location.lon) * 10) / 10
    : undefined;

  return (
    <View style={styles.container}>
      <ScreenHeader title={alert ? alert.headline : 'Alert details'} onBack={onBack} />

      {!alert ? (
        <View style={styles.notFound}>
          <Text style={[typography.body, { color: theme.text.secondary }]}>
            This alert is no longer available.
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.container} contentContainerStyle={{ padding: r.gutter }}>
          <AlertCard alert={alert} distanceKm={distance} />
          {isEnabled('situational_brief') && <BriefPanel state={briefState} />}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
