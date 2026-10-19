import { useState } from 'react';
import { Linking, ScrollView, Share, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { radius, spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { isFresh, useDeviceLocation } from '@/hooks/useDeviceLocation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmergencyNumbers } from '@/components/EmergencyNumbers';
import { countryAt } from '@/data/emergencyNumbers';
import { formatAccuracy, formatCoords, formatUtcTime, helpMessage } from '@/lib/helpMessage';
import { formatTimeAgo } from '@/lib/alerts';
import { useUserCenter, useUserCenterPassive } from '@/location/UserLocationContext';
import { useTryMoby } from '@/lib/tryMoby';
import { SosPanel } from '@/components/SosPanel';

interface HelpScreenProps {
  onBack: () => void;
}

/**
 * "I need help": the person's exact location, big enough to read out over the phone,
 * the local emergency numbers, and a message with the location to send to anyone.
 *
 * Works with no data: GPS needs no signal, the numbers are bundled, and the message
 * goes through the phone's own share sheet (SMS included). Moby never contacts anyone
 * by itself, and never says help is on the way.
 *
 * Trying Moby (viewing a hot zone, or demo mode): a practice version at the place being
 * shown, so a demo never puts the person's real coordinates on screen. Nothing can be sent
 * from it (share and SOS are off), and "Use my real location" at the top switches back
 * at once, for the day someone really needs it with demo mode still on.
 */
export function HelpScreen({ onBack }: HelpScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const { status, fix, retry } = useDeviceLocation(true);
  const fresh = isFresh(fix);
  // No fix yet: the numbers still show, for the last place the phone was seen.
  const lastSeen = useUserCenterPassive();
  const { viewing, demoMode } = useTryMoby();
  const shown = useUserCenter();
  const [useReal, setUseReal] = useState(false);
  const practice = (!!viewing || demoMode) && !useReal;
  const where = practice ? shown : fix ?? lastSeen;

  const share = () => {
    if (!fix || practice) return;
    Share.share({ message: helpMessage(fix) }).catch(() => {});
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg.base }]}>
      <ScreenHeader title="I need help" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: r.gutter, paddingBottom: spacing.scale[7], gap: spacing.scale[3] }}>
        <Text variant="bodyLarge" style={{ color: theme.text.primary }}>
          If you can, call emergency services first and read them your location.
        </Text>

        {practice && (
          <View style={[styles.practice, { backgroundColor: theme.bg.recessed, borderColor: theme.text.secondary }]}>
            <Text variant="titleMedium" style={{ color: theme.text.primary }}>Practice: not your location</Text>
            <Text variant="bodyMedium" style={{ color: theme.text.primary }}>
              You’re trying Moby, so this shows {viewing ? viewing.name : 'the demo'} and nothing can be sent from here.
            </Text>
            <Button mode="contained-tonal" icon="crosshairs-gps" onPress={() => setUseReal(true)} style={styles.alignStart}>
              I really need help: use my real location
            </Button>
          </View>
        )}

        <View
          style={[styles.location, { backgroundColor: theme.bg.raised, borderColor: theme.line.hairline }]}
          accessibilityLiveRegion="polite"
        >
          <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.text.secondary }}>
            {practice ? 'Practice location' : 'Your location'}
          </Text>
          {practice ? (
            <>
              <Text variant="headlineMedium" selectable style={[styles.coords, { color: theme.text.primary }]}>
                {formatCoords(shown.lat, shown.lon)}
              </Text>
              <Text variant="bodyLarge" style={{ color: theme.text.secondary }}>
                {viewing ? viewing.name : 'Demo'} · Trying Moby
              </Text>
            </>
          ) : fix ? (
            <>
              <Text variant="headlineMedium" selectable style={[styles.coords, { color: theme.text.primary }]}>
                {formatCoords(fix.lat, fix.lon)}
              </Text>
              <Text variant="bodyLarge" style={{ color: theme.text.secondary }}>
                {[formatAccuracy(fix.accuracyM), `at ${formatUtcTime(fix.at)}`].filter(Boolean).join(' · ')}
                {fresh ? '' : ` (last known, ${formatTimeAgo(fix.at)})`}
              </Text>
            </>
          ) : (
            <Text variant="bodyLarge" style={{ color: theme.text.primary }}>
              {status === 'denied'
                ? 'Moby is not allowed to use your location.'
                : status === 'unavailable'
                  ? 'Can’t get a GPS fix. Move into the open, away from cliffs and buildings, and try again.'
                  : 'Finding your location…'}
            </Text>
          )}
          {practice ? null : status === 'denied' ? (
            <Button mode="text" onPress={() => Linking.openSettings()} style={styles.alignStart}>
              Turn on location
            </Button>
          ) : (!fix || !fresh) && status !== 'locating' ? (
            <Button mode="text" onPress={retry} style={styles.alignStart}>
              Try again
            </Button>
          ) : null}
        </View>

        <EmergencyNumbers country={countryAt(where.lat, where.lon)} />

        <Button
          mode="contained"
          icon="share-variant"
          onPress={share}
          disabled={!fix || practice}
          contentStyle={styles.bigButtonContent}
          labelStyle={styles.bigButtonLabel}
          style={styles.bigButton}
        >
          Send my location
        </Button>
        <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
          Opens your messages or another app with your location and a map link, to send to someone you trust.
          Moby doesn’t send it for you and can’t tell whether it arrives.
        </Text>

        {practice ? (
          <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
            Sending your location and SOS to nearby phones are turned off in practice. Use your real location to send them.
          </Text>
        ) : (
          <SosPanel at={fix ? { lat: fix.lat, lon: fix.lon } : null} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  location: {
    padding: spacing.scale[4],
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.scale[1],
  },
  // Big enough to read aloud to a dispatcher without squinting.
  coords: { fontWeight: '700', fontSize: 30, lineHeight: 38, fontVariant: ['tabular-nums'] },
  alignStart: { alignSelf: 'flex-start' },
  practice: {
    padding: spacing.scale[3],
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: spacing.scale[2],
  },
  bigButton: { borderRadius: radius.card },
  bigButtonContent: { minHeight: 64 },
  bigButtonLabel: { fontSize: 20, fontWeight: '700' },
});
