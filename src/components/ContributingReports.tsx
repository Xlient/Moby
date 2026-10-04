import { View, StyleSheet } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { SeverityIndicator } from '@/components/SeverityIndicator';
import { effectLabel, formatDistanceFromEvent, formatTimeAgo } from '@/lib/alerts';
import type { EventReports } from '@/api/types';

interface ContributingReportsProps {
  data: EventReports | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

/**
 * "What people reported": the community reports behind an alert. Deliberately
 * shows no notes or names — only what was seen, when, and roughly where.
 */
export function ContributingReports({ data, loading, error, onRetry }: ContributingReportsProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const heading = [r.heading, { color: theme.text.primary }];
  const meta = [typography.meta, { color: theme.text.secondary }];

  let body: React.ReactNode;
  if (loading) {
    body = <Text style={[meta, styles.status]}>Loading reports…</Text>;
  } else if (error) {
    body = (
      <>
        <Text style={[meta, styles.status]}>Couldn’t load the reports.</Text>
        <Button mode="text" onPress={onRetry} style={styles.alignStart}>
          Try again
        </Button>
      </>
    );
  } else if (!data || data.reports.length === 0) {
    body = <Text style={[meta, styles.status]}>No individual reports to show yet.</Text>;
  } else {
    const people = data.distinct_reporter_count;
    const n = data.reports.length;
    body = (
      <>
        <Text style={[meta, styles.status]}>
          {n} {n === 1 ? 'report' : 'reports'} from {people} {people === 1 ? 'person' : 'people'}
        </Text>
        {data.reports.map((rep, i) => (
          <View
            key={i}
            style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line.hairline }]}
          >
            <View style={styles.rowMain}>
              <Text style={[typography.bodyStrong, { color: theme.text.primary }]}>
                {effectLabel(rep.observed_effect)}
              </Text>
              <Text style={meta}>
                {formatTimeAgo(rep.observed_at)} · {formatDistanceFromEvent(rep.distance_from_event_m)}
                {rep.via_mesh ? ' · via nearby phones' : rep.captured_offline ? ' · sent after reconnecting' : ''}
              </Text>
            </View>
            <SeverityIndicator severity={rep.severity} size="small" />
          </View>
        ))}
      </>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: theme.bg.raised, padding: r.cardPadding }]}
      accessibilityLabel="What people reported"
    >
      <Text accessibilityRole="header" style={heading}>What people reported</Text>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.card,
    marginTop: spacing.scale[3],
  },
  status: {
    marginTop: spacing.scale[2],
  },
  alignStart: {
    alignSelf: 'flex-start',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[3],
    paddingVertical: spacing.scale[3],
  },
  rowMain: {
    flex: 1,
    gap: spacing.scale[1],
  },
});
