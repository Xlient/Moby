import { useState } from 'react';
import { Alert as RNAlert, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { radius, spacing } from '@/theme/tokens';
import { useMesh } from '@/mesh/useMesh';
import { isMeshAvailable, sendSafe, sendSos, setMeshEnabled } from '@/mesh/meshService';
import { formatTimeAgo } from '@/lib/alerts';

interface SosPanelProps {
  /** Where the person is (current or last known fix); null while there's none. */
  at: { lat: number; lon: number } | null;
}

/**
 * "Send SOS to nearby phones": a call for help over the Bluetooth mesh. Nearby Moby
 * phones show it and pass it on; a phone with signal uploads it for reviewers (local
 * partners), who decide whether to act.
 *
 * Honest by design: the only feedback is "a nearby phone repeated it", which proves it
 * reached a phone, not that a person saw it. It never says help is coming.
 */
export function SosPanel({ at }: SosPanelProps) {
  const { theme } = useTheme();
  const mesh = useMesh();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saidSafe, setSaidSafe] = useState(false);
  const own = mesh.ownSos;

  if (!isMeshAvailable()) {
    return (
      <View style={[styles.box, { backgroundColor: theme.bg.recessed }]}>
        <Text variant="titleMedium" style={{ color: theme.text.primary }}>SOS to nearby phones</Text>
        <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
          Sending an SOS over Bluetooth works on Android phones only for now.
        </Text>
      </View>
    );
  }

  async function send() {
    setBusy(true);
    setSaidSafe(false);
    setProblem(null);
    let result = await sendSos(at);
    if (result === 'mesh_off') {
      const status = await setMeshEnabled(true);
      result = status === 'running' ? await sendSos(at) : 'mesh_off';
      if (status !== 'running') {
        setProblem(
          status === 'bluetooth_off'
            ? 'Bluetooth is off. Turn it on, then try again.'
            : 'Moby needs the “Nearby devices” permission to send an SOS.',
        );
      }
    }
    if (result === 'no_location') setProblem('Moby needs your location first.');
    setBusy(false);
  }

  function confirmSend() {
    RNAlert.alert(
      'Send SOS to nearby phones?',
      'Your exact location goes to anyone nearby with Moby, and to Moby’s local partners once a phone with signal passes it on. ' +
        'Moby can’t tell whether anyone sees it. Call emergency services if you can.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send SOS', style: 'destructive', onPress: () => void send() },
      ],
    );
  }

  if (own) {
    const repeated = own.heardCount > 0;
    return (
      <View style={[styles.box, { backgroundColor: theme.bg.raised, borderColor: theme.severity.critical }]} accessibilityLiveRegion="polite">
        <Text variant="titleMedium" style={{ color: theme.text.primary }}>Your SOS is going out over Bluetooth</Text>
        <Text variant="bodyLarge" style={{ color: theme.text.primary }}>
          {repeated
            ? 'A nearby Moby phone repeated it, so it has reached at least one phone. That doesn’t mean anyone has seen it.'
            : 'No Moby phone has repeated it yet. Keep Moby open and Bluetooth on; it keeps sending.'}
        </Text>
        <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
          Sent {formatTimeAgo(new Date(own.packet.time * 1000).toISOString())}. Phones repeat it for up to 6 hours.
        </Text>
        <Button
          mode="outlined"
          icon="check-circle-outline"
          disabled={!at}
          onPress={() => {
            if (!at) return;
            setSaidSafe(true);
            void sendSafe(at);
          }}
          style={styles.alignStart}
          textColor={theme.text.primary}
        >
          I’m safe now
        </Button>
      </View>
    );
  }

  return (
    <View style={[styles.box, { backgroundColor: theme.bg.raised, borderColor: theme.line.hairline }]}>
      {saidSafe && (
        <Text variant="bodyMedium" style={{ color: theme.accent.calm }} accessibilityLiveRegion="polite">
          You told nearby phones you’re safe. They stop passing on your SOS when they hear it.
        </Text>
      )}
      <Text variant="titleMedium" style={{ color: theme.text.primary }}>No signal?</Text>
      <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
        Send an SOS with your location to Moby phones nearby over Bluetooth. They pass it on until a phone with signal
        sends it to Moby’s local partners. It doesn’t call emergency services.
      </Text>
      <Button
        mode="contained"
        icon="access-point"
        onPress={confirmSend}
        loading={busy}
        disabled={busy || !at}
        buttonColor={theme.severity.critical}
        textColor="#FFFFFF"
        contentStyle={styles.buttonContent}
      >
        Send SOS to nearby phones
      </Button>
      {problem ? <Text variant="bodyMedium" style={{ color: theme.severity.critical }}>{problem}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    padding: spacing.scale[4],
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.scale[2],
  },
  buttonContent: { minHeight: 56 },
  alignStart: { alignSelf: 'flex-start' },
});
