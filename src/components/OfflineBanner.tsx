import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useOnlineStatus, useOfflineBannerDismiss } from '@/hooks/useOnlineStatus';

export function OfflineBanner() {
  const { theme } = useTheme();
  const isOnline = useOnlineStatus();
  const { isDismissed, dismiss } = useOfflineBannerDismiss();
  const r = useResponsive();

  if (isOnline || isDismissed) return null;

  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: theme.text.secondary, paddingHorizontal: r.gutter },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={[styles.text, { color: theme.bg.raised }]}>
        Offline — showing saved information
      </Text>
      <Pressable
        style={styles.dismissBtn}
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss offline notice"
      >
        <Text style={[styles.dismissText, { color: theme.bg.raised }]}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.scale[1],
    minHeight: spacing.minTapTarget,
  },
  text: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
  },
  dismissBtn: {
    padding: spacing.scale[2],
    minWidth: spacing.minTapTarget,
    minHeight: spacing.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    fontSize: 20,
    lineHeight: 22,
  },
});
