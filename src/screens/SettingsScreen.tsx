import { useEffect, useState, type ReactNode } from 'react';
import { View, ScrollView, Pressable, Switch, TextInput, StyleSheet } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import Constants from 'expo-constants';
import { useTheme } from '@/theme/ThemeContext';
import { useMapEngine } from '@/maps/mapEngine';
import { typography, spacing, radius } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useAuth } from '@/auth/AuthContext';
import { useNearbyRadius } from '@/hooks/useNearbyRadius';
import { ALL_HAZARDS, useAlertPreferences } from '@/hooks/useAlertPreferences';
import type { AlertPreferences } from '@/api/types';
import { useSubscriptions } from '@/hooks/useSubscriptions';
import { RadiusPicker } from '@/components/RadiusPicker';

interface SettingsScreenProps {
  onSubscriptions: () => void;
  onAlertPreferences: () => void;
  onCardReview?: () => void;
  onTrustReview?: () => void;
}

const APP_VERSION = Constants.expoConfig?.version ?? '0.1.0';

/** "All types", "3 types, high and up", "5 types, critical only, marine"… */
function summarizeAlertPreferences(p: AlertPreferences): string {
  const count = (p.hazard_types ?? ALL_HAZARDS).length;
  const parts = [count === ALL_HAZARDS.length ? 'All types' : `${count} type${count === 1 ? '' : 's'}`];
  if (p.min_severity === 'critical') parts.push('critical only');
  else if (p.min_severity !== 'low') parts.push(`${p.min_severity} and up`);
  if (p.include_marine) parts.push('marine');
  return parts.join(', ');
}

function Row({ children, last = false }: { children: ReactNode; last?: boolean }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line.hairline },
      ]}
    >
      {children}
    </View>
  );
}

/** A full-width row that opens something: label on the left, value + chevron on the right. */
function LinkRow({
  label,
  value,
  onPress,
  last,
}: {
  label: string;
  value?: string;
  onPress: () => void;
  last?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Row last={last}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}, ${value}` : label}
        style={styles.linkRow}
      >
        <Text style={[typography.body, styles.flexShrink, { color: theme.text.primary }]}>{label}</Text>
        <View style={styles.linkValue}>
          {value && <Text style={[typography.body, { color: theme.text.secondary }]}>{value}</Text>}
          <Icon source="chevron-right" size={20} color={theme.text.faint} />
        </View>
      </Pressable>
    </Row>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { theme } = useTheme();
  const r = useResponsive();
  return (
    <View style={{ marginBottom: r.sectionGap }}>
      <Text
        accessibilityRole="header"
        style={[r.heading, styles.sectionHeading, { color: theme.text.primary }]}
      >
        {title}
      </Text>
      <View style={[styles.card, { backgroundColor: theme.bg.raised, paddingHorizontal: r.cardPadding }]}>
        {children}
      </View>
    </View>
  );
}

function NameRow() {
  const { theme } = useTheme();
  const { profile, user, updateName } = useAuth();
  const current = profile?.display_name ?? user?.displayName ?? '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(current);
  }, [current, editing]);

  if (!editing) {
    return (
      <LinkRow label="Name" value={current || 'Add your name'} onPress={() => setEditing(true)} />
    );
  }

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateName(draft);
      setEditing(false);
    } catch {
      setError('Could not save your name. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Row>
      <View style={styles.nameEditor}>
        <Text variant="labelMedium" nativeID="settings-name-label" style={{ color: theme.text.secondary }}>
          First name — used to greet you
        </Text>
        <TextInput
          style={[
            typography.body,
            styles.input,
            { backgroundColor: theme.bg.recessed, borderColor: theme.line.hairline, color: theme.text.primary },
          ]}
          accessibilityLabelledBy="settings-name-label"
          accessibilityLabel="First name"
          autoFocus
          autoCapitalize="words"
          autoComplete="given-name"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={save}
          maxLength={80}
          returnKeyType="done"
          editable={!saving}
        />
        {error && (
          <Text accessibilityRole="alert" style={[typography.meta, { color: theme.text.primary }]}>
            {error}
          </Text>
        )}
        <View style={styles.editorActions}>
          <Button mode="text" onPress={() => setEditing(false)} textColor={theme.text.secondary} disabled={saving}>
            Cancel
          </Button>
          <Button mode="contained-tonal" onPress={save} loading={saving} disabled={saving}>
            Save
          </Button>
        </View>
      </View>
    </Row>
  );
}

export function SettingsScreen({ onSubscriptions, onAlertPreferences, onCardReview, onTrustReview }: SettingsScreenProps) {
  const [mapEngine, setMapEngine] = useMapEngine();
  const { theme, isDark, toggleTheme } = useTheme();
  const r = useResponsive();
  const { user, isConfigured, signOut } = useAuth();
  const [radiusKm, setRadiusKm] = useNearbyRadius();
  const [alertPrefs] = useAlertPreferences();
  const { subscriptions } = useSubscriptions();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const rowLabel = [typography.body, { color: theme.text.primary }];
  const rowValue = [typography.body, { color: theme.text.secondary }];

  const areasValue =
    subscriptions.length === 0 ? 'None yet' : `${subscriptions.length} area${subscriptions.length === 1 ? '' : 's'}`;

  return (
    <>
      <ScrollView style={styles.flex} contentContainerStyle={{ padding: r.gutter }}>
        <Text
          accessibilityRole="header"
          style={[r.title, { color: theme.text.primary, marginBottom: r.sectionGap }]}
        >
          Settings
        </Text>

        {isConfigured && user && (
          <Section title="Account">
            <NameRow />
            <Row>
              <Text style={rowLabel}>Email</Text>
              <Text style={[rowValue, styles.flexShrink]} numberOfLines={1} ellipsizeMode="middle">
                {user.email}
              </Text>
            </Row>
            <Row last>
              <Pressable
                accessibilityRole="button"
                style={styles.rowBtn}
                disabled={signingOut}
                onPress={async () => {
                  setSigningOut(true);
                  try {
                    await signOut();
                  } catch {
                    setSigningOut(false);
                  }
                }}
              >
                <Text style={rowLabel}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
              </Pressable>
            </Row>
          </Section>
        )}

        <Section title="Alerts">
          <LinkRow label="Alert types" value={summarizeAlertPreferences(alertPrefs)} onPress={onAlertPreferences} />
          <LinkRow label="Nearby radius" value={`${radiusKm} km`} onPress={() => setPickerVisible(true)} />
          <LinkRow label="Watched areas" value={areasValue} onPress={onSubscriptions} last />
        </Section>

        <Section title="Appearance">
          <Row>
            <View style={{ flex: 1 }}>
              <Text style={rowLabel}>Terrain map (preview)</Text>
              <Text style={rowValue}>Open-source maps with terrain, warning areas and offline download</Text>
            </View>
            <Switch
              value={mapEngine === 'maplibre'}
              onValueChange={(on) => setMapEngine(on ? 'maplibre' : 'google')}
              accessibilityLabel="Terrain map preview"
              trackColor={{ false: theme.line.hairline, true: theme.accent.calm }}
              thumbColor={theme.bg.raised}
            />
          </Row>
          <Row last>
            <Text style={rowLabel}>Dark mode</Text>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              accessibilityLabel="Dark mode"
              trackColor={{ false: theme.line.hairline, true: theme.accent.calm }}
              thumbColor={theme.bg.raised}
            />
          </Row>
        </Section>

        <Section title="About">
          <Row>
            <Text style={rowLabel}>Version</Text>
            <Text style={rowValue}>{APP_VERSION}</Text>
          </Row>
          <Row last>
            <Text style={rowLabel}>Region</Text>
            <Text style={rowValue}>US</Text>
          </Row>
        </Section>

        {__DEV__ && (onCardReview || onTrustReview) && (
          <Section title="Developer">
            {onCardReview && (
              <LinkRow label="Alert card review" onPress={onCardReview} last={!onTrustReview} />
            )}
            {onTrustReview && <LinkRow label="Trust treatments review" onPress={onTrustReview} last />}
          </Section>
        )}

        <Text style={[typography.meta, { color: theme.text.secondary, marginBottom: r.sectionGap }]}>
          Data from NOAA, USGS and community reports. Not a replacement for official warnings.
        </Text>
      </ScrollView>

      <RadiusPicker
        visible={pickerVisible}
        selected={radiusKm}
        onSelect={(value) => {
          setRadiusKm(value);
          setPickerVisible(false);
        }}
        onDismiss={() => setPickerVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  flexShrink: {
    flexShrink: 1,
  },
  sectionHeading: {
    marginBottom: spacing.scale[3],
  },
  card: {
    borderRadius: radius.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.scale[3],
    minHeight: spacing.minTapTarget,
    paddingVertical: spacing.scale[2],
  },
  rowBtn: {
    flex: 1,
    minHeight: spacing.minTapTarget,
    justifyContent: 'center',
  },
  linkRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.scale[3],
    minHeight: spacing.minTapTarget,
  },
  linkValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[0],
  },
  nameEditor: {
    flex: 1,
    gap: spacing.scale[2],
  },
  input: {
    minHeight: spacing.minTapTarget,
    paddingVertical: spacing.scale[2],
    paddingHorizontal: spacing.scale[3],
    borderWidth: 1,
    borderRadius: radius.input,
  },
  editorActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.scale[1],
  },
});
