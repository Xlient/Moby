import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { typography } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { AlertCard } from '@/components/AlertCard';
import { BriefPanel } from '@/components/BriefPanel';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ContributingReports } from '@/components/ContributingReports';
import { useBrief } from '@/hooks/useBrief';
import { useEventReports } from '@/hooks/useEventReports';
import { useAlerts } from '@/hooks/useAlerts';
import { distanceKm } from '@/lib/geo';
import { useUserCenter } from '@/location/UserLocationContext';

interface AlertDetailScreenProps {
  alertId: string;
  onBack: () => void;
}

export function AlertDetailScreen({ alertId, onBack }: AlertDetailScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const { isEnabled } = useFeatureFlags();
  const { alerts } = useAlerts();
  const center = useUserCenter();

  const listed = useMemo(
    () => alerts.find((a) => a.alert_id === alertId),
    [alerts, alertId],
  );
  // Opened from a notification, the alert may not be in the nearby list (a saved area
  // elsewhere, or not fetched yet): load it on its own.
  const single = useQuery({
    queryKey: ['alert', alertId],
    queryFn: () => api.getAlert(alertId),
    enabled: !listed,
    staleTime: 60_000,
  });
  const alert = listed ?? single.data;

  const { state: briefState } = useBrief(alert?.event_id);
  // Official alerts come from agencies, not people nearby; only community alerts have reports.
  const fromCommunity = !!alert && alert.verification_label !== 'official_confirmed';
  const reports = useEventReports(alert?.event_id, fromCommunity);

  const distance = alert?.location
    ? Math.round(distanceKm(center.lat, center.lon, alert.location.lat, alert.location.lon) * 10) / 10
    : undefined;

  return (
    <View style={styles.container}>
      <ScreenHeader title={alert ? alert.headline : 'Alert details'} onBack={onBack} />

      {!alert ? (
        <View style={styles.notFound}>
          <Text style={[typography.body, { color: theme.text.secondary }]}>
            {single.isLoading ? 'Loading alert…' : 'This alert is no longer available.'}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.container} contentContainerStyle={{ padding: r.gutter }}>
          <AlertCard alert={alert} distanceKm={distance} />
          {fromCommunity && (
            <ContributingReports
              data={reports.data}
              loading={reports.loading}
              error={reports.error}
              onRetry={reports.refetch}
            />
          )}
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
