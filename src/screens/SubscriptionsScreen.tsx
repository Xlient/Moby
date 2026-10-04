import { useState } from 'react';
import { View, ScrollView, Pressable, TextInput, StyleSheet } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useSubscriptions } from '@/hooks/useSubscriptions';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useUserCenter } from '@/location/UserLocationContext';
import type { Severity } from '@/api/types';

interface SubscriptionsScreenProps {
  onBack: () => void;
}

const AREA_RADII = [5, 10, 25, 50, 100] as const;
const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function describe(radiusKm: number, minSeverity: Severity): string {
  const severity = minSeverity === 'low' ? 'All alerts' : `${capitalize(minSeverity)} and above`;
  return `Within ${radiusKm} km · ${severity}`;
}

function OptionRow<T extends string | number>({
  label,
  options,
  selected,
  format,
  onSelect,
}: {
  label: string;
  options: readonly T[];
  selected: T;
  format: (option: T) => string;
  onSelect: (option: T) => void;
}) {
  const { theme } = useTheme();
  return (
    <View>
      <Text variant="labelMedium" style={[styles.fieldLabel, { color: theme.text.secondary }]}>
        {label}
      </Text>
      <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => {
          const isSelected = option === selected;
          return (
            <Pressable
              key={String(option)}
              onPress={() => onSelect(option)}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              style={[
                styles.option,
                {
                  backgroundColor: isSelected ? theme.bg.recessed : 'transparent',
                  borderColor: isSelected ? theme.text.secondary : theme.line.hairline,
                },
              ]}
            >
              <Text
                variant="bodyMedium"
                style={{
                  color: isSelected ? theme.text.primary : theme.text.secondary,
                  fontWeight: isSelected ? '600' : '400',
                  fontVariant: ['tabular-nums'],
                }}
              >
                {format(option)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function AddAreaForm({ onDone }: { onDone: () => void }) {
  const center = useUserCenter();
  const { theme } = useTheme();
  const r = useResponsive();
  const { addSubscription } = useSubscriptions();
  const [label, setLabel] = useState('');
  const [radiusKm, setRadiusKm] = useState<(typeof AREA_RADII)[number]>(25);
  const [minSeverity, setMinSeverity] = useState<Severity>('medium');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const trimmed = label.trim();
    if (!trimmed) {
      setError('Give this area a name, like “Home” or “Trailhead”.');
      return;
    }
    // Not awaited: Firestore applies the write locally at once (the list updates
    // immediately) and syncs when there's signal, so offline adds don't hang here.
    addSubscription({
      region: 'US',
      label: trimmed,
      // A new area is centred where the phone is now (no place search yet).
      center: { lat: center.lat, lon: center.lon, frame: 'WGS84' },
      radius_km: radiusKm,
      min_severity: minSeverity,
    }).catch(() => setError('Could not save this area. Try again.'));
    onDone();
  };

  return (
    <View style={[styles.card, styles.form, { backgroundColor: theme.bg.raised, padding: r.cardPadding }]}>
      <Text variant="titleMedium" style={{ color: theme.text.primary }}>
        New area
      </Text>

      <View>
        <Text variant="labelMedium" style={[styles.fieldLabel, { color: theme.text.secondary }]} nativeID="area-name-label">
          Name
        </Text>
        <TextInput
          style={[
            typography.body,
            styles.input,
            { backgroundColor: theme.bg.recessed, borderColor: theme.line.hairline, color: theme.text.primary },
          ]}
          accessibilityLabelledBy="area-name-label"
          accessibilityLabel="Area name"
          placeholder="Home, cabin, trailhead…"
          placeholderTextColor={theme.text.faint}
          value={label}
          onChangeText={(t) => {
            setLabel(t);
            setError(null);
          }}
          maxLength={60}
          returnKeyType="done"
        />
        <Text variant="bodyMedium" style={[styles.hint, { color: theme.text.secondary }]}>
          Centered on your current location.
        </Text>
      </View>

      <OptionRow
        label="Watch within"
        options={AREA_RADII}
        selected={radiusKm}
        format={(km) => `${km} km`}
        onSelect={setRadiusKm}
      />

      <OptionRow
        label="Tell me about"
        options={SEVERITIES}
        selected={minSeverity}
        format={(s) => (s === 'low' ? 'Everything' : `${capitalize(s)}+`)}
        onSelect={setMinSeverity}
      />

      {error && (
        <Text accessibilityRole="alert" variant="bodyMedium" style={{ color: theme.text.primary }}>
          {error}
        </Text>
      )}

      <View style={styles.formActions}>
        <Button mode="text" onPress={onDone} textColor={theme.text.secondary} contentStyle={styles.buttonContent}>
          Cancel
        </Button>
        <Button mode="contained-tonal" onPress={save} contentStyle={styles.buttonContent}>
          Save area
        </Button>
      </View>
    </View>
  );
}

export function SubscriptionsScreen({ onBack }: SubscriptionsScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const { subscriptions, loading, error, canEdit, deleteSubscription } = useSubscriptions();
  const [adding, setAdding] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const remove = (id: string) => {
    setDeleteError(null);
    deleteSubscription(id).catch(() => setDeleteError('Could not remove that area. Try again.'));
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Watched areas" onBack={onBack} />

      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: r.gutter, paddingBottom: r.sectionGap }}
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="bodyLarge" style={[styles.intro, { color: theme.text.secondary }]}>
          We watch these areas for you and alert you when something nearby needs attention.
        </Text>

        {loading && (
          <Text variant="bodyLarge" style={{ color: theme.text.secondary }}>
            Loading your areas…
          </Text>
        )}
        {(error || deleteError) && (
          <Text variant="bodyLarge" style={[styles.intro, { color: theme.text.primary }]}>
            {error || deleteError}
          </Text>
        )}

        {!loading && !error && subscriptions.length === 0 && !adding && (
          <View style={[styles.card, { backgroundColor: theme.bg.recessed, padding: r.cardPadding }]}>
            <Text variant="titleMedium" style={{ color: theme.text.primary }}>
              No areas yet
            </Text>
            <Text variant="bodyLarge" style={[styles.hint, { color: theme.text.secondary }]}>
              Add home, a cabin or a trail you’re heading to, and we’ll keep an eye on it.
            </Text>
          </View>
        )}

        {subscriptions.map((sub) => (
          <View
            key={sub.subscription_id}
            style={[styles.card, styles.row, { backgroundColor: theme.bg.raised, padding: r.cardPadding }]}
          >
            <View style={styles.rowText}>
              <Text variant="titleMedium" style={{ color: theme.text.primary }}>
                {sub.label ?? 'Unnamed area'}
              </Text>
              <Text
                variant="bodyMedium"
                style={[styles.hint, { color: theme.text.secondary, fontVariant: ['tabular-nums'] }]}
              >
                {describe(sub.radius_km, sub.min_severity)}
              </Text>
            </View>
            {canEdit && (
              <Button
                mode="text"
                onPress={() => remove(sub.subscription_id)}
                textColor={theme.text.secondary}
                contentStyle={styles.buttonContent}
                accessibilityLabel={`Remove ${sub.label ?? 'this area'}`}
              >
                Remove
              </Button>
            )}
          </View>
        ))}

        {adding && <AddAreaForm onDone={() => setAdding(false)} />}

        {!adding && canEdit && (
          <Button
            mode="contained-tonal"
            icon="plus"
            onPress={() => setAdding(true)}
            style={styles.addButton}
            contentStyle={styles.buttonContent}
          >
            Add an area
          </Button>
        )}

        {!canEdit && !loading && (
          <Text variant="bodyMedium" style={[styles.hint, { color: theme.text.secondary }]}>
            Sample areas. Sign in to save your own.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  intro: {
    marginBottom: spacing.scale[4],
  },
  card: {
    borderRadius: radius.card,
    marginBottom: spacing.scale[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[2],
  },
  rowText: {
    flex: 1,
  },
  hint: {
    marginTop: spacing.scale[0],
  },
  form: {
    gap: spacing.scale[4],
  },
  fieldLabel: {
    marginBottom: spacing.scale[1],
  },
  input: {
    minHeight: spacing.minTapTarget,
    paddingVertical: spacing.scale[2],
    paddingHorizontal: spacing.scale[3],
    borderWidth: 1,
    borderRadius: radius.input,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.scale[1],
  },
  option: {
    minHeight: spacing.minTapTarget,
    minWidth: spacing.minTapTarget,
    paddingHorizontal: spacing.scale[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.scale[1],
  },
  buttonContent: {
    minHeight: spacing.minTapTarget,
  },
  addButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.scale[2],
  },
});
