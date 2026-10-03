import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeContext';
import { spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';

export function BackIcon({ color, size = 24 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M19 12H5M12 19l-7-7 7-7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

interface ScreenHeaderProps {
  title: string;
  onBack: () => void;
}

/** Top bar with a back button, shared by the stacked (non-tab) screens. */
export function ScreenHeader({ title, onBack }: ScreenHeaderProps) {
  const { theme } = useTheme();
  const r = useResponsive();

  return (
    <View
      style={[
        styles.header,
        {
          paddingHorizontal: r.gutter,
          borderBottomColor: theme.line.hairline,
          backgroundColor: theme.bg.raised,
        },
      ]}
    >
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={styles.backBtn}
      >
        <BackIcon color={theme.text.primary} />
      </Pressable>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[r.heading, styles.title, { color: theme.text.primary }]}
      >
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.scale[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: spacing.minTapTarget + 8,
  },
  backBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: spacing.minTapTarget,
    minHeight: spacing.minTapTarget,
    marginRight: spacing.scale[2],
  },
  title: {
    flex: 1,
  },
});
