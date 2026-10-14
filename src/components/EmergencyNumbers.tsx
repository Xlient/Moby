import { Alert as RNAlert, Linking, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing } from '@/theme/tokens';
import { emergencyFor, type EmergencyNumbers as Numbers } from '@/data/emergencyNumbers';

interface Props {
  /** ISO country code (the alert's, or where the phone is). */
  country: string | undefined;
}

function call(number: string, label: string) {
  // Confirm first: a mis-tap must never dial emergency services.
  RNAlert.alert(`Call ${number}?`, `This calls ${label}.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: `Call ${number}`, style: 'destructive', onPress: () => Linking.openURL(`tel:${number}`).catch(() => {}) },
  ]);
}

function lines(n: Numbers): { label: string; number: string }[] {
  if (n.general) {
    const out = [{ label: 'Emergency (ambulance, fire, police)', number: n.general }];
    if (n.ambulance && n.ambulance !== n.general) out.push({ label: 'Ambulance', number: n.ambulance });
    if (n.fire && n.fire !== n.general) out.push({ label: 'Fire', number: n.fire });
    if (n.touristPolice) out.push({ label: 'Tourist police', number: n.touristPolice });
    return out;
  }
  const out: { label: string; number: string }[] = [];
  if (n.ambulance && n.ambulance === n.fire) out.push({ label: 'Ambulance and fire', number: n.ambulance });
  else {
    if (n.ambulance) out.push({ label: 'Ambulance', number: n.ambulance });
    if (n.fire) out.push({ label: 'Fire', number: n.fire });
  }
  if (n.police) out.push({ label: 'Police', number: n.police });
  if (n.touristPolice) out.push({ label: 'Tourist police', number: n.touristPolice });
  return out;
}

/** Local emergency numbers, offline, with tap-to-call (confirmed). Renders nothing for unknown countries. */
export function EmergencyNumbers({ country }: Props) {
  const { theme } = useTheme();
  const n = emergencyFor(country);
  if (!n) return null;
  return (
    <View
      style={[styles.box, { backgroundColor: theme.bg.raised, borderColor: theme.line.hairline }]}
      accessibilityLabel={`Emergency numbers in ${n.name}`}
    >
      <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.text.primary }}>
        Emergency numbers in {n.name}
      </Text>
      {lines(n).map(({ label, number }) => (
        <View key={label} style={styles.row}>
          <Text variant="bodyMedium" style={[styles.label, { color: theme.text.secondary }]}>{label}</Text>
          <Button
            mode="outlined"
            icon="phone"
            onPress={() => call(number, `${label.toLowerCase()} in ${n.name}`)}
            textColor={theme.text.primary}
            accessibilityLabel={`Call ${label} ${number}`}
          >
            {number}
          </Button>
        </View>
      ))}
      {n.note ? <Text variant="bodySmall" style={{ color: theme.text.secondary }}>{n.note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: spacing.scale[3],
    padding: spacing.scale[3],
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.scale[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.scale[2],
  },
  label: {
    flex: 1,
  },
});
