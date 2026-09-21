import { useMemo, useState } from 'react';
import { FlatList, View, StyleSheet } from 'react-native';
import { List, Surface, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { StatusStrip } from '@/components/StatusStrip';
import { AlertCard } from '@/components/AlertCard';
import { AlertArrival } from '@/components/AlertArrival';
import { useAlerts } from '@/hooks/useAlerts';
import { useNewAlertIds } from '@/hooks/useNewAlertIds';
import { useSubscriptions } from '@/hooks/useSubscriptions';
import type { Alert } from '@/api/types';

interface HomeScreenProps {
  onAlertPress: (alertId: string) => void;
  onGuidancePress: () => void;
  onReportPress: () => void;
  onMapPress: () => void;
}

type SectionItem =
  | { key: string; type: 'status-strip' }
  | { key: string; type: 'error'; message: string }
  | { key: string; type: 'active-alert'; alert: Alert; isNew: boolean }
  | { key: string; type: 'section-header'; title: string }
  | { key: string; type: 'nearby-item'; alert: Alert }
  | { key: string; type: 'map-preview' }
  | { key: string; type: 'conditions-item' }
  | { key: string; type: 'recent-item'; alert: Alert }
  | { key: string; type: 'recent-empty' }
  | { key: string; type: 'actions' };

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function formatRecentTime(isoDate: string): string {
  const date = new Date(isoDate);
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (diffDays < 1) return 'Today';
  if (diffDays < 7) return date.toLocaleDateString('en', { weekday: 'short' });
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

function getUpdatedMinutesAgo(cachedAt: string | null): number | null {
  if (!cachedAt) return null;
  return Math.floor((Date.now() - new Date(cachedAt).getTime()) / 60_000);
}

export function HomeScreen({
  onAlertPress,
  onGuidancePress,
  onReportPress,
}: HomeScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const [locationAvailable] = useState(true);
  const { subscriptions } = useSubscriptions();
  const { alerts, loading, error, isOffline, cachedAt } = useAlerts(37.7749, -122.4194, 50);

  const activeAlerts = useMemo(
    () =>
      alerts
        .filter(
          (a) =>
            a.verification_label === 'official_confirmed' &&
            (!a.expires_at || new Date(a.expires_at).getTime() > Date.now()),
        )
        .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)),
    [alerts],
  );

  const nearbyAlerts = useMemo(
    () =>
      alerts.filter(
        (a) =>
          (a.verification_label === 'unverified_report' ||
            a.verification_label === 'corroborated_report') &&
          (!a.expires_at || new Date(a.expires_at).getTime() > Date.now()),
      ),
    [alerts],
  );

  const recentAlerts = useMemo(
    () => alerts.filter((a) => a.expires_at && new Date(a.expires_at).getTime() <= Date.now()),
    [alerts],
  );

  const newAlertIds = useNewAlertIds(activeAlerts.map((a) => a.alert_id));
  const updatedMinutesAgo = getUpdatedMinutesAgo(cachedAt);

  const data = useMemo<SectionItem[]>(() => {
    const items: SectionItem[] = [];

    items.push({ key: 'status', type: 'status-strip' });

    if (error && alerts.length === 0) {
      items.push({ key: 'error', type: 'error', message: error });
    }

    for (const alert of activeAlerts) {
      items.push({
        key: `active-${alert.alert_id}`,
        type: 'active-alert',
        alert,
        isNew: newAlertIds.has(alert.alert_id),
      });
    }

    if (nearbyAlerts.length > 0) {
      items.push({ key: 'nearby-hdr', type: 'section-header', title: 'Nearby' });
      for (const alert of nearbyAlerts) {
        items.push({ key: `nearby-${alert.alert_id}`, type: 'nearby-item', alert });
      }
    }

    items.push({ key: 'map', type: 'map-preview' });

    items.push({ key: 'conditions-hdr', type: 'section-header', title: 'Conditions' });
    items.push({ key: 'conditions', type: 'conditions-item' });

    items.push({ key: 'recent-hdr', type: 'section-header', title: 'Recent' });
    if (recentAlerts.length > 0) {
      for (const alert of recentAlerts) {
        items.push({ key: `recent-${alert.alert_id}`, type: 'recent-item', alert });
      }
    } else {
      items.push({ key: 'recent-empty', type: 'recent-empty' });
    }

    items.push({ key: 'actions', type: 'actions' });

    return items;
  }, [activeAlerts, nearbyAlerts, recentAlerts, error, alerts.length, newAlertIds]);

  const gutter = r.gutter;

  const renderItem = ({ item }: { item: SectionItem }) => {
    switch (item.type) {
      case 'status-strip':
        return (
          <StatusStrip
            areaCount={subscriptions.length}
            updatedMinutesAgo={updatedMinutesAgo}
            isOffline={isOffline}
            loading={loading}
            locationAvailable={locationAvailable}
          />
        );

      case 'error':
        return (
          <View style={{ paddingHorizontal: gutter, paddingVertical: spacing.scale[3] }}>
            <Text style={{ color: theme.severity.critical, fontSize: typography.body.fontSize }}>
              {item.message}
            </Text>
          </View>
        );

      case 'active-alert':
        return (
          <View style={{ paddingHorizontal: gutter, marginTop: spacing.scale[3] }}>
            <AlertArrival isNew={item.isNew}>
              <AlertCard
                alert={item.alert}
                distanceKm={3.2}
                onPress={() => onAlertPress(item.alert.alert_id)}
              />
            </AlertArrival>
          </View>
        );

      case 'section-header':
        return (
          <View style={{ paddingHorizontal: gutter, marginTop: spacing.scale[5] }}>
            <Text
              style={{
                color: theme.text.primary,
                fontSize: r.heading.fontSize,
                lineHeight: r.heading.lineHeight,
                fontWeight: String(r.heading.fontWeight) as '600',
                marginBottom: spacing.scale[1],
              }}
            >
              {item.title}
            </Text>
          </View>
        );

      case 'nearby-item':
        return (
          <View style={{ paddingHorizontal: gutter }}>
            <Surface
              elevation={0}
              style={{
                backgroundColor: theme.bg.recessed,
                borderWidth: 1,
                borderColor: theme.line.hairline,
                borderRadius: radius.card,
                marginTop: spacing.scale[1],
                overflow: 'hidden',
              }}
            >
              <List.Item
                title={item.alert.headline}
                titleStyle={{
                  color: theme.text.primary,
                  fontSize: typography.body.fontSize,
                  lineHeight: typography.body.lineHeight,
                }}
                titleNumberOfLines={2}
                right={() => (
                  <Text
                    style={{
                      color: theme.text.secondary,
                      fontSize: typography.meta.fontSize,
                      lineHeight: typography.meta.lineHeight,
                      fontVariant: ['tabular-nums'],
                      alignSelf: 'center',
                    }}
                  >
                    {item.alert.affected_radius_km !== undefined
                      ? item.alert.affected_radius_km < 1
                        ? `${(item.alert.affected_radius_km * 1000).toFixed(0)} m`
                        : `${item.alert.affected_radius_km.toFixed(0)} km`
                      : ''}
                  </Text>
                )}
                onPress={() => onAlertPress(item.alert.alert_id)}
                style={{ paddingVertical: spacing.scale[1] }}
              />
            </Surface>
          </View>
        );

      case 'map-preview':
        return (
          <View style={{ paddingHorizontal: gutter, marginTop: spacing.scale[5] }}>
            <Surface
              elevation={0}
              style={{
                backgroundColor: theme.bg.recessed,
                borderWidth: 1,
                borderColor: theme.line.hairline,
                borderRadius: radius.card,
                aspectRatio: 16 / 10,
                justifyContent: 'center',
                alignItems: 'flex-start',
                paddingLeft: spacing.scale[3],
                overflow: 'hidden',
              }}
            >
              <Text
                style={{
                  color: theme.text.faint,
                  fontSize: typography.meta.fontSize,
                  lineHeight: typography.meta.lineHeight,
                }}
              >
                Map
              </Text>
            </Surface>
          </View>
        );

      case 'conditions-item':
        return (
          <View style={{ paddingHorizontal: gutter }}>
            <List.Item
              title="14\u00b0C \u00b7 Rain \u00b7 River rising"
              titleStyle={{
                color: theme.text.primary,
                fontSize: typography.body.fontSize,
                lineHeight: typography.body.lineHeight,
              }}
              style={{ paddingVertical: spacing.scale[1], paddingHorizontal: 0 }}
            />
          </View>
        );

      case 'recent-item':
        return (
          <View style={{ paddingHorizontal: gutter }}>
            <List.Item
              title={item.alert.headline}
              titleStyle={{
                color: theme.text.secondary,
                fontSize: typography.body.fontSize,
                lineHeight: typography.body.lineHeight,
              }}
              titleNumberOfLines={2}
              right={() => (
                <Text
                  style={{
                    color: theme.text.faint,
                    fontSize: typography.meta.fontSize,
                    lineHeight: typography.meta.lineHeight,
                    fontVariant: ['tabular-nums'],
                    alignSelf: 'center',
                  }}
                >
                  {item.alert.expires_at ? formatRecentTime(item.alert.expires_at) : ''}
                </Text>
              )}
              style={{
                paddingVertical: spacing.scale[1],
                paddingHorizontal: 0,
                borderBottomWidth: 1,
                borderBottomColor: theme.line.hairline,
              }}
            />
          </View>
        );

      case 'recent-empty':
        return (
          <View style={{ paddingHorizontal: gutter, paddingVertical: spacing.scale[2] }}>
            <Text
              style={{
                color: theme.text.faint,
                fontSize: typography.meta.fontSize,
                lineHeight: typography.meta.lineHeight,
              }}
            >
              No recent events in your area
            </Text>
          </View>
        );

      case 'actions':
        return (
          <View
            style={{
              flexDirection: 'row',
              gap: spacing.scale[2],
              paddingHorizontal: gutter,
              marginTop: spacing.scale[5],
              marginBottom: spacing.scale[5],
            }}
          >
            <Surface
              elevation={1}
              style={[
                actionStyles.button,
                { backgroundColor: theme.bg.raised, borderRadius: radius.card },
              ]}
            >
              <button
                onClick={onGuidancePress}
                aria-label="View safety guidance"
                style={{
                  ...actionStyles.inner,
                  color: theme.text.primary,
                  fontFamily: typography.body.fontFamily,
                  fontSize: typography.body.fontSize,
                  fontWeight: 600,
                }}
              >
                What to do
              </button>
            </Surface>
            <Surface
              elevation={1}
              style={[
                actionStyles.button,
                { backgroundColor: theme.bg.raised, borderRadius: radius.card },
              ]}
            >
              <button
                onClick={onReportPress}
                aria-label="Submit a hazard report"
                style={{
                  ...actionStyles.inner,
                  color: theme.text.primary,
                  fontFamily: typography.body.fontFamily,
                  fontSize: typography.body.fontSize,
                  fontWeight: 600,
                }}
              >
                Report
              </button>
            </Surface>
          </View>
        );
    }
  };

  return (
    <FlatList
      data={data}
      renderItem={renderItem}
      keyExtractor={(item: SectionItem) => item.key}
      style={{ flex: 1, backgroundColor: theme.bg.base }}
      contentContainerStyle={{ paddingBottom: spacing.scale[3] }}
    />
  );
}

const actionStyles = StyleSheet.create({
  button: {
    flex: 1,
    overflow: 'hidden',
  },
  inner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    width: '100%',
  } as any,
});
