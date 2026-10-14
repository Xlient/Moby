import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Avatar, Button, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing, typography } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { kv } from '@/lib/storage';

const DONE_KEY = 'onboarding-v1-done';

export function hasSeenOnboarding(): boolean {
  return kv.get(DONE_KEY) === 'true';
}

export function resetOnboarding(): void {
  kv.set(DONE_KEY, 'false');
}

interface Page {
  icon: string;
  title: string;
  body: string;
  points?: { icon: string; label: string; detail: string }[];
}

const PAGES: Page[] = [
  {
    icon: 'shield-check-outline',
    title: 'Early warnings, near you',
    body: 'Moby watches official warnings from weather, earthquake and disaster agencies, and tells you only about the ones that reach you.',
  },
  {
    icon: 'account-group-outline',
    title: 'Reports from people nearby',
    body: 'People can report what they see. Moby always says how sure it is:',
    points: [
      { icon: 'help-circle-outline', label: 'Unverified', detail: 'One report, not checked yet.' },
      { icon: 'account-multiple-check-outline', label: 'Corroborated', detail: 'Several people saw it. A reviewer is checking.' },
      { icon: 'check-decagram-outline', label: 'Confirmed', detail: 'From an agency, or confirmed by a reviewer.' },
    ],
  },
  {
    icon: 'signal-off',
    title: 'Works without signal',
    body: 'Alerts and safety guidance are saved on your phone. Reports you make offline send by themselves when the signal comes back.',
  },
];

/**
 * First-run introduction (sprint 6, for new users and judges): what Moby does, how much to
 * trust each kind of alert, and what works offline. Shown once; replay from Settings → About.
 */
export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const { theme } = useTheme();
  const r = useResponsive();
  const [i, setI] = useState(0);
  const page = PAGES[i]!;
  const last = i === PAGES.length - 1;

  const finish = () => {
    kv.set(DONE_KEY, 'true');
    onDone();
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg.base }]}>
      <View style={[styles.top, { paddingHorizontal: r.gutter }]}>
        {!last && (
          <Button mode="text" onPress={finish} textColor={theme.text.secondary} accessibilityLabel="Skip the introduction">
            Skip
          </Button>
        )}
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingHorizontal: r.gutter }]}>
        <Avatar.Icon size={88} icon={page.icon} color={theme.accent.calm} style={{ backgroundColor: theme.bg.raised }} />
        <Text accessibilityRole="header" style={[typography.title, styles.center, { color: theme.text.primary }]}>
          {page.title}
        </Text>
        <Text variant="bodyLarge" style={[styles.center, { color: theme.text.secondary }]}>
          {page.body}
        </Text>
        {page.points && (
          <View style={[styles.points, { backgroundColor: theme.bg.raised }]}>
            {page.points.map((p) => (
              <View key={p.label} style={styles.point}>
                <Avatar.Icon size={36} icon={p.icon} color={theme.text.primary} style={{ backgroundColor: theme.bg.recessed }} />
                <View style={styles.pointText}>
                  <Text variant="titleSmall" style={{ color: theme.text.primary }}>{p.label}</Text>
                  <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>{p.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      <View style={[styles.footer, { paddingHorizontal: r.gutter }]}>
        <View style={styles.dots} accessibilityLabel={`Page ${i + 1} of ${PAGES.length}`}>
          {PAGES.map((_, n) => (
            <View
              key={n}
              style={[styles.dot, { backgroundColor: n === i ? theme.accent.calm : theme.line.hairline }]}
            />
          ))}
        </View>
        <View style={styles.buttons}>
          {i > 0 && (
            <Button mode="text" onPress={() => setI(i - 1)} textColor={theme.text.primary} contentStyle={styles.tap}>
              Back
            </Button>
          )}
          <Button mode="contained" onPress={last ? finish : () => setI(i + 1)} contentStyle={styles.tap} style={styles.next}>
            {last ? 'Get started' : 'Next'}
          </Button>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  top: { minHeight: 56, alignItems: 'flex-end', justifyContent: 'center' },
  body: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.scale[4], paddingBottom: spacing.scale[4] },
  center: { textAlign: 'center' },
  points: { alignSelf: 'stretch', borderRadius: 16, padding: spacing.cardPadding, gap: spacing.scale[3] },
  point: { flexDirection: 'row', alignItems: 'center', gap: spacing.scale[3] },
  pointText: { flex: 1, gap: 2 },
  footer: { paddingBottom: spacing.scale[5], gap: spacing.scale[4] },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.scale[2] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.scale[2] },
  next: { minWidth: 140 },
  tap: { minHeight: spacing.minTapTarget },
});
