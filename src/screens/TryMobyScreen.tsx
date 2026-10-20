import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { ActivityIndicator, Avatar, Button, Icon, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { HotZone } from '@/api/types';
import { env } from '@/config/env';
import { useTheme } from '@/theme/ThemeContext';
import { radius, spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SeverityIndicator } from '@/components/SeverityIndicator';
import { hazardIcon } from '@/lib/alerts';
import { setDemoMode, setViewing, useTryMoby } from '@/lib/tryMoby';

interface TryMobyScreenProps {
  onBack: () => void;
  /** After choosing a place: show it (Home). */
  onShow: () => void;
}

const HAZARD_NAMES: Record<string, string> = {
  flood: 'flood', fire: 'fire', earthquake: 'earthquake', storm: 'storm', landslide: 'landslide', other: 'other',
};

function zoneSummary(z: HotZone): string {
  const kinds = z.hazard_types.slice(0, 3).map((h) => HAZARD_NAMES[h] ?? h).join(', ');
  return [
    `${z.alert_count} active alert${z.alert_count === 1 ? '' : 's'}`,
    kinds,
    z.has_community_reports ? 'community reports' : null,
  ].filter(Boolean).join(' · ');
}

/**
 * Settings → Try Moby. For judges, and for anyone wanting to see what Moby does when
 * there's nothing happening where they are:
 *   - today's hot zones: view a busy place instead of your own (real, live alerts);
 *   - demo mode: real past alerts replayed where you're looking, marked Demo.
 * Neither changes what Moby sends about you (push area, SOS, reports use your real GPS).
 */
export function TryMobyScreen({ onBack, onShow }: TryMobyScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const online = useOnlineStatus();
  const { viewing, demoMode } = useTryMoby();
  const zones = useQuery({
    queryKey: ['hot-zones'],
    queryFn: () => api.getHotZones(),
    staleTime: 10 * 60_000,
    enabled: online && !env.useMock,
  });

  const choose = (z: HotZone) => {
    setViewing({ lat: z.center.lat, lon: z.center.lon, name: z.name, zoneId: z.zone_id });
    onShow();
  };

  return (
    <View style={[styles.flex, { backgroundColor: theme.bg.base }]}>
      <ScreenHeader title="Try Moby" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: r.gutter, paddingBottom: spacing.scale[7], gap: spacing.sectionGap }}>
        <Text variant="bodyLarge" style={{ color: theme.text.primary }}>
          Nothing happening where you are? See what Moby does somewhere busy, or replay real past alerts.
          Push alerts and reports keep using where you really are. “I need help” becomes a practice screen,
          with one tap back to your real location.
        </Text>

        <View style={[styles.card, { backgroundColor: theme.bg.raised, padding: r.cardPadding }]}>
          <View style={styles.switchRow}>
            <View style={styles.flex}>
              <Text variant="titleMedium" style={{ color: theme.text.primary }}>Demo mode</Text>
              <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
                Adds real past warnings around {viewing ? viewing.name : 'you'}, as if they were happening now,
                so you can see emergency mode and alert details. Each is marked Demo. Only this phone sees them.
              </Text>
            </View>
            <Switch
              value={demoMode}
              onValueChange={setDemoMode}
              accessibilityLabel="Demo mode"
              trackColor={{ false: theme.line.hairline, true: theme.accent.calm }}
              thumbColor={theme.bg.raised}
            />
          </View>
        </View>

        <View style={styles.list}>
          <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.text.primary }}>
            Today’s hot zones
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
            Places with the most going on right now: live official alerts and community reports.
            Best first: more kinds of hazard and more serious warnings rank higher.
          </Text>

          {viewing && (
            <Pressable
              onPress={() => setViewing(null)}
              accessibilityRole="button"
              style={[styles.zone, { backgroundColor: theme.bg.raised }]}
            >
              <Avatar.Icon size={40} icon="crosshairs-gps" color={theme.text.primary} style={{ backgroundColor: theme.bg.recessed }} />
              <View style={styles.flex}>
                <Text variant="titleMedium" style={{ color: theme.text.primary }}>Use my location</Text>
                <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>Now viewing {viewing.name}</Text>
              </View>
            </Pressable>
          )}

          {env.useMock ? (
            <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
              Hot zones need the live backend. This build uses demo data around San Francisco.
            </Text>
          ) : !online ? (
            <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>You’re offline. Hot zones need a connection.</Text>
          ) : zones.isLoading ? (
            <ActivityIndicator style={styles.alignStart} />
          ) : zones.isError ? (
            <View>
              <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>Couldn’t load today’s hot zones.</Text>
              <Button mode="text" onPress={() => zones.refetch()} style={styles.alignStart}>Try again</Button>
            </View>
          ) : (zones.data ?? []).length === 0 ? (
            <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
              It’s quiet everywhere Moby watches right now. Turn on demo mode to see how alerts look.
            </Text>
          ) : (
            zones.data!.map((z) => {
              const current = viewing?.zoneId === z.zone_id;
              return (
                <Pressable
                  key={z.zone_id}
                  onPress={() => choose(z)}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${z.name}. ${zoneSummary(z)}. Most serious: ${z.lead_headline}.`}
                  accessibilityState={{ selected: current }}
                  style={[
                    styles.zone,
                    { backgroundColor: theme.bg.raised },
                    current && { borderColor: theme.accent.calm, borderWidth: 2 },
                  ]}
                >
                  <Avatar.Icon
                    size={40}
                    icon={hazardIcon(z.hazard_types[0])}
                    color={theme.severity[z.top_severity]}
                    style={{ backgroundColor: theme.bg.recessed }}
                  />
                  <View style={styles.flex}>
                    <View style={styles.titleRow}>
                      <Text variant="titleMedium" numberOfLines={1} style={[styles.flex, { color: theme.text.primary }]}>
                        {z.name}
                      </Text>
                      <SeverityIndicator severity={z.top_severity} size="small" />
                    </View>
                    <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>{zoneSummary(z)}</Text>
                    <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.text.secondary }}>{z.lead_headline}</Text>
                  </View>
                  <Icon source={current ? 'check' : 'chevron-right'} size={20} color={theme.text.faint} />
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderRadius: radius.card },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.scale[3] },
  list: { gap: spacing.scale[2] },
  zone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[3],
    padding: spacing.scale[3],
    borderRadius: radius.card,
    minHeight: spacing.minTapTarget,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.scale[2] },
  alignStart: { alignSelf: 'flex-start' },
});
