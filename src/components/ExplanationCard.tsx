import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import type { AlertExplanation } from '@/api/types';

/**
 * Plain-language explanation of an official warning. Always labelled as AI and always
 * shown above — never instead of — the agency's own text.
 */
export function ExplanationCard({ explanation, pending }: { explanation?: AlertExplanation; pending: boolean }) {
  const { theme } = useTheme();
  if (!explanation && !pending) return null;

  return (
    <View
      style={[styles.container, { backgroundColor: theme.bg.raised }]}
      accessibilityLabel="What this means for you, explained by Moby AI"
    >
      <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.text.primary }}>
        What this means for you
      </Text>
      {!explanation ? (
        <Text style={[typography.meta, styles.gap, { color: theme.text.secondary }]}>
          Putting the warning into plain words…
        </Text>
      ) : (
        <>
          <Text style={[typography.body, styles.gap, { color: theme.text.primary }]}>{explanation.summary}</Text>
          {explanation.actions.map((action, i) => (
            <Text key={i} style={[typography.body, styles.action, { color: theme.text.primary }]}>
              {'•  '}
              {action}
            </Text>
          ))}
          <Text style={[typography.meta, styles.label, { color: theme.text.faint }]}>
            Explained by Moby AI · NVIDIA Nemotron, from the official text below. If they differ, follow the official text.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.card,
    marginTop: spacing.scale[3],
    padding: spacing.scale[4],
  },
  gap: {
    marginTop: spacing.scale[2],
  },
  action: {
    marginTop: spacing.scale[1],
  },
  label: {
    marginTop: spacing.scale[3],
  },
});
