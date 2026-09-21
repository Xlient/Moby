import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing, radius as radiusTokens } from '@/theme/tokens';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import type { RadiusKm } from '@/hooks/useNearbyRadius';

interface MapPreviewCardProps {
  radiusKm: RadiusKm;
  onPress: () => void;
  alertCount: number;
}

function MapIcon({ color }: { color: string }) {
  return (
    <svg width={32} height={32} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M16 4C11.58 4 8 7.58 8 12c0 6 8 16 8 16s8-10 8-16c0-4.42-3.58-8-8-8z"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
      />
      <circle cx="16" cy="12" r="3" stroke={color} strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function RadiusRing({ color }: { color: string }) {
  return (
    <svg width={64} height={64} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle
        cx="32"
        cy="32"
        r="28"
        stroke={color}
        strokeWidth="1"
        strokeDasharray="4 3"
        opacity={0.4}
      />
      <circle cx="32" cy="32" r="3" fill={color} opacity={0.6} />
    </svg>
  );
}

export function MapPreviewCard({ radiusKm, onPress, alertCount }: MapPreviewCardProps) {
  const { theme } = useTheme();
  const isOnline = useOnlineStatus();

  const caption = isOnline
    ? alertCount > 0
      ? `${alertCount} alert${alertCount === 1 ? '' : 's'} within ${radiusKm} km`
      : `No alerts within ${radiusKm} km`
    : `Offline \u2014 last view`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Map preview. ${caption}. Tap to open map.`}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.bg.recessed,
            borderColor: theme.line.hairline,
            borderRadius: radiusTokens.card,
          },
        ]}
      >
        <View style={styles.mapContent}>
          <RadiusRing color={theme.accent.calm} />
          <View style={styles.pinOverlay}>
            <MapIcon color={theme.text.faint} />
          </View>
        </View>

        <View
          style={[
            styles.captionBar,
            {
              backgroundColor: theme.bg.raised,
              borderTopWidth: 1,
              borderTopColor: theme.line.hairline,
            },
          ]}
        >
          <Text
            variant="bodyMedium"
            style={{ color: theme.text.secondary }}
          >
            {caption}
          </Text>
          <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M6 4l4 4-4 4"
              stroke={theme.text.faint}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  mapContent: {
    aspectRatio: 16 / 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinOverlay: {
    position: 'absolute',
  },
  captionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.scale[2],
    paddingHorizontal: spacing.scale[3],
  },
});
