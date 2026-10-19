import { useState } from 'react';
import { Alert as RNAlert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, ProgressBar, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing, typography } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { ScreenHeader } from '@/components/ScreenHeader';
import { deleteModel, isOnWifi, NANO_MODEL, pauseDownload, startDownload } from '@/ondevice/model';
import { useModelState } from '@/ondevice/useModel';

interface OfflineAnswersScreenProps {
  onBack: () => void;
}

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

/**
 * Settings → Offline answers: download NVIDIA Nemotron 3 Nano 4B so Ask Moby can answer
 * with no signal, from the safety guidance saved on the phone.
 */
export function OfflineAnswersScreen({ onBack }: OfflineAnswersScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const state = useModelState();
  const [busy, setBusy] = useState(false);
  const muted = [typography.meta, { color: theme.text.secondary }];
  const body = [typography.body, { color: theme.text.primary }];

  async function download() {
    const go = () => {
      setBusy(true);
      void startDownload().finally(() => setBusy(false));
    };
    if (await isOnWifi()) return go();
    RNAlert.alert(
      'You’re not on Wi-Fi',
      `The offline model is ${gb(NANO_MODEL.bytes)}. Downloading it over mobile data may cost money.`,
      [
        { text: 'Wait for Wi-Fi', style: 'cancel' },
        { text: 'Use mobile data', onPress: go },
      ],
    );
  }

  function remove() {
    RNAlert.alert('Delete the offline model?', `This frees ${gb(NANO_MODEL.bytes)}. Saved safety guidance stays.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteModel() },
    ]);
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Offline answers" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: r.gutter, gap: spacing.scale[4] }}>
        <Text style={[typography.body, { color: theme.text.secondary }]}>
          With no signal, Ask Moby can still answer on your phone using {NANO_MODEL.name}. It answers only from the
          safety guidance saved on your phone, shows which guidance it used, and says so when it doesn’t know.
        </Text>

        <View style={[styles.card, { backgroundColor: theme.bg.raised }]}>
          {state.kind === 'unsupported' && <Text style={body}>{state.reason}</Text>}

          {state.kind === 'not_downloaded' && (
            <>
              <Text style={body}>Not downloaded</Text>
              <Text style={muted}>{gb(NANO_MODEL.bytes)} download. Wi-Fi recommended. You can pause and resume.</Text>
              <Button mode="contained" icon="download" onPress={download} disabled={busy} style={styles.alignStart}>
                Download ({gb(NANO_MODEL.bytes)})
              </Button>
            </>
          )}

          {state.kind === 'downloading' && (
            <>
              <Text style={body}>{state.paused ? 'Paused' : 'Downloading…'}</Text>
              <ProgressBar progress={state.total ? state.received / state.total : 0} color={theme.accent.calm} />
              <Text style={muted}>
                {gb(state.received)} of {gb(state.total)} ({Math.floor((100 * state.received) / Math.max(1, state.total))}%)
              </Text>
              {state.paused ? (
                <Button mode="contained" icon="play" onPress={download} style={styles.alignStart}>
                  Resume
                </Button>
              ) : (
                <Button mode="outlined" icon="pause" onPress={() => void pauseDownload()} style={styles.alignStart}>
                  Pause
                </Button>
              )}
            </>
          )}

          {state.kind === 'ready' && (
            <>
              <Text style={body}>Ready: Ask Moby works offline</Text>
              <Text style={muted}>
                Answers take about 10–20 seconds on a phone. The saved guidance shows straight away while it works.
              </Text>
              <Button mode="text" onPress={remove} textColor={theme.text.secondary} style={styles.alignStart}>
                Delete the model ({gb(NANO_MODEL.bytes)})
              </Button>
            </>
          )}

          {state.kind === 'error' && (
            <>
              <Text style={[body, { color: theme.severity.high }]}>{state.message}</Text>
              <Button mode="contained" onPress={download} style={styles.alignStart}>
                Try again
              </Button>
            </>
          )}
        </View>

        <View style={{ gap: spacing.scale[2] }}>
          <Text style={muted}>
            Runs entirely on your phone: your questions never leave it. Uses the processor while answering, so it
            uses some battery.
          </Text>
          <Text style={muted}>
            Model by NVIDIA, from NVIDIA’s Hugging Face page, under the {NANO_MODEL.license}. It doesn’t replace
            emergency services or official instructions.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { borderRadius: 16, padding: spacing.scale[4], gap: spacing.scale[3] },
  alignStart: { alignSelf: 'flex-start' },
});
