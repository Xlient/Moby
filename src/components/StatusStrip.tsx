import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';

interface StatusStripProps {
  areaCount: number;
  updatedMinutesAgo: number | null;
  isOffline: boolean;
  loading: boolean;
  locationAvailable: boolean;
}

function formatUpdatedTime(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes < 1) return 'updated just now';
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `updated ${hours}h ago`;
}

export function StatusStrip({
  areaCount,
  updatedMinutesAgo,
  isOffline,
  loading,
  locationAvailable,
}: StatusStripProps) {
  const { theme } = useTheme();
  const r = useResponsive();

  let text: string;
  if (!locationAvailable) {
    text = 'Location unavailable';
  } else if (loading) {
    text = 'Checking for alerts…';
  } else if (isOffline) {
    const timeStr = formatUpdatedTime(updatedMinutesAgo);
    text = `Offline${timeStr ? ' · ' + timeStr : ''}`;
  } else {
    const areaStr = areaCount === 1 ? '1 area' : `${areaCount} areas`;
    const timeStr = formatUpdatedTime(updatedMinutesAgo);
    text = `Watching ${areaStr}${timeStr ? ' · ' + timeStr : ''}`;
  }

  const showCalmDot = locationAvailable && !isOffline && !loading;

  return (
    <View
      style={[styles.strip, { paddingHorizontal: r.gutter }]}
      accessibilityLabel={text}
    >
      <View
        style={[
          styles.dot,
          { backgroundColor: showCalmDot ? theme.accent.calm : theme.text.faint },
        ]}
      />
      <Text style={[typography.meta, { color: theme.text.secondary }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.scale[2],
    minHeight: spacing.minTapTarget,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.scale[2],
  },
});
