import type { ReactNode } from 'react';
import { View, ScrollView, Pressable, Switch, StyleSheet } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing, radius } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { ALL_HAZARDS, useAlertPreferences } from '@/hooks/useAlertPreferences';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SeverityIndicator } from '@/components/SeverityIndicator';
import { hazardIcon } from '@/lib/alerts';
import type { HazardType, Severity } from '@/api/types';

interface AlertPreferencesScreenProps {
  onBack: () => void;
}

const HAZARD_LABELS: Record<HazardType, { title: string; detail: string }> = {
  flood: { title: 'Floods', detail: 'Flash floods, river and coastal flooding, storm surge' },
  fire: { title: 'Fires', detail: 'Wildfires and red flag (fire weather) warnings' },
  earthquake: { title: 'Earthquakes', detail: 'Magnitude 2.5 and up' },
  storm: { title: 'Storms and wind', detail: 'Thunderstorms, tornadoes, hurricanes, winter storms' },
  landslide: { title: 'Landslides', detail: 'Debris flows, mudslides, avalanches' },
  other: { title: 'Other', detail: 'Heat, fog, air quality and everything else' },
};

const SEVERITY_CHOICES: { value: Severity; label: string }[] = [
  { value: 'low', label: 'Everything' },
  { value: 'medium', label: 'Medium and above' },
  { value: 'high', label: 'High and above' },
  { value: 'critical', label: 'Critical only' },
];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const { theme } = useTheme();
  const r = useResponsive();
  return (
    <View style={{ marginBottom: r.sectionGap }}>
      <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.text.primary }}>
        {title}
      </Text>
      {hint && (
        <Text variant="bodyMedium" style={[styles.hint, { color: theme.text.secondary }]}>
          {hint}
        </Text>
      )}
      <View style={[styles.card, { backgroundColor: theme.bg.raised, paddingHorizontal: r.cardPadding }]}>
        {children}
      </View>
    </View>
  );
}

/** A row whose whole area toggles its switch (bigger target than the switch alone). */
function SwitchRow({
  icon,
  title,
  detail,
  value,
  disabled,
  hint,
  onChange,
}: {
  icon: string;
  title: string;
  detail: string;
  value: boolean;
  disabled?: boolean;
  hint?: string;
  onChange: (next: boolean) => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={() => !disabled && onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={title}
      accessibilityHint={hint}
      style={styles.row}
    >
      <Icon source={icon} size={24} color={theme.text.secondary} />
      <View style={styles.rowText}>
        <Text variant="bodyLarge" style={{ color: theme.text.primary }}>
          {title}
        </Text>
        <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
          {detail}
        </Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        // The row carries the accessible switch; don't announce it twice.
        accessibilityElementsHidden
        importantForAccessibility="no"
        trackColor={{ false: theme.line.hairline, true: theme.accent.calm }}
        thumbColor={theme.bg.raised}
      />
    </Pressable>
  );
}

function Divider({ show }: { show: boolean }) {
  const { theme } = useTheme();
  return show ? <View style={[styles.divider, { backgroundColor: theme.line.hairline }]} /> : null;
}

export function AlertPreferencesScreen({ onBack }: AlertPreferencesScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const [prefs, setPrefs] = useAlertPreferences();
  const hazards = prefs.hazard_types ?? [...ALL_HAZARDS];

  const toggleHazard = (h: HazardType, on: boolean) => {
    const next = on ? [...hazards, h] : hazards.filter((x) => x !== h);
    if (next.length === 0) return; // at least one type stays on
    setPrefs({ ...prefs, hazard_types: next });
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Alert types" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: r.gutter, paddingBottom: r.sectionGap }}>
        <Text variant="bodyLarge" style={[styles.intro, { color: theme.text.secondary }]}>
          Choose what you want to hear about. Your home screen, the map and notifications all follow
          these settings. Critical alerts near you always come through, whatever you pick here.
        </Text>

        <Section title="Hazards" hint="Keep at least one on. Critical alerts show for every type.">
          {ALL_HAZARDS.map((h, i) => {
            const on = hazards.includes(h);
            const isLastOn = on && hazards.length === 1;
            return (
              <View key={h}>
                <Divider show={i > 0} />
                <SwitchRow
                  icon={hazardIcon(h)}
                  title={HAZARD_LABELS[h].title}
                  detail={HAZARD_LABELS[h].detail}
                  value={on}
                  disabled={isLastOn}
                  hint={isLastOn ? 'At least one hazard type must stay on' : undefined}
                  onChange={(v) => toggleHazard(h, v)}
                />
              </View>
            );
          })}
        </Section>

        <Section title="How serious" hint="Lower levels include advisories that rarely need action.">
          <View accessibilityRole="radiogroup">
            {SEVERITY_CHOICES.map((choice, i) => {
              const selected = prefs.min_severity === choice.value;
              return (
                <View key={choice.value}>
                  <Divider show={i > 0} />
                  <Pressable
                    onPress={() => setPrefs({ ...prefs, min_severity: choice.value })}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={choice.label}
                    style={styles.row}
                  >
                    <View style={styles.rowText}>
                      <Text
                        variant="bodyLarge"
                        style={{ color: theme.text.primary, fontWeight: selected ? '600' : '400' }}
                      >
                        {choice.label}
                      </Text>
                    </View>
                    {choice.value !== 'low' && <SeverityIndicator severity={choice.value} size="small" />}
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
        </Section>

        <Section title="On the water">
          <SwitchRow
            icon="sail-boat"
            title="Marine alerts"
            detail="Small craft advisories, gale warnings and other offshore forecasts. Turn on if you boat, kayak or fish. Beach hazards like rip currents always show."
            value={prefs.include_marine}
            onChange={(v) => setPrefs({ ...prefs, include_marine: v })}
          />
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  intro: {
    marginBottom: spacing.sectionGap,
  },
  hint: {
    marginTop: spacing.scale[0],
  },
  card: {
    borderRadius: radius.card,
    marginTop: spacing.scale[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[3],
    minHeight: spacing.minTapTarget + spacing.scale[2],
    paddingVertical: spacing.scale[2],
  },
  rowText: {
    flex: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});
