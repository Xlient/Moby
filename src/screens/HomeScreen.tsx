import { useState, useEffect, useMemo } from 'react';
import { ScrollView, View, Pressable, StyleSheet } from 'react-native';
import { Text, FAB } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing, radius } from '@/theme/tokens';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useAuth } from '@/auth/AuthContext';
import { useNearbyRadius } from '@/hooks/useNearbyRadius';
import { AlertCard } from '@/components/AlertCard';
import { MapPreviewCard } from '@/components/MapPreviewCard';
import { RadiusPicker, RadiusChip } from '@/components/RadiusPicker';
import { mockAlerts } from '@/api/fixtures';
import { USER_CENTER, distanceKm } from '@/screens/MapScreen';
import type { Alert, Severity } from '@/api/types';

interface HomeScreenProps {
  onReportPress: () => void;
  onAlertPress: (alertId: string) => void;
  onSeeAllPress: () => void;
  onMapPress: () => void;
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const MAX_HOME_CARDS = 3;

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function getFirstName(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const first = displayName.trim().split(/\s+/)[0];
  return first || null;
}

function getSublineText(isOnline: boolean): string {
  if (!isOnline) return 'Offline \u2014 showing saved data';
  return 'All clear near you';
}

function EmptyState({
  theme,
  radiusKm,
}: {
  theme: ReturnType<typeof useTheme>['theme'];
  radiusKm: number;
}) {
  return (
    <View
      style={[
        styles.emptyContainer,
        {
          backgroundColor: theme.bg.recessed,
          borderRadius: radius.card,
        },
      ]}
      accessibilityLabel={`No active alerts within ${radiusKm} kilometres`}
    >
      <svg width={48} height={48} viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <circle cx="24" cy="24" r="20" stroke={theme.accent.calm} strokeWidth="2" opacity={0.5} />
        <path
          d="M16 24l6 6 10-12"
          stroke={theme.accent.calm}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <Text
        variant="titleMedium"
        style={{ color: theme.text.primary, marginTop: spacing.scale[2] }}
      >
        All clear
      </Text>
      <Text
        variant="bodyMedium"
        style={{
          color: theme.text.secondary,
          marginTop: spacing.scale[0],
          textAlign: 'center',
        }}
      >
        No active alerts within {radiusKm} km
      </Text>
    </View>
  );
}

function LoadingSkeleton({ theme }: { theme: ReturnType<typeof useTheme>['theme'] }) {
  return (
    <View style={{ gap: spacing.scale[2] }}>
      {[0, 1].map((i) => (
        <View
          key={i}
          style={[
            styles.skeletonCard,
            {
              backgroundColor: theme.bg.recessed,
              borderRadius: radius.card,
            },
          ]}
        >
          <View
            style={[styles.skeletonLine, styles.skeletonShort, { backgroundColor: theme.line.hairline }]}
          />
          <View
            style={[styles.skeletonLine, styles.skeletonLong, { backgroundColor: theme.line.hairline }]}
          />
          <View
            style={[styles.skeletonLine, styles.skeletonMedium, { backgroundColor: theme.line.hairline }]}
          />
        </View>
      ))}
    </View>
  );
}

export function HomeScreen({ onReportPress, onAlertPress, onSeeAllPress, onMapPress }: HomeScreenProps) {
  const { theme } = useTheme();
  const isOnline = useOnlineStatus();
  const { user } = useAuth();
  const [nearbyRadius, setNearbyRadius] = useNearbyRadius();
  const [pickerVisible, setPickerVisible] = useState(false);

  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAlerts(mockAlerts);
      setLoading(false);
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  const filteredAlerts = useMemo(
    () =>
      alerts.filter((a) => {
        if (!a.location) return false;
        return distanceKm(USER_CENTER.lat, USER_CENTER.lon, a.location.lat, a.location.lon) <= nearbyRadius;
      }),
    [alerts, nearbyRadius],
  );

  const sortedAlerts = useMemo(
    () =>
      [...filteredAlerts].sort(
        (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9),
      ),
    [filteredAlerts],
  );

  const visibleAlerts = sortedAlerts.slice(0, MAX_HOME_CARDS);
  const hasMore = sortedAlerts.length > MAX_HOME_CARDS;

  const firstName = getFirstName(user?.displayName);
  const greeting = firstName ? `${getGreeting()}, ${firstName}` : getGreeting();
  const subline = getSublineText(isOnline);

  return (
    <View style={[styles.container, { backgroundColor: theme.bg.base }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.greetingSection}>
          <Text
            variant="headlineMedium"
            style={{ color: theme.text.primary }}
          >
            {greeting}
          </Text>

          <View style={styles.sublineRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: isOnline
                    ? theme.accent.calm
                    : theme.text.faint,
                },
              ]}
            />
            <Text
              variant="bodyLarge"
              style={{ color: theme.text.secondary }}
            >
              {subline}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text
              variant="titleMedium"
              style={{ color: theme.text.primary }}
            >
              Alerts near you
            </Text>
            <RadiusChip
              radiusKm={nearbyRadius}
              onPress={() => setPickerVisible(true)}
            />
          </View>

          {loading && <LoadingSkeleton theme={theme} />}

          {!loading && visibleAlerts.length === 0 && (
            <EmptyState theme={theme} radiusKm={nearbyRadius} />
          )}

          {!loading && visibleAlerts.length > 0 && (
            <View style={{ gap: spacing.scale[2] }}>
              {visibleAlerts.map((alert) => (
                <AlertCard
                  key={alert.alert_id}
                  alert={alert}
                  distanceKm={
                    alert.location
                      ? +distanceKm(USER_CENTER.lat, USER_CENTER.lon, alert.location.lat, alert.location.lon).toFixed(1)
                      : undefined
                  }
                  onPress={() => onAlertPress(alert.alert_id)}
                />
              ))}
            </View>
          )}

          {!loading && hasMore && (
            <Pressable
              onPress={onSeeAllPress}
              accessibilityRole="button"
              accessibilityLabel="See all alerts"
              style={[
                styles.seeAll,
                { borderColor: theme.line.hairline },
              ]}
            >
              <Text
                variant="labelLarge"
                style={{ color: theme.accent.calm }}
              >
                See all alerts
              </Text>
            </Pressable>
          )}
        </View>

        <View style={styles.section}>
          <Text
            variant="titleMedium"
            style={{ color: theme.text.primary, marginBottom: spacing.scale[2] }}
          >
            Map
          </Text>
          <MapPreviewCard
            radiusKm={nearbyRadius}
            onPress={onMapPress}
            alertCount={sortedAlerts.length}
          />
        </View>
      </ScrollView>

      <FAB
        icon="plus"
        label="Report"
        onPress={onReportPress}
        style={[
          styles.fab,
          { backgroundColor: theme.bg.raised },
        ]}
        color={theme.text.primary}
      />

      <RadiusPicker
        visible={pickerVisible}
        selected={nearbyRadius}
        onSelect={(value) => {
          setNearbyRadius(value);
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
    position: 'relative',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: spacing.screenGutter,
    paddingHorizontal: spacing.screenGutter,
    paddingBottom: 96,
  },
  greetingSection: {
    marginBottom: spacing.sectionGap,
  },
  sublineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.scale[1],
    gap: spacing.scale[1],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  section: {
    marginBottom: spacing.sectionGap,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.scale[2],
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.sectionGap,
    paddingHorizontal: spacing.scale[4],
  },
  skeletonCard: {
    padding: spacing.scale[3],
    gap: spacing.scale[2],
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
  },
  skeletonShort: {
    width: '30%',
  },
  skeletonLong: {
    width: '85%',
  },
  skeletonMedium: {
    width: '55%',
  },
  seeAll: {
    marginTop: spacing.scale[2],
    paddingVertical: spacing.scale[2],
    paddingHorizontal: spacing.scale[3],
    borderRadius: radius.card,
    borderWidth: 1,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    right: spacing.screenGutter,
    bottom: spacing.screenGutter,
    borderRadius: 16,
  },
});
