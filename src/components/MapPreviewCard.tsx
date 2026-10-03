import { View, Pressable, StyleSheet } from 'react-native';
import { Card, Icon, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing, radius } from '@/theme/tokens';
import type { NearbyAlert } from '@/hooks/useNearbyAlerts';
import { MapPreviewCanvas } from './MapPreviewCanvas';

interface MapPreviewCardProps {
  nearby: NearbyAlert[];
  radiusKm: number;
  isOffline: boolean;
  onPress: () => void;
  onRadiusPress: () => void;
}

/**
 * Static preview (spec v3, Part 4): user position, radius circle and a pin for
 * every alert inside the radius — the same set as the list above it. No pan, no
 * zoom, no pin taps; the whole card opens the full map, the chip opens the picker.
 */
export function MapPreviewCard({ nearby, radiusKm, isOffline, onPress, onRadiusPress }: MapPreviewCardProps) {
  const { theme } = useTheme();
  const summary =
    nearby.length === 0
      ? `Nothing within ${radiusKm} km`
      : `${nearby.length} alert${nearby.length === 1 ? '' : 's'} within ${radiusKm} km`;

  return (
    <Card
      mode="contained"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Map preview. ${summary}.${isOffline ? ' Last known view.' : ''} Opens the full map.`}
      style={[styles.card, { backgroundColor: theme.bg.recessed }]}
    >
      <View style={styles.canvas} pointerEvents="box-none">
        <MapPreviewCanvas nearby={nearby} radiusKm={radiusKm} />

        {isOffline && (
          <View style={[styles.offlineTag, { backgroundColor: theme.bg.raised }]}>
            <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
              Last known view
            </Text>
          </View>
        )}

        <Pressable
          onPress={onRadiusPress}
          accessibilityRole="button"
          accessibilityLabel={`Watching within ${radiusKm} kilometres. Change radius.`}
          hitSlop={8}
          style={[styles.radiusChip, { backgroundColor: theme.bg.raised }]}
        >
          <Icon source="map-marker-radius-outline" size={18} color={theme.text.secondary} />
          <Text variant="labelLarge" style={[styles.chipText, { color: theme.text.primary }]}>
            Within {radiusKm} km
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  canvas: {
    aspectRatio: 16 / 10,
  },
  offlineTag: {
    position: 'absolute',
    top: spacing.scale[2],
    left: spacing.scale[2],
    borderRadius: radius.chip,
    paddingVertical: spacing.scale[0],
    paddingHorizontal: spacing.scale[2],
  },
  radiusChip: {
    position: 'absolute',
    left: spacing.scale[2],
    bottom: spacing.scale[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[1],
    minHeight: 40,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.scale[2],
  },
  chipText: {
    fontWeight: '500',
  },
});
