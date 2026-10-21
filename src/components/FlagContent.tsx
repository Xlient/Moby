import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Button, Icon, IconButton, Text } from 'react-native-paper';
import { api, ApiRequestError } from '@/api/client';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { buildFlag, FLAG_REASONS, flagErrorMessage, NOTE_CHARS, type FlagReason, type FlagTarget } from '@/lib/flags';
import { useTheme } from '@/theme/ThemeContext';
import { radius, spacing, typography } from '@/theme/tokens';

// "This looks wrong" on every AI output and community report (Google Play's AI-Generated
// and User-Generated Content policies: report inside the app). A quiet text action that
// opens a short sheet: a reason, an optional note, send. Needs a connection: offline,
// the sheet says so and Send stays off (nothing is queued).

/** The quiet "This looks wrong" action. `icon` draws just a small flag (for list rows). */
export function FlagAction({ target, icon, label }: { target: FlagTarget; icon?: boolean; label?: string }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const a11y = label ?? 'This looks wrong: report it';
  return (
    <>
      {icon ? (
        <IconButton
          icon="flag-outline"
          size={18}
          iconColor={theme.text.faint}
          onPress={() => setOpen(true)}
          accessibilityLabel={a11y}
          style={styles.iconButton}
        />
      ) : (
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={a11y}
          hitSlop={8}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Icon source="flag-outline" size={14} color={theme.text.faint} />
          <Text style={[typography.meta, { color: theme.text.secondary }]}>This looks wrong</Text>
        </Pressable>
      )}
      {open && <FlagSheet target={target} onClose={() => setOpen(false)} />}
    </>
  );
}

function FlagSheet({ target, onClose }: { target: FlagTarget; onClose: () => void }) {
  const { theme } = useTheme();
  const online = useOnlineStatus();
  const [reason, setReason] = useState<FlagReason | null>(null);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'editing' | 'sending' | 'sent'>('editing');
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!reason) return;
    setState('sending');
    setError(null);
    try {
      await api.flagContent(buildFlag(target, reason, note));
      setState('sent');
    } catch (err) {
      setError(flagErrorMessage(err instanceof ApiRequestError ? err.status : undefined));
      setState('editing');
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap} pointerEvents="box-none">
        <View style={[styles.sheet, { backgroundColor: theme.bg.base }]}>
          <View style={[styles.handle, { backgroundColor: theme.line.hairline }]} />
          {state === 'sent' ? (
            <View style={styles.body} accessibilityLiveRegion="polite">
              <Icon source="check-circle-outline" size={28} color={theme.accent.calm} />
              <Text accessibilityRole="header" style={[typography.heading, { color: theme.text.primary }]}>
                Thanks, we’ll take a look
              </Text>
              <Text style={[typography.body, { color: theme.text.secondary }]}>
                Moby’s local partners, who review alerts, will look at it.
              </Text>
              <Button mode="contained" onPress={onClose} style={styles.alignEnd}>
                Done
              </Button>
            </View>
          ) : (
            <View style={styles.body}>
              <Text accessibilityRole="header" style={[typography.heading, { color: theme.text.primary }]}>
                What’s wrong with it?
              </Text>
              <View accessibilityRole="radiogroup">
                {FLAG_REASONS.map((r) => {
                  const selected = reason === r.value;
                  return (
                    <Pressable
                      key={r.value}
                      onPress={() => setReason(r.value)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      style={styles.reason}
                    >
                      <Icon
                        source={selected ? 'radiobox-marked' : 'radiobox-blank'}
                        size={22}
                        color={selected ? theme.accent.calm : theme.text.faint}
                      />
                      <Text style={[typography.body, { color: theme.text.primary }]}>{r.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                style={[
                  typography.body,
                  styles.note,
                  { backgroundColor: theme.bg.recessed, borderColor: theme.line.hairline, color: theme.text.primary },
                ]}
                accessibilityLabel="Anything else, optional"
                placeholder="Anything else? (optional)"
                placeholderTextColor={theme.text.faint}
                value={note}
                onChangeText={setNote}
                maxLength={NOTE_CHARS}
                multiline
              />
              <Text style={[typography.meta, { color: theme.text.secondary }]}>
                {online
                  ? 'Please don’t include names or addresses. Nothing is hidden automatically.'
                  : 'You’re offline. Connect to the internet to send this.'}
              </Text>
              {error && (
                <Text accessibilityLiveRegion="polite" style={[typography.meta, { color: theme.severity.critical }]}>
                  {error}
                </Text>
              )}
              <View style={styles.buttons}>
                <Button mode="text" onPress={onClose} textColor={theme.text.secondary}>
                  Cancel
                </Button>
                <Button
                  mode="contained"
                  onPress={send}
                  disabled={!reason || !online || state === 'sending'}
                  loading={state === 'sending'}
                >
                  Send
                </Button>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.scale[1], alignSelf: 'flex-start' },
  iconButton: { margin: 0 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%',
    paddingBottom: spacing.scale[4],
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: spacing.scale[2] },
  body: { padding: spacing.scale[4], gap: spacing.scale[3] },
  reason: { flexDirection: 'row', alignItems: 'center', gap: spacing.scale[3], minHeight: 44 },
  note: {
    minHeight: 72,
    textAlignVertical: 'top',
    padding: spacing.scale[3],
    borderWidth: 1,
    borderRadius: radius.input,
  },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.scale[2] },
  alignEnd: { alignSelf: 'flex-end' },
});
