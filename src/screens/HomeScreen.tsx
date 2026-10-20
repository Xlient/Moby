import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, View, StyleSheet } from 'react-native';
import { Avatar, Button, FAB, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import type { Theme } from '@/theme/tokens';
import { spacing, radius } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useAuth } from '@/auth/AuthContext';
import { useRetryLocation } from '@/location/UserLocationContext';
import { useNearbyAlerts } from '@/hooks/useNearbyAlerts';
import { AlertCard } from '@/components/AlertCard';
import { MapPreviewCard } from '@/components/MapPreviewCard';
import { MobyMark } from '@/components/MobyMark';
import { RadiusPicker } from '@/components/RadiusPicker';
import { formatTimeAgo } from '@/lib/alerts';
import { useReportQueue } from '@/hooks/useReportQueue';
import { useEmergencyAlert } from '@/hooks/useEmergencyAlert';
import { useMesh } from '@/mesh/useMesh';
import { TryMobyBanner } from '@/components/TryMobyBanner';
import { isDemoAlert } from '@/lib/tryMoby';

interface HomeScreenProps {
  onReportPress: () => void;
  onAlertPress: (alertId: string) => void;
  onSeeAllPress: () => void;
  onMapPress: () => void;
  onGuidancePress: () => void;
  /** "Before you go" (feature flag trip_briefing). */
  onTripPress?: () => void;
  onMyReportsPress: () => void;
  onEmergencyPress: (alertId: string) => void;
  onHelpPress: () => void;
  onSosCallsPress: () => void;
  onRouteCheckPress: () => void;
}

const MAX_HOME_CARDS = 3;
/** Extended FAB height (56) + its bottom offset, so the last card is never covered. */
const FAB_CLEARANCE = 56 + spacing.scale[3] * 2;

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function EmptyState({
  theme,
  radiusKm,
  checkedAt,
  hiddenCount,
}: {
  theme: Theme;
  radiusKm: number;
  checkedAt: string | null;
  hiddenCount: number;
}) {
  // Alerts exist but the user's alert types hide them: never call that "all quiet".
  if (hiddenCount > 0) {
    return (
      <View style={[styles.notChecked, { backgroundColor: theme.bg.recessed }]}>
        <Text variant="titleMedium" style={{ color: theme.text.primary }}>
          Nothing that matches your alert types
        </Text>
        <Text variant="bodyLarge" style={[styles.notCheckedBody, { color: theme.text.secondary }]}>
          {hiddenCount} other alert{hiddenCount === 1 ? ' is' : 's are'} active within {radiusKm} km.
          Change what you see in Settings → Alert types.
        </Text>
      </View>
    );
  }
  // The only centered block in the app. It should read as good news.
  return (
    <View style={[styles.empty, { backgroundColor: theme.bg.recessed }]}>
      <Avatar.Icon
        size={64}
        icon="shield-check-outline"
        color={theme.accent.calm}
        style={{ backgroundColor: theme.bg.raised }}
      />
      <Text variant="titleLarge" style={[styles.emptyTitle, { color: theme.text.primary }]}>
        All quiet nearby
      </Text>
      <Text variant="bodyLarge" style={[styles.centered, { color: theme.text.secondary }]}>
        No alerts or reports within {radiusKm} km. We’ll let you know if anything changes.
      </Text>
      {checkedAt && (
        <Text
          variant="bodyMedium"
          style={[styles.emptyChecked, { color: theme.text.faint, fontVariant: ['tabular-nums'] }]}
        >
          Checked {formatTimeAgo(checkedAt)}
        </Text>
      )}
    </View>
  );
}

/**
 * Nothing saved and no way to check yet. Must not read as "all clear" — we simply
 * don't know — but it isn't an alarm either: neutral tone, no warning color.
 */
function NotCheckedState({ theme, isOffline }: { theme: Theme; isOffline: boolean }) {
  return (
    <View style={[styles.notChecked, { backgroundColor: theme.bg.recessed }]}>
      <Text variant="titleMedium" style={{ color: theme.text.primary }}>
        {isOffline ? 'Can’t check for alerts yet' : 'Checking for alerts…'}
      </Text>
      {isOffline && (
        <Text variant="bodyLarge" style={[styles.notCheckedBody, { color: theme.text.secondary }]}>
          You’re offline and nothing has been saved on this phone yet. We’ll look as soon as you
          have signal. Official channels like radio and local sirens still apply.
        </Text>
      )}
    </View>
  );
}

function LoadingCards({ theme }: { theme: Theme }) {
  return (
    <View style={styles.cards} accessibilityLabel="Loading alerts">
      {[0, 1].map((i) => (
        <View key={i} style={[styles.skeleton, { backgroundColor: theme.bg.recessed }]}>
          <View style={[styles.skeletonLine, { width: '55%', backgroundColor: theme.line.hairline }]} />
          <View style={[styles.skeletonLine, { width: '80%', backgroundColor: theme.line.hairline }]} />
        </View>
      ))}
    </View>
  );
}

/** A home shortcut: icon well, short title, one-line note. Two per row; wraps at large text. */
function Tile({
  theme, icon, title, note, label, onPress,
}: {
  theme: Theme;
  icon: string;
  title: string;
  note: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tile, { backgroundColor: theme.bg.raised, opacity: pressed ? 0.85 : 1 }]}
    >
      <Avatar.Icon size={40} icon={icon} style={{ backgroundColor: theme.brand.soft }} color={theme.brand.onSoft} />
      <Text variant="titleSmall" style={{ color: theme.text.primary }}>{title}</Text>
      <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>{note}</Text>
    </Pressable>
  );
}

export function HomeScreen({
  onReportPress, onAlertPress, onSeeAllPress, onMapPress, onGuidancePress, onMyReportsPress, onEmergencyPress, onHelpPress, onSosCallsPress, onTripPress, onRouteCheckPress,
}: HomeScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const { firstName } = useAuth();
  const { nearby, hiddenCount, radiusKm, setRadiusKm, loading, error, isOffline, cachedAt, center } = useNearbyAlerts();
  const [pickerVisible, setPickerVisible] = useState(false);
  const retryLocation = useRetryLocation();
  const myReports = useReportQueue();
  const waitingReports = myReports.filter((x) => x.state === 'queued' || x.state === 'sending').length;
  const { emergency, shouldOpen, markOpened } = useEmergencyAlert();
  const openSosCalls = useMesh().sosCalls.filter((c) => !c.safe).length;

  // Inside an official warning: emergency mode opens by itself, once per warning.
  useEffect(() => {
    if (!shouldOpen || !emergency) return;
    markOpened(emergency.alert.alert_id);
    onEmergencyPress(emergency.alert.alert_id);
  }, [shouldOpen, emergency, markOpened, onEmergencyPress]);

  const greeting = firstName
    ? `${greetingFor(new Date().getHours())}, ${firstName}`
    : greetingFor(new Date().getHours());
  // Offline changes the pill and subline only — no banner (spec v3, H1).
  const subline = isOffline
    ? 'Showing what’s saved on this phone'
    : `Everything within ${radiusKm} km of ${center.source === 'viewing' ? center.name ?? 'this place' : 'you'}`;

  const inArea = center.source === 'viewing' ? `${center.name ?? 'This place'} is in the warning area` : 'You are in the warning area';
  const visible = nearby.slice(0, MAX_HOME_CARDS);
  const hasMore = nearby.length > MAX_HOME_CARDS;

  return (
    <View style={[styles.container, { backgroundColor: theme.bg.base }]}>
      {/* One vertical scroll; nothing inside it scrolls on its own. */}
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: r.gutter,
          paddingBottom: FAB_CLEARANCE + spacing.scale[3],
        }}
      >
        <View
          style={[
            styles.header,
            { backgroundColor: theme.brand.navy, marginHorizontal: -r.gutter, paddingHorizontal: r.gutter },
          ]}
        >
          <View style={styles.brandRow}>
            <MobyMark size={28} />
            <Text variant="titleMedium" style={{ color: theme.brand.onNavy }} accessibilityRole="header">
              Moby
            </Text>
            <View style={[styles.statusPill, { backgroundColor: isOffline ? 'rgba(244, 247, 250, 0.12)' : 'rgba(45, 212, 191, 0.18)' }]}>
              <View style={[styles.dot, { backgroundColor: isOffline ? theme.brand.onNavySecondary : '#2DD4BF' }]} />
              <Text variant="labelSmall" style={{ color: isOffline ? theme.brand.onNavy : '#9BF2E4' }}>
                {isOffline ? 'Offline' : 'Watching'}
              </Text>
            </View>
          </View>
          <Text variant="headlineMedium" accessibilityRole="header" style={[styles.greeting, { color: theme.brand.onNavy }]}>
            {greeting}
          </Text>
          <Text variant="bodyLarge" style={{ color: theme.brand.onNavySecondary }}>
            {subline}
          </Text>
          <View style={[styles.underline, { backgroundColor: theme.brand.pop }]} />
        </View>

        <TryMobyBanner />

        {emergency && (
          <Pressable
            onPress={() => onEmergencyPress(emergency.alert.alert_id)}
            accessibilityRole="button"
            accessibilityLabel={`Emergency mode${isDemoAlert(emergency.alert) ? ', demo' : ''}: ${emergency.alert.headline}. ${inArea}. Open.`}
            style={[styles.emergencyBanner, { backgroundColor: theme.severity[emergency.alert.severity] }]}
          >
            <Avatar.Icon size={40} icon="alert-octagon" color="#FFFFFF" style={styles.bannerIcon} />
            <View style={styles.guidanceText}>
              <Text variant="titleMedium" style={styles.bannerText}>{emergency.alert.headline}</Text>
              <Text variant="bodyMedium" style={styles.bannerText}>
                {isDemoAlert(emergency.alert) ? 'Demo replay. ' : ''}{inArea}. Tap for what to do now.
              </Text>
            </View>
          </Pressable>
        )}

        {openSosCalls > 0 && (
          // Unverified, so not the emergency colour band: violet, like every unverified thing in Moby.
          <Pressable
            onPress={onSosCallsPress}
            accessibilityRole="button"
            accessibilityLabel={`${openSosCalls === 1 ? 'Someone nearby asked' : `${openSosCalls} people nearby asked`} for help over Bluetooth. Unverified. Open.`}
            style={[styles.emergencyBanner, { backgroundColor: theme.trust.unverified.bg, borderColor: theme.trust.unverified.border, borderWidth: 1 }]}
          >
            <Avatar.Icon size={40} icon="access-point" color={theme.trust.unverified.text} style={{ backgroundColor: theme.bg.raised }} />
            <View style={styles.guidanceText}>
              <Text variant="titleMedium" style={{ color: theme.trust.unverified.text }}>
                {openSosCalls === 1 ? 'Someone nearby asked for help' : `${openSosCalls} people nearby asked for help`}
              </Text>
              <Text variant="bodyMedium" style={{ color: theme.text.primary }}>Sent over Bluetooth, not checked by anyone. Tap for the location.</Text>
            </View>
          </Pressable>
        )}

        <View style={styles.section}>
          <Text variant="titleMedium" accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text.primary }]}>
            {center.source === 'viewing' ? `Alerts near ${center.name ?? 'this place'}` : 'Alerts near you'}
          </Text>

          {isOffline && cachedAt && nearby.length > 0 && (
            <Text
              variant="bodyMedium"
              style={[styles.savedNote, { color: theme.text.secondary, fontVariant: ['tabular-nums'] }]}
            >
              Saved {formatTimeAgo(cachedAt)}
            </Text>
          )}

          {center.source === 'demo' && center.problem && (
            // Never silently show someone else's area as "near you".
            <View style={styles.savedNote}>
              <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
                {center.problem === 'denied'
                  ? 'Location is off for Moby, so these are alerts around San Francisco, not where you are.'
                  : 'Can’t find where you are yet, so these are alerts around San Francisco.'}
              </Text>
              <Button
                mode="text"
                onPress={() => (center.problem === 'denied' ? Linking.openSettings() : retryLocation())}
                style={styles.alignStart}
                textColor={theme.text.primary}
              >
                {center.problem === 'denied' ? 'Turn on location' : 'Try again'}
              </Button>
            </View>
          )}

          {loading ? (
            <LoadingCards theme={theme} />
          ) : error ? (
            <Text variant="bodyLarge" style={{ color: theme.text.secondary }}>
              {error}
            </Text>
          ) : visible.length === 0 && !cachedAt ? (
            <NotCheckedState theme={theme} isOffline={isOffline} />
          ) : visible.length === 0 ? (
            <EmptyState theme={theme} radiusKm={radiusKm} checkedAt={cachedAt} hiddenCount={hiddenCount} />
          ) : (
            <View style={styles.cards}>
              {visible.map(({ alert, distanceKm }) => (
                <AlertCard
                  key={alert.alert_id}
                  alert={alert}
                  distanceKm={distanceKm}
                  onPress={() => onAlertPress(alert.alert_id)}
                />
              ))}
            </View>
          )}

          {!loading && hasMore && (
            <Button
              mode="text"
              onPress={onSeeAllPress}
              style={styles.seeAll}
              contentStyle={styles.tapTarget}
              textColor={theme.text.primary}
              accessibilityLabel={`See all ${nearby.length} alerts`}
            >
              See all alerts
            </Button>
          )}
        </View>

        <View style={styles.section}>
          <Text variant="titleMedium" accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text.primary }]}>
            Map
          </Text>
          <MapPreviewCard
            nearby={nearby}
            radiusKm={radiusKm}
            isOffline={isOffline}
            onPress={onMapPress}
            onRadiusPress={() => setPickerVisible(true)}
          />
        </View>

        <View style={styles.section}>
          <Text variant="titleMedium" accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text.primary }]}>
            Get ready, get help
          </Text>
          <Pressable
            onPress={onHelpPress}
            accessibilityRole="button"
            accessibilityLabel="I need help. Your exact location and emergency numbers. Works without signal."
            style={[styles.helpRow, { backgroundColor: theme.bg.raised, borderColor: theme.line.hairline }]}
          >
            <Avatar.Icon size={44} icon="lifebuoy" style={{ backgroundColor: theme.bg.recessed }} color={theme.severity.critical} />
            <View style={styles.guidanceText}>
              <Text variant="titleMedium" style={{ color: theme.text.primary }}>I need help</Text>
              <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>Your exact location and emergency numbers. Works without signal.</Text>
            </View>
          </Pressable>
          <View style={styles.tiles}>
            <Tile theme={theme} icon="book-open-variant" title="What to do" note="Works offline" onPress={onGuidancePress}
              label="Safety guidance. What to do in a flood, fire, quake or storm. Works without signal." />
            <Tile theme={theme} icon="map-marker-path" title="Check a route" note="Hazards on the way" onPress={onRouteCheckPress}
              label="Check a route. See whether the way to somewhere crosses a known hazard." />
            {onTripPress && (
              <Tile theme={theme} icon="bag-personal-outline" title="Before you go" note="Save a safety pack" onPress={onTripPress}
                label="Before you go. Check a destination and save it for offline." />
            )}
            {myReports.length > 0 && (
              // Only once there's something to show: where the person's reports are now.
              <Tile theme={theme} icon="clipboard-text-clock-outline" title="Your reports"
                note={waitingReports ? `${waitingReports} waiting to send` : `${myReports.length} sent`}
                onPress={onMyReportsPress}
                label={`Your reports: ${myReports.length}${waitingReports ? `, ${waitingReports} waiting to send` : ''}`} />
            )}
          </View>
        </View>
      </ScrollView>

      <FAB
        icon="plus"
        label="Report"
        onPress={onReportPress}
        accessibilityLabel="Report a hazard"
        color={theme.brand.onPrimary}
        style={[styles.fab, { right: r.gutter, backgroundColor: theme.brand.primary }]}
      />

      <RadiusPicker
        visible={pickerVisible}
        selected={radiusKm}
        onSelect={(value) => {
          setRadiusKm(value);
          setPickerVisible(false);
        }}
        onDismiss={() => setPickerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Fixed rhythm (spec 6.1): 24 between sections, 12 between cards.
  section: {
    marginBottom: spacing.sectionGap,
  },
  sectionTitle: {
    marginBottom: spacing.scale[2],
  },
  header: {
    paddingTop: spacing.scale[3],
    paddingBottom: spacing.scale[5],
    marginBottom: spacing.sectionGap,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[1],
  },
  statusPill: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[1],
    paddingVertical: spacing.scale[0],
    paddingHorizontal: spacing.scale[2],
    borderRadius: radius.pill,
  },
  greeting: {
    marginTop: spacing.scale[4],
  },
  underline: {
    width: 44,
    height: 3,
    borderRadius: 2,
    marginTop: spacing.scale[3],
  },
  helpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[3],
    padding: spacing.scale[4],
    borderRadius: radius.card,
    borderWidth: 1,
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.scale[2],
    marginTop: spacing.scale[2],
  },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 120,
    padding: spacing.scale[3],
    borderRadius: radius.card,
    gap: spacing.scale[1],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  emergencyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[3],
    padding: spacing.scale[4],
    borderRadius: radius.card,
    marginBottom: spacing.sectionGap,
  },
  bannerIcon: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  bannerText: {
    color: '#FFFFFF',
  },
  guidanceText: {
    flex: 1,
    gap: spacing.scale[1],
  },
  alignStart: {
    alignSelf: 'flex-start',
  },
  savedNote: {
    marginTop: -spacing.scale[1],
    marginBottom: spacing.scale[2],
  },
  cards: {
    gap: spacing.scale[2],
  },
  empty: {
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: spacing.scale[6],
    paddingHorizontal: spacing.scale[4],
  },
  emptyTitle: {
    marginTop: spacing.scale[3],
    marginBottom: spacing.scale[1],
    textAlign: 'center',
  },
  centered: {
    textAlign: 'center',
  },
  emptyChecked: {
    marginTop: spacing.scale[3],
    textAlign: 'center',
  },
  notChecked: {
    borderRadius: 16,
    padding: spacing.cardPadding,
  },
  notCheckedBody: {
    marginTop: spacing.scale[1],
  },
  skeleton: {
    borderRadius: 16,
    padding: spacing.cardPadding,
    gap: spacing.scale[2],
  },
  skeletonLine: {
    height: 12,
    borderRadius: radius.chip,
  },
  seeAll: {
    alignSelf: 'flex-start',
    marginTop: spacing.scale[1],
    marginLeft: -spacing.scale[2],
  },
  tapTarget: {
    minHeight: spacing.minTapTarget,
  },
  fab: {
    position: 'absolute',
    bottom: spacing.scale[3],
  },
});
