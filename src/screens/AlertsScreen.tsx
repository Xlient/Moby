import { FlatList, View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useNearbyAlerts } from '@/hooks/useNearbyAlerts';
import { AlertCard } from '@/components/AlertCard';
import { ScreenHeader } from '@/components/ScreenHeader';

interface AlertsScreenProps {
  onBack: () => void;
  onAlertPress: (alertId: string) => void;
}

/** Every alert within the radius, highest severity first. Opened from "See all alerts". */
export function AlertsScreen({ onBack, onAlertPress }: AlertsScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const { nearby, radiusKm, isOffline, cachedAt } = useNearbyAlerts();

  return (
    <View style={styles.container}>
      <ScreenHeader title="Alerts near you" onBack={onBack} />
      <FlatList
        data={nearby}
        keyExtractor={(item) => item.alert.alert_id}
        contentContainerStyle={{ padding: r.gutter }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <Text
            variant="bodyLarge"
            style={[styles.intro, { color: theme.text.secondary, fontVariant: ['tabular-nums'] }]}
          >
            {isOffline ? 'Offline — showing saved info. ' : ''}
            {nearby.length} within {radiusKm} km, most serious first.
          </Text>
        }
        ListEmptyComponent={
          <Text variant="bodyLarge" style={{ color: theme.text.secondary }}>
            {/* Never claim "all quiet" if we haven't been able to check. */}
            {cachedAt
              ? `All quiet within ${radiusKm} km.`
              : 'Can’t check for alerts yet. We’ll look as soon as you have signal.'}
          </Text>
        }
        renderItem={({ item }) => (
          <AlertCard
            alert={item.alert}
            distanceKm={item.distanceKm}
            onPress={() => onAlertPress(item.alert.alert_id)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  intro: {
    marginBottom: spacing.scale[3],
  },
  separator: {
    height: spacing.scale[2],
  },
});
