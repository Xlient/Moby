import { Linking, Platform, Share, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { radius, spacing } from '@/theme/tokens';
import { useUserCenterPassive } from '@/location/UserLocationContext';
import { EmergencyNumbers } from '@/components/EmergencyNumbers';
import { countryAt } from '@/data/emergencyNumbers';
import { distanceKm } from '@/lib/geo';
import { formatTimeAgo } from '@/lib/alerts';
import { formatCoords, formatUtcTime } from '@/lib/helpMessage';
import type { MeshEntry } from '@/mesh/relay';

interface SosCallsProps {
  calls: { entry: MeshEntry; safe: boolean }[];
}

function sosMessage(p: MeshEntry['packet']): string {
  const at = new Date(p.time * 1000).toISOString();
  return [
    `Someone asked for help through Moby (an SOS relayed by nearby phones, not checked by anyone).`,
    `Location: ${formatCoords(p.lat, p.lon)} (±11 m) at ${formatUtcTime(at)}.`,
    `Map: https://www.openstreetmap.org/?mlat=${p.lat.toFixed(5)}&mlon=${p.lon.toFixed(5)}#map=17/${p.lat.toFixed(5)}/${p.lon.toFixed(5)}`,
  ].join('\n');
}

function openMap(lat: number, lon: number) {
  const url = Platform.OS === 'android' ? `geo:${lat},${lon}?q=${lat},${lon}(SOS)` : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}`;
  Linking.openURL(url).catch(() => {});
}

/**
 * Calls for help heard from nearby phones. What a person here can do is decide: call
 * emergency services with the location, or pass it on. Moby never says the caller is
 * real, or that anyone is on the way.
 */
export function SosCalls({ calls }: SosCallsProps) {
  const { theme } = useTheme();
  const me = useUserCenterPassive();
  if (calls.length === 0) return null;
  const first = calls.find((c) => !c.safe)?.entry.packet ?? calls[0]!.entry.packet;

  return (
    <View style={styles.list}>
      <Text variant="titleLarge" accessibilityRole="header" style={{ color: theme.text.primary }}>
        Calls for help nearby
      </Text>
      <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
        Sent over Bluetooth by a Moby phone with no signal. Nobody has checked them. If you can, call emergency services
        and give them the location. Don’t put yourself in danger to reach someone.
      </Text>
      {calls.map(({ entry, safe }) => {
        const p = entry.packet;
        const km = me.source === 'device' ? distanceKm(me.lat, me.lon, p.lat, p.lon) : undefined;
        return (
          <View
            key={p.id}
            style={[styles.card, { backgroundColor: theme.bg.raised, borderLeftColor: safe ? theme.accent.calm : theme.severity.critical }]}
          >
            <Text variant="titleMedium" style={{ color: theme.text.primary }}>
              {safe ? 'Said they’re safe now' : 'Someone asked for help'}
            </Text>
            <Text variant="bodyLarge" selectable style={{ color: theme.text.primary, fontVariant: ['tabular-nums'] }}>
              {formatCoords(p.lat, p.lon)}
            </Text>
            <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
              {[
                `Sent ${formatTimeAgo(new Date(p.time * 1000).toISOString())}`,
                km !== undefined ? (km < 1 ? `${Math.round(km * 1000)} m from you` : `${km.toFixed(1)} km from you`) : null,
                p.hops === 0 ? 'heard directly' : `passed through ${p.hops} phone${p.hops === 1 ? '' : 's'}`,
              ].filter(Boolean).join(' · ')}
            </Text>
            {!safe && (
              <View style={styles.actions}>
                <Button mode="outlined" icon="map-marker" onPress={() => openMap(p.lat, p.lon)} textColor={theme.text.primary}>
                  Map
                </Button>
                <Button
                  mode="outlined"
                  icon="share-variant"
                  onPress={() => Share.share({ message: sosMessage(p) }).catch(() => {})}
                  textColor={theme.text.primary}
                >
                  Share location
                </Button>
              </View>
            )}
          </View>
        );
      })}
      <EmergencyNumbers country={countryAt(first.lat, first.lon)} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.scale[2] },
  card: { borderLeftWidth: 4, borderRadius: radius.card, padding: spacing.scale[3], gap: spacing.scale[1] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.scale[2], marginTop: spacing.scale[1] },
});
