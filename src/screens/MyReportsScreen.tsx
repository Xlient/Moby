import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Avatar, Button, Icon, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useReportQueue } from '@/hooks/useReportQueue';
import { ScreenHeader } from '@/components/ScreenHeader';
import { flushReportQueue, refreshReportStatuses, type QueuedReport } from '@/lib/reportQueue';
import { reportStatus, type ReportTone } from '@/lib/reportStatus';
import { formatTimeAgo, hazardIcon, severityLabel } from '@/lib/alerts';
import type { Theme } from '@/theme/tokens';

interface MyReportsScreenProps {
  onBack: () => void;
  onNewReport: () => void;
}

const HAZARD_NAMES: Record<string, string> = {
  flood: 'Flooding',
  fire: 'Fire or smoke',
  landslide: 'Landslide',
  storm: 'Storm or wind',
  earthquake: 'Earthquake',
  other: 'Something else',
};

function toneColor(theme: Theme, tone: ReportTone): string {
  if (tone === 'good') return theme.accent.calm;
  if (tone === 'problem') return theme.severity.high;
  return theme.text.secondary;
}

function ReportRow({ report, theme }: { report: QueuedReport; theme: Theme }) {
  const s = report.submission;
  const status = reportStatus(report);
  const color = toneColor(theme, status.tone);
  return (
    <View
      style={[styles.row, { backgroundColor: theme.bg.raised }]}
      accessible
      accessibilityLabel={`${HAZARD_NAMES[s.hazard_type]}, ${s.severity}, ${formatTimeAgo(s.observed_at)}. ${status.title}. ${status.detail}`}
    >
      <Avatar.Icon size={40} icon={hazardIcon(s.hazard_type)} color={theme.text.primary} style={{ backgroundColor: theme.bg.recessed }} />
      <View style={styles.rowText}>
        <View style={styles.rowTop}>
          <Text variant="titleMedium" style={[styles.grow, { color: theme.text.primary }]} numberOfLines={1}>
            {HAZARD_NAMES[s.hazard_type]}
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.severity[s.severity], fontVariant: ['tabular-nums'] }}>
            {severityLabel(s.severity)}
          </Text>
        </View>
        <Text variant="bodyMedium" style={{ color: theme.text.faint, fontVariant: ['tabular-nums'] }}>
          {formatTimeAgo(s.observed_at)}
          {s.captured_offline ? ' · made offline' : ''}
        </Text>
        <View style={styles.status}>
          <Icon source={status.tone === 'good' ? 'check-circle' : status.tone === 'problem' ? 'alert-circle-outline' : 'progress-clock'} size={18} color={color} />
          <Text variant="titleSmall" style={{ color }}>{status.title}</Text>
        </View>
        <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>{status.detail}</Text>
      </View>
    </View>
  );
}

/**
 * The reports this phone sent (sprint 3): each one's journey from
 * the offline queue to the fusion pipeline's outcome (GET /reports/{client_event_id}).
 */
export function MyReportsScreen({ onBack, onNewReport }: MyReportsScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const isOnline = useOnlineStatus();
  const reports = useReportQueue();
  const [refreshing, setRefreshing] = useState(false);
  const newestFirst = [...reports].reverse();
  const waiting = reports.filter((x) => x.state === 'queued').length;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await flushReportQueue(true);
      await refreshReportStatuses();
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Fusion runs after the 202, so pick up new outcomes whenever the list opens online.
  useEffect(() => {
    if (isOnline) void refreshReportStatuses();
  }, [isOnline]);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Your reports" onBack={onBack} />
      <FlatList
        data={newestFirst}
        keyExtractor={(x) => x.submission.client_event_id}
        renderItem={({ item }) => <ReportRow report={item} theme={theme} />}
        contentContainerStyle={{ padding: r.gutter, gap: spacing.scale[2], flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListHeaderComponent={
          <Text variant="bodyMedium" style={[styles.intro, { color: theme.text.secondary }]}>
            {!isOnline && waiting > 0
              ? `Offline. ${waiting} report${waiting === 1 ? '' : 's'} will send when you have signal.`
              : 'Reports are checked against others nearby and official sources, then by a person, before anyone is alerted.'}
          </Text>
        }
        ListEmptyComponent={
          <View style={[styles.empty, { backgroundColor: theme.bg.recessed }]}>
            <Text variant="titleMedium" style={{ color: theme.text.primary }}>No reports yet</Text>
            <Text variant="bodyLarge" style={{ color: theme.text.secondary, textAlign: 'center' }}>
              If you see flooding, fire, a landslide or storm damage, a quick report helps people nearby.
            </Text>
            <Button mode="contained-tonal" icon="plus" onPress={onNewReport} style={styles.emptyBtn}>
              Report a hazard
            </Button>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  intro: { marginBottom: spacing.scale[2] },
  row: {
    flexDirection: 'row',
    gap: spacing.scale[3],
    padding: spacing.cardPadding,
    borderRadius: 16,
  },
  rowText: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.scale[2] },
  grow: { flex: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.scale[1], marginTop: spacing.scale[1] },
  empty: {
    alignItems: 'center',
    gap: spacing.scale[2],
    borderRadius: 16,
    paddingVertical: spacing.scale[6],
    paddingHorizontal: spacing.scale[4],
  },
  emptyBtn: { marginTop: spacing.scale[2] },
});
