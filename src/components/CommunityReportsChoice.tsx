import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing } from '@/theme/tokens';
import { COMMUNITY_OPTIONS, type CommunityReports } from '@/hooks/useAlertPreferences';

/** Plain, honest descriptions: nobody reviews these before they reach you. */
export const COMMUNITY_CHOICES: Record<CommunityReports, { title: string; detail: string }> = {
  off: {
    title: 'Official warnings only',
    detail: 'Only alerts from weather, earthquake and disaster agencies.',
  },
  corroborated: {
    title: 'Also when several people report it',
    detail: 'Reports from 2 or more different people nearby. Not checked by officials, and always labelled unverified.',
  },
  all: {
    title: 'Also single reports',
    detail: 'Fastest, but one person can be wrong. Every report is labelled unverified, with how many people sent it.',
  },
};

/** Radio group for AlertPreferences.community_reports (Settings → Alert types, and the intro). */
export function CommunityReportsChoice({
  value,
  onChange,
}: {
  value: CommunityReports;
  onChange: (next: CommunityReports) => void;
}) {
  const { theme } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Reports from people nearby">
      {COMMUNITY_OPTIONS.map((option, i) => {
        const selected = value === option;
        const { title, detail } = COMMUNITY_CHOICES[option];
        return (
          <View key={option}>
            {i > 0 && <View style={[styles.divider, { backgroundColor: theme.line.hairline }]} />}
            <Pressable
              onPress={() => onChange(option)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${title}. ${detail}`}
              style={styles.row}
            >
              <View style={styles.text}>
                <Text variant="bodyLarge" style={{ color: theme.text.primary, fontWeight: selected ? '600' : '400' }}>
                  {title}
                </Text>
                <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
                  {detail}
                </Text>
              </View>
              <Icon
                source={selected ? 'radiobox-marked' : 'radiobox-blank'}
                size={24}
                color={selected ? theme.accent.calm : theme.text.faint}
              />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[3],
    minHeight: spacing.minTapTarget + spacing.scale[2],
    paddingVertical: spacing.scale[2],
  },
  text: { flex: 1, gap: 2 },
  divider: { height: StyleSheet.hairlineWidth },
});
