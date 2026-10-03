import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';

export function AssistantScreen() {
  const { theme } = useTheme();
  const r = useResponsive();

  return (
    <View style={[styles.container, { padding: r.gutter }]} accessibilityLabel="Assistant">
      <Text accessibilityRole="header" style={[r.heading, { color: theme.text.primary }]}>
        Assistant
      </Text>
      <Text style={[typography.body, styles.body, { color: theme.text.secondary }]}>
        Ask a question about an active alert or safety guidance. This feature is coming soon.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  body: {
    marginTop: spacing.scale[2],
    maxWidth: 360,
  },
});
