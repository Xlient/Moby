import { useState } from 'react';
import { Linking, ScrollView, View, StyleSheet } from 'react-native';
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
import { RadiusPicker } from '@/components/RadiusPicker';
import { formatTimeAgo } from '@/lib/alerts';

interface HomeScreenProps {
  onReportPress: () => void;
  onAlertPress: (alertId: string) => void;
  onSeeAllPress: () => void;
  onMapPress: () => void;
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

export function HomeScreen({ onReportPress, onAlertPress, onSeeAllPress, onMapPress }: HomeScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const { firstName } = useAuth();
  const { nearby, hiddenCount, radiusKm, setRadiusKm, loading, error, isOffline, cachedAt, center } = useNearbyAlerts();
  const [pickerVisible, setPickerVisible] = useState(false);
  const retryLocation = useRetryLocation();

  const greeting = firstName
    ? `${greetingFor(new Date().getHours())}, ${firstName}`
    : greetingFor(new Date().getHours());
  // Offline changes the subline only — no banner (spec v3, H1).
  const subline = isOffline ? 'Offline — showing saved info' : `Watching within ${radiusKm} km`;

  const visible = nearby.slice(0, MAX_HOME_CARDS);
  const hasMore = nearby.length > MAX_HOME_CARDS;

  return (
    <View style={[styles.container, { backgroundColor: theme.bg.base }]}>
      {/* One vertical scroll; nothing inside it scrolls on its own. */}
      <ScrollView
        contentContainerStyle={{
          paddingTop: spacing.scale[3],
          paddingHorizontal: r.gutter,
          paddingBottom: FAB_CLEARANCE + spacing.scale[3],
        }}
      >
        <View style={styles.section}>
          <Text variant="headlineMedium" accessibilityRole="header" style={{ color: theme.text.primary }}>
            {greeting}
          </Text>
          <View style={styles.sublineRow}>
            <View
              style={[styles.dot, { backgroundColor: isOffline ? theme.text.faint : theme.accent.calm }]}
            />
            <Text variant="bodyLarge" style={[styles.subline, { color: theme.text.secondary }]}>
              {subline}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text variant="titleMedium" accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text.primary }]}>
            Alerts near you
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
      </ScrollView>

      <FAB
        icon="plus"
        label="Report"
        onPress={onReportPress}
        accessibilityLabel="Report a hazard"
        style={[styles.fab, { right: r.gutter }]}
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
  sublineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.scale[0],
    gap: spacing.scale[1],
  },
  subline: {
    flexShrink: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
