import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Switch, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing, typography } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useMesh } from '@/mesh/useMesh';
import { clearMesh, isMeshAvailable, isMeshEnabled, setMeshEnabled, type MeshStatus } from '@/mesh/meshService';
import { formatTimeAgo } from '@/lib/alerts';
import { SosCalls } from '@/components/SosCalls';

interface NearbyMeshScreenProps {
  onBack: () => void;
}

const STATUS_COPY: Record<MeshStatus, string> = {
  off: 'Off',
  unsupported: 'This phone can’t do this yet (Android only for now).',
  needs_permission: 'Moby needs the “Nearby devices” permission to use Bluetooth.',
  bluetooth_off: 'Bluetooth is off. Turn it on to pass alerts between phones.',
  running: 'On',
};

const HAZARD_LABEL: Record<string, string> = {
  flood: 'Flood', fire: 'Wildfire', earthquake: 'Earthquake', storm: 'Storm', landslide: 'Landslide', other: 'Hazard',
};

/**
 * Settings → Nearby phones: the Bluetooth mesh. With no signal, phones pass short
 * alerts and reports to each other; any phone that has signal uploads the reports
 * and brings official alerts in. See docs/mesh-guide.md.
 */
export function NearbyMeshScreen({ onBack }: NearbyMeshScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const mesh = useMesh();
  const [enabled, setEnabled] = useState(isMeshEnabled);
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const muted = [typography.meta, { color: theme.text.secondary }];
  const label = [typography.body, { color: theme.text.primary }];
  const row = [styles.row, { borderBottomColor: theme.line.hairline }];
  const available = isMeshAvailable();

  async function toggle(on: boolean) {
    setBusy(true);
    setEnabled(on);
    const status = await setMeshEnabled(on);
    if (on && status !== 'running' && status !== 'bluetooth_off') {
      // Couldn't start (no permission, or not supported): don't leave the switch lying.
      await setMeshEnabled(false);
      setEnabled(false);
    }
    setBusy(false);
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Nearby phones" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: r.gutter, gap: spacing.scale[4] }}>
        <Text style={[typography.body, { color: theme.text.secondary }]}>
          When there’s no signal, Moby can pass short alerts and reports from phone to phone over Bluetooth.
          Any phone that has signal sends the reports on and brings official warnings back.
        </Text>

        <View style={[styles.card, { backgroundColor: theme.bg.raised }]}>
          <View style={[row, !enabled && styles.last]}>
            <View style={styles.rowText}>
              <Text style={label}>Share through nearby phones</Text>
              <Text style={muted}>{enabled ? STATUS_COPY[mesh.status] : available ? 'Off' : STATUS_COPY.unsupported}</Text>
            </View>
            <Switch value={enabled} disabled={busy || !available} onValueChange={toggle} accessibilityLabel="Share through nearby phones" />
          </View>
          {enabled && mesh.status === 'running' && (
            <>
              <Stat label="Moby phones nearby" value={mesh.hearingNearby ? 'Yes' : 'None heard'} hint="In the last 2 minutes" />
              <Stat label="Messages this phone is passing on" value={String(mesh.carrying)} />
              <Stat label="Reports waiting for a phone with signal" value={String(mesh.waitingToUpload)} />
              <Stat label="Reports this phone uploaded for others" value={String(mesh.uploaded)} last={!mesh.lastHeardAt} />
              {mesh.lastHeardAt && (
                <Stat label="Last heard a nearby phone" value={formatTimeAgo(new Date(mesh.lastHeardAt).toISOString())} last />
              )}
            </>
          )}
          {enabled && mesh.status === 'bluetooth_off' && (
            <View style={[styles.row, styles.last]}>
              <Button mode="text" onPress={() => Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS').catch(() => {})}>
                Open Bluetooth settings
              </Button>
            </View>
          )}
          {enabled && mesh.status === 'running' && !mesh.canAdvertise && (
            <Text style={[muted, styles.note]}>This phone can listen but can’t send over Bluetooth, so it receives alerts but can’t pass them on.</Text>
          )}
        </View>

        <SosCalls calls={mesh.sosCalls} />

        {mesh.alerts.length > 0 && (
          <View style={{ gap: spacing.scale[2] }}>
            <Text accessibilityRole="header" style={[typography.title, { color: theme.text.primary }]}>
              Official alerts from nearby phones
            </Text>
            {mesh.alerts.map(({ entry, headline }) => {
              const p = entry.packet;
              return (
                <View key={p.id} style={[styles.card, styles.alert, { backgroundColor: theme.bg.raised, borderLeftColor: theme.severity[p.severity] }]}>
                  <Text style={label}>{headline ?? `${HAZARD_LABEL[p.hazard]} warning · ${p.severity}`}</Text>
                  <Text style={muted}>
                    {`Issued ${formatTimeAgo(new Date(p.time * 1000).toISOString())} · near ${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`}
                  </Text>
                  <Text style={muted}>
                    {entry.heardCount === 0 ? 'This phone has signal and is sharing it' : 'Received from nearby phones over Bluetooth'}
                  </Text>
                </View>
              );
            })}
            <Text style={muted}>Short versions only: open Alerts for the full warning once you have signal.</Text>
          </View>
        )}

        <View style={{ gap: spacing.scale[2] }}>
          <Text accessibilityRole="header" style={[typography.title, { color: theme.text.primary }]}>
            What’s shared
          </Text>
          <Text style={muted}>
            Only the hazard type, how severe it is, a location rounded to about 10 m, the time, and an id that changes every day.
            An SOS you send from “I need help” carries your location the same way.
            Never your name, your notes or your phone’s name. Reports from nearby phones are marked unverified until Moby checks them.
          </Text>
          <Text style={muted}>
            While on, it keeps working with Moby in the background, and Android shows a notification so you always know. It uses some extra battery; turn it off here any time.
          </Text>
        </View>

        {enabled && (
          <View style={{ gap: spacing.scale[2] }}>
            <Button mode="text" onPress={() => setShowLog((v) => !v)} style={styles.alignStart} icon={showLog ? 'chevron-up' : 'chevron-down'}>
              {showLog ? 'Hide activity' : 'Show activity'}
            </Button>
            {showLog && (
              <View style={[styles.card, styles.log, { backgroundColor: theme.bg.raised }]}>
                {mesh.lastError && <Text style={[muted, { color: theme.severity.high }]}>{mesh.lastError}</Text>}
                {mesh.log.length === 0 ? (
                  <Text style={muted}>Nothing yet. Bring another phone with Moby close, with this turned on.</Text>
                ) : (
                  mesh.log.map((line, i) => (
                    <Text key={i} style={[muted, styles.mono]}>{line}</Text>
                  ))
                )}
                <Button mode="text" onPress={clearMesh} style={styles.alignStart}>Forget everything this phone is carrying</Button>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, hint, last }: { label: string; value: string; hint?: string; last?: boolean }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: theme.line.hairline }, last && styles.last]}>
      <View style={styles.rowText}>
        <Text style={[typography.body, { color: theme.text.primary }]}>{label}</Text>
        {hint && <Text style={[typography.meta, { color: theme.text.secondary }]}>{hint}</Text>}
      </View>
      <Text style={[typography.body, { color: theme.text.primary, fontWeight: '600' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { borderRadius: 16, paddingHorizontal: spacing.scale[4] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[3],
    paddingVertical: spacing.scale[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  last: { borderBottomWidth: 0 },
  rowText: { flex: 1, gap: spacing.scale[1] },
  note: { paddingBottom: spacing.scale[3] },
  alert: { borderLeftWidth: 4, paddingVertical: spacing.scale[3], gap: spacing.scale[1] },
  log: { paddingVertical: spacing.scale[3], gap: 2 },
  mono: { fontFamily: 'monospace' },
  alignStart: { alignSelf: 'flex-start' },
});
