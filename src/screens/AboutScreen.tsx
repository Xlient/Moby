import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Constants from 'expo-constants';
import { useTheme } from '@/theme/ThemeContext';
import { spacing, typography } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { ScreenHeader } from '@/components/ScreenHeader';
import { env } from '@/config/env';
import type { ClientConfig } from '@/api/types';

interface AboutScreenProps {
  onBack: () => void;
  onReplayIntro: () => void;
}

const APP_VERSION = Constants.expoConfig?.version ?? '0.1.0';

const SOURCES: { group: string; names: string }[] = [
  { group: 'Weather', names: 'National Weather Service, MeteoAlarm (Europe), Japan Meteorological Agency, national CAP feeds' },
  { group: 'Earthquakes and tsunamis', names: 'U.S. Geological Survey, EMSC, Pacific Tsunami Warning Center' },
  { group: 'Cyclones', names: 'National Hurricane Center, Joint Typhoon Warning Center' },
  { group: 'Disasters worldwide', names: 'GDACS, NASA EONET, BIPAD (Nepal)' },
  { group: 'Safety guidance', names: 'Ready.gov (FEMA) and the National Weather Service' },
];

const FEATURES: { flag: keyof ClientConfig['flags']; label: string }[] = [
  { flag: 'offline_guidance_cards', label: 'Offline safety guidance' },
  { flag: 'situational_brief', label: 'AI situation briefs' },
  { flag: 'mesh_relay', label: 'Bluetooth relay between phones' },
  { flag: 'on_device_assistant', label: 'On-device assistant' },
  { flag: 'proximity_confirmation', label: '“Can you confirm?” prompts' },
];

/** Settings → About (sprint 6): what Moby is, where its data comes from, and what's switched on. */
export function AboutScreen({ onBack, onReplayIntro }: AboutScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const { isEnabled } = useFeatureFlags();
  const muted = { color: theme.text.secondary };
  const card = [styles.card, { backgroundColor: theme.bg.raised }];

  return (
    <View style={styles.container}>
      <ScreenHeader title="About Moby" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: r.gutter, paddingBottom: spacing.scale[7], gap: spacing.scale[5] }}>
        <View style={{ gap: spacing.scale[2] }}>
          <Text variant="bodyLarge" style={{ color: theme.text.primary }}>
            Moby is a disaster early-warning app. It brings official warnings and reports from people nearby
            together, says plainly how sure it is, and keeps working when the network doesn’t.
          </Text>
          <Text variant="bodyMedium" style={muted}>
            Not a replacement for official warnings or emergency services. In danger, call your local
            emergency number.
          </Text>
        </View>

        <View style={{ gap: spacing.scale[2] }}>
          <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.text.primary }}>How a report becomes an alert</Text>
          <View style={card}>
            {[
              ['1', 'You report what you see. It’s saved on your phone first, so it works offline.'],
              ['2', 'An AI pipeline matches it with other reports and official feeds. It never raises an alert by itself.'],
              ['3', 'When several people agree, or it looks severe, a person reviews it.'],
              ['4', 'Only then is it sent to people nearby, labelled with how it was confirmed.'],
            ].map(([n, text]) => (
              <View key={n} style={styles.stepRow}>
                <Text variant="titleSmall" style={[styles.stepNum, { color: theme.accent.calm }]}>{n}</Text>
                <Text variant="bodyMedium" style={[styles.flex, { color: theme.text.primary }]}>{text}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ gap: spacing.scale[2] }}>
          <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.text.primary }}>Where alerts come from</Text>
          <View style={card}>
            {SOURCES.map((s) => (
              <View key={s.group} style={styles.sourceRow}>
                <Text variant="titleSmall" style={{ color: theme.text.primary }}>{s.group}</Text>
                <Text variant="bodyMedium" style={muted}>{s.names}</Text>
              </View>
            ))}
          </View>
          <Text style={[typography.meta, muted]}>
            Non-English warnings are translated by Moby and labelled; the agency’s original is one tap away.
          </Text>
        </View>

        <View style={{ gap: spacing.scale[2] }}>
          <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.text.primary }}>Features in this version</Text>
          <View style={card}>
            {FEATURES.map((f) => (
              <View key={f.flag} style={styles.featureRow}>
                <Text variant="bodyMedium" style={[styles.flex, { color: theme.text.primary }]}>{f.label}</Text>
                <Text variant="bodyMedium" style={{ color: isEnabled(f.flag) ? theme.accent.calm : theme.text.faint }}>
                  {isEnabled(f.flag) ? 'On' : 'Coming later'}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ gap: spacing.scale[1] }}>
          <Text style={[typography.meta, muted, { fontVariant: ['tabular-nums'] }]}>
            Version {APP_VERSION}{env.useMock ? ' · demo data' : ''}
          </Text>
          <Text style={[typography.meta, muted]}>
            Free software under the GNU General Public License v3.0.
          </Text>
        </View>

        <Button mode="outlined" icon="play-circle-outline" onPress={onReplayIntro} textColor={theme.text.primary} style={styles.alignStart}>
          Show the introduction again
        </Button>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { borderRadius: 16, padding: spacing.cardPadding, gap: spacing.scale[3] },
  stepRow: { flexDirection: 'row', gap: spacing.scale[3] },
  stepNum: { width: 16, fontVariant: ['tabular-nums'] },
  sourceRow: { gap: 2 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.scale[2] },
  flex: { flex: 1 },
  alignStart: { alignSelf: 'flex-start' },
});
