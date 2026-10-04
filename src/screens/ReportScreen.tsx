import { useMemo, useState } from 'react';
import { View, ScrollView, Pressable, TextInput, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import type { Theme } from '@/theme/tokens';
import { typography, spacing, radius } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { isFresh, useDeviceLocation } from '@/hooks/useDeviceLocation';
import { useQueuedReport } from '@/hooks/useReportQueue';
import { SeverityIndicator } from '@/components/SeverityIndicator';
import { ScreenHeader } from '@/components/ScreenHeader';
import { enqueueReport, flushReportQueue, newClientEventId } from '@/lib/reportQueue';
import { formatTimeAgo, hazardIcon } from '@/lib/alerts';
import type { HazardType, ObservedEffect, Severity } from '@/api/types';

interface ReportScreenProps {
  onBack: () => void;
}

type Step = 'hazard' | 'severity' | 'confirm' | 'sent';

const HAZARDS: { value: HazardType; label: string }[] = [
  { value: 'flood', label: 'Flooding' },
  { value: 'fire', label: 'Fire or smoke' },
  { value: 'landslide', label: 'Landslide' },
  { value: 'storm', label: 'Storm or wind' },
  { value: 'earthquake', label: 'Earthquake' },
  { value: 'other', label: 'Something else' },
];

const SEVERITIES: { value: Severity; detail: string }[] = [
  { value: 'low', detail: 'Worth keeping an eye on' },
  { value: 'medium', detail: 'Could affect people nearby' },
  { value: 'high', detail: 'Dangerous right now' },
  { value: 'critical', detail: 'Life-threatening — act now' },
];

const EFFECTS: { value: ObservedEffect; label: string }[] = [
  { value: 'rising_water', label: 'Rising water' },
  { value: 'smoke_or_fire_visible', label: 'Smoke or flames' },
  { value: 'ground_shaking', label: 'Shaking' },
  { value: 'blocked_road', label: 'Blocked road or trail' },
  { value: 'structural_damage', label: 'Damage to buildings' },
  { value: 'other', label: 'Something else' },
];

const NOTE_MAX = 1000;

function Tile({ icon, label, onPress, theme }: { icon: string; label: string; onPress: () => void; theme: Theme }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: pressed ? theme.bg.recessed : theme.bg.raised, borderColor: theme.line.hairline },
      ]}
    >
      <Icon source={icon} size={32} color={theme.text.primary} />
      <Text variant="bodyLarge" style={[styles.tileLabel, { color: theme.text.primary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function LocationCard({
  theme,
  status,
  fix,
  onRetry,
}: {
  theme: Theme;
  status: ReturnType<typeof useDeviceLocation>['status'];
  fix: ReturnType<typeof useDeviceLocation>['fix'];
  onRetry: () => void;
}) {
  let title = 'Finding your location…';
  let detail = 'This can take a moment outdoors.';
  let actionable = false;
  if (fix) {
    title = isFresh(fix) ? 'Your current location' : `Last known location, ${formatTimeAgo(fix.at)}`;
    detail = fix.accuracyM != null ? `Accurate to about ${Math.round(fix.accuracyM)} m` : 'Accuracy unknown';
  } else if (status === 'denied') {
    title = 'Location is off for Moby';
    detail = 'Moby needs your location to place the report. Allow it, then try again.';
    actionable = true;
  } else if (status === 'unavailable') {
    title = 'Can’t find your location';
    detail = 'Check that location is on, or move somewhere with a clearer view of the sky.';
    actionable = true;
  }
  return (
    <View style={[styles.card, { backgroundColor: theme.bg.raised }]}>
      <View style={styles.cardRow}>
        <Icon source={fix ? 'crosshairs-gps' : 'crosshairs-question'} size={24} color={theme.text.secondary} />
        <View style={styles.flex}>
          <Text variant="bodyLarge" style={{ color: theme.text.primary }}>
            {title}
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.text.secondary, fontVariant: ['tabular-nums'] }}>
            {detail}
          </Text>
        </View>
      </View>
      {actionable && (
        <Button mode="text" onPress={onRetry} style={styles.alignStart} contentStyle={styles.tapTarget}>
          Try again
        </Button>
      )}
    </View>
  );
}

function SentState({ theme, clientEventId, onDone }: { theme: Theme; clientEventId: string; onDone: () => void }) {
  const entry = useQueuedReport(clientEventId);
  const isOnline = useOnlineStatus();
  const state = entry?.state ?? 'queued';

  const copy = {
    queued: {
      icon: 'cloud-upload-outline',
      title: 'Saved on your phone',
      body: isOnline
        ? 'Sending as soon as the connection allows. You can close this screen.'
        : 'Queued — will send when you have signal. You can close this screen.',
    },
    sending: { icon: 'cloud-upload-outline', title: 'Sending…', body: 'Your report is on its way.' },
    received: {
      icon: 'check-circle-outline',
      title: 'Report received',
      body: 'Thank you. We’re checking it against other reports and official sources. Reviewers see it before anyone else does.',
    },
    rejected: {
      icon: 'alert-circle-outline',
      title: 'This report wasn’t accepted',
      body: entry?.error ? `The server said: ${entry.error}` : 'Please check the details and try again.',
    },
  }[state];

  return (
    <View style={styles.sent} accessibilityLiveRegion="polite">
      <Icon source={copy.icon} size={48} color={state === 'received' ? theme.accent.calm : theme.text.secondary} />
      <Text variant="titleLarge" accessibilityRole="header" style={[styles.sentTitle, { color: theme.text.primary }]}>
        {copy.title}
      </Text>
      <Text variant="bodyLarge" style={{ color: theme.text.secondary }}>
        {copy.body}
      </Text>
      {state === 'queued' && isOnline && (
        <Button mode="text" onPress={() => flushReportQueue(true)} style={styles.alignStart} contentStyle={styles.tapTarget}>
          Try sending now
        </Button>
      )}
      <Button mode="contained-tonal" onPress={onDone} style={styles.doneBtn} contentStyle={styles.tapTarget}>
        Done
      </Button>
    </View>
  );
}

export function ReportScreen({ onBack }: ReportScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const isOnline = useOnlineStatus();

  const [step, setStep] = useState<Step>('hazard');
  const [hazard, setHazard] = useState<HazardType | null>(null);
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [effect, setEffect] = useState<ObservedEffect | null>(null);
  const [note, setNote] = useState('');
  const [sentId, setSentId] = useState<string | null>(null);
  // Start locating as soon as the form opens, so a fix is ready by the last step.
  const location = useDeviceLocation(step !== 'sent');

  const hazardLabel = useMemo(() => HAZARDS.find((h) => h.value === hazard)?.label, [hazard]);

  const send = () => {
    if (!hazard || !severity || !location.fix) return;
    const id = newClientEventId();
    enqueueReport(
      {
        client_event_id: id,
        hazard_type: hazard,
        severity,
        observed_effect: effect ?? undefined,
        location: {
          lat: location.fix.lat,
          lon: location.fix.lon,
          accuracy_m: location.fix.accuracyM ?? undefined,
          frame: 'WGS84',
        },
        observed_at: new Date().toISOString(),
        note: note.trim() || undefined,
      },
      !isOnline,
    );
    setSentId(id);
    setStep('sent');
  };

  const back = () => {
    if (step === 'severity') setStep('hazard');
    else if (step === 'confirm') setStep('severity');
    else onBack();
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Report a hazard" onBack={step === 'sent' ? onBack : back} />
      <ScrollView contentContainerStyle={{ padding: r.gutter, paddingBottom: r.sectionGap }} keyboardShouldPersistTaps="handled">
        {step === 'hazard' && (
          <>
            <Text variant="bodyMedium" style={[styles.urgent, { color: theme.text.secondary }]}>
              In immediate danger? Call 911 first.
            </Text>
            <Text variant="titleLarge" accessibilityRole="header" style={[styles.question, { color: theme.text.primary }]}>
              What’s happening?
            </Text>
            <View style={styles.grid}>
              {HAZARDS.map((h) => (
                <Tile
                  key={h.value}
                  icon={hazardIcon(h.value)}
                  label={h.label}
                  theme={theme}
                  onPress={() => {
                    setHazard(h.value);
                    setStep('severity');
                  }}
                />
              ))}
            </View>
          </>
        )}

        {step === 'severity' && (
          <>
            <Text variant="titleLarge" accessibilityRole="header" style={[styles.question, { color: theme.text.primary }]}>
              How serious is it?
            </Text>
            <View style={styles.list}>
              {SEVERITIES.map((s) => (
                <Pressable
                  key={s.value}
                  onPress={() => {
                    setSeverity(s.value);
                    setStep('confirm');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${s.value}: ${s.detail}`}
                  style={({ pressed }) => [
                    styles.severityRow,
                    { backgroundColor: pressed ? theme.bg.recessed : theme.bg.raised, borderColor: theme.line.hairline },
                  ]}
                >
                  <SeverityIndicator severity={s.value} />
                  <Text variant="bodyLarge" style={[styles.flex, { color: theme.text.secondary }]}>
                    {s.detail}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {step === 'confirm' && hazard && severity && (
          <>
            <Text variant="titleLarge" accessibilityRole="header" style={[styles.question, { color: theme.text.primary }]}>
              Check and send
            </Text>

            <View style={[styles.card, styles.cardRow, { backgroundColor: theme.bg.raised }]}>
              <Icon source={hazardIcon(hazard)} size={24} color={theme.text.secondary} />
              <Text variant="bodyLarge" style={[styles.flex, { color: theme.text.primary }]}>
                {hazardLabel}
              </Text>
              <SeverityIndicator severity={severity} size="small" />
            </View>

            <LocationCard theme={theme} status={location.status} fix={location.fix} onRetry={location.retry} />

            <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.text.primary }]}>
              What do you see? <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>Optional</Text>
            </Text>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {EFFECTS.map((e) => {
                const selected = effect === e.value;
                return (
                  <Pressable
                    key={e.value}
                    onPress={() => setEffect(selected ? null : e.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: selected ? theme.bg.recessed : 'transparent',
                        borderColor: selected ? theme.text.secondary : theme.line.hairline,
                      },
                    ]}
                  >
                    <Text variant="bodyMedium" style={{ color: theme.text.primary, fontWeight: selected ? '600' : '400' }}>
                      {e.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text variant="titleMedium" nativeID="report-note-label" style={[styles.sectionTitle, { color: theme.text.primary }]}>
              Anything else? <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>Optional</Text>
            </Text>
            <TextInput
              style={[
                typography.body,
                styles.note,
                { backgroundColor: theme.bg.recessed, borderColor: theme.line.hairline, color: theme.text.primary },
              ]}
              accessibilityLabelledBy="report-note-label"
              accessibilityLabel="Anything else, optional"
              placeholder="e.g. Water is over the footbridge and still rising"
              placeholderTextColor={theme.text.faint}
              value={note}
              onChangeText={setNote}
              maxLength={NOTE_MAX}
              multiline
            />
            {note.length > NOTE_MAX - 100 && (
              <Text variant="bodyMedium" style={{ color: theme.text.secondary, fontVariant: ['tabular-nums'] }}>
                {NOTE_MAX - note.length} characters left
              </Text>
            )}

            <Text variant="bodyMedium" style={[styles.reviewNote, { color: theme.text.secondary }]}>
              Reviewers check reports before anyone else sees them. {isOnline ? '' : 'You’re offline — it will be saved and sent when you have signal.'}
            </Text>
            <Button
              mode="contained"
              onPress={send}
              disabled={!location.fix}
              contentStyle={styles.tapTarget}
              accessibilityHint={location.fix ? undefined : 'Waiting for your location'}
            >
              {isOnline ? 'Send report' : 'Save and send later'}
            </Button>
          </>
        )}

        {step === 'sent' && sentId && <SentState theme={theme} clientEventId={sentId} onDone={onBack} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  urgent: {
    marginBottom: spacing.scale[2],
  },
  question: {
    marginBottom: spacing.scale[3],
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.scale[2],
  },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 104,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.scale[3],
    justifyContent: 'space-between',
  },
  tileLabel: {
    marginTop: spacing.scale[2],
  },
  list: {
    gap: spacing.scale[2],
  },
  severityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[3],
    minHeight: spacing.minTapTarget + spacing.scale[3],
    borderRadius: radius.card,
    borderWidth: 1,
    paddingHorizontal: spacing.scale[3],
  },
  card: {
    borderRadius: radius.card,
    padding: spacing.cardPadding,
    marginBottom: spacing.scale[2],
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[3],
  },
  sectionTitle: {
    marginTop: spacing.scale[4],
    marginBottom: spacing.scale[2],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.scale[1],
  },
  chip: {
    minHeight: spacing.minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.scale[3],
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  note: {
    minHeight: 96,
    textAlignVertical: 'top',
    padding: spacing.scale[3],
    borderWidth: 1,
    borderRadius: radius.input,
  },
  reviewNote: {
    marginTop: spacing.scale[4],
    marginBottom: spacing.scale[2],
  },
  sent: {
    paddingTop: spacing.scale[6],
    gap: spacing.scale[2],
  },
  sentTitle: {
    marginTop: spacing.scale[2],
  },
  doneBtn: {
    marginTop: spacing.scale[4],
  },
  alignStart: {
    alignSelf: 'flex-start',
  },
  tapTarget: {
    minHeight: spacing.minTapTarget,
  },
});
