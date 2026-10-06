import { useState } from 'react';
import { Alert as RNAlert, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Switch, Text } from 'react-native-paper';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useTheme } from '@/theme/ThemeContext';
import { spacing, typography } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/api/client';
import { env } from '@/config/env';
import { setPrivacySettings, usePrivacySettings } from '@/lib/privacySettings';

interface PrivacyScreenProps {
  onBack: () => void;
}

/** Where the policy and terms live: the Moby service (they're also on the store listing). */
function legalUrl(doc: 'privacy' | 'terms'): string | null {
  if (env.useMock) return null;
  return `${env.apiUrl.replace(/\/v1\/?$/, '')}/legal/${doc}`;
}

/**
 * Settings → Privacy & data: what's shared, download everything, delete everything
 * (GDPR access/erasure; Google Play's account-deletion requirement).
 */
export function PrivacyScreen({ onBack }: PrivacyScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const { user, profile, deleteAccount } = useAuth();
  const { followLocation, approximateReports } = usePrivacySettings();
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const muted = [typography.meta, { color: theme.text.secondary }];

  async function download() {
    setBusy('export');
    try {
      const server = env.useMock ? {} : await api.exportMyData();
      const data = {
        account: user ? { email: user.email, name: user.displayName, created: user.metadata.creationTime } : null,
        profile,
        on_this_phone: { privacy: { followLocation, approximateReports } },
        moby_service: server,
      };
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS !== 'web' && (await Sharing.isAvailableAsync())) {
        const file = new File(Paths.cache, `moby-my-data-${new Date().toISOString().slice(0, 10)}.json`);
        file.write(json);
        await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Your Moby data' });
      } else {
        RNAlert.alert('Your Moby data', json.slice(0, 2000));
      }
    } catch {
      RNAlert.alert('Couldn’t download your data', 'Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete() {
    RNAlert.alert(
      'Delete your account?',
      'This permanently deletes your account, your saved areas and settings, and the reports you sent. '
        + 'Alerts you helped confirm stay up, without your name. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete everything', style: 'destructive', onPress: () => void doDelete() },
      ],
    );
  }

  async function doDelete() {
    setBusy('delete');
    try {
      const result = await deleteAccount();
      RNAlert.alert(
        'Account deleted',
        result === 'deleted'
          ? 'Your account and data have been deleted. Copies in backups are removed within 14 days.'
          : 'Your data has been deleted. To remove the sign-in itself, sign in once more and delete again '
            + '(for security, this needs a recent sign-in).',
      );
    } catch {
      RNAlert.alert('Couldn’t delete your account', 'Nothing was deleted. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  const row = [styles.row, { borderBottomColor: theme.line.hairline }];

  return (
    <View style={styles.container}>
      <ScreenHeader title="Privacy & data" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: r.gutter, gap: spacing.scale[4] }}>
        <Text style={[typography.body, { color: theme.text.secondary }]}>
          Moby never sells your data or uses it for ads. You decide what it shares.
        </Text>

        <View style={[styles.card, { backgroundColor: theme.bg.raised }]}>
          <View style={row}>
            <View style={styles.rowText}>
              <Text variant="titleSmall" style={{ color: theme.text.primary }}>Alerts follow my location</Text>
              <Text style={muted}>
                Sends your approximate location (about 1 km) so push alerts match where you are. Off: only your
                saved areas get push alerts, and the server forgets your location.
              </Text>
            </View>
            <Switch value={followLocation} onValueChange={(v) => setPrivacySettings({ followLocation: v })} />
          </View>
          <View style={[styles.row, styles.last]}>
            <View style={styles.rowText}>
              <Text variant="titleSmall" style={{ color: theme.text.primary }}>Approximate location in reports</Text>
              <Text style={muted}>
                Rounds where your reports say you were to about 500 m. Reports are still useful, just less precise.
              </Text>
            </View>
            <Switch value={approximateReports} onValueChange={(v) => setPrivacySettings({ approximateReports: v })} />
          </View>
        </View>

        <Text style={muted}>
          Your name, email, notes and exact report locations are never shown to anyone. Reports are checked by AI
          and a person before they become public alerts.
        </Text>

        {user ? (
          <View style={{ gap: spacing.scale[2] }}>
            <Button mode="outlined" icon="download" onPress={download} loading={busy === 'export'}
              disabled={busy !== null} textColor={theme.text.primary}>
              Download my data
            </Button>
            <Button mode="outlined" icon="delete" onPress={confirmDelete} loading={busy === 'delete'}
              disabled={busy !== null} textColor={theme.severity.critical}>
              Delete my account
            </Button>
          </View>
        ) : null}

        {legalUrl('privacy') ? (
          <View style={styles.links}>
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(legalUrl('privacy')!)}>
              <Text style={[typography.body, styles.link, { color: theme.text.primary }]}>Privacy policy</Text>
            </Pressable>
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(legalUrl('terms')!)}>
              <Text style={[typography.body, styles.link, { color: theme.text.primary }]}>Terms of use</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
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
  links: { flexDirection: 'row', gap: spacing.scale[4] },
  link: { textDecorationLine: 'underline' },
});
