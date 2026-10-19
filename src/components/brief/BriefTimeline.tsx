import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { SituationalBrief } from '@/api/types';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { formatTimeAgo } from '@/lib/alerts';
import { useTheme } from '@/theme/ThemeContext';
import { radius, spacing, typography, type Theme } from '@/theme/tokens';

// What happened, in order: the official warning (blue) and what people reported (violet),
// with a "now" marker. Built by the server from the database, not by the model.

export type TimelineEntry = NonNullable<SituationalBrief['timeline']>[number];

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function when(entry: TimelineEntry, now: number): string {
  const at = new Date(entry.at).getTime();
  if (at > now) return `${clock(entry.at)}`;
  if (entry.until && entry.until !== entry.at) return `${clock(entry.at)}–${clock(entry.until)} · last ${formatTimeAgo(entry.until, now)}`;
  return `${clock(entry.at)} · ${formatTimeAgo(entry.at, now)}`;
}

function dotColor(entry: TimelineEntry, theme: Theme) {
  return entry.kind === 'official' ? theme.trust.official : theme.trust.unverified;
}

type Row = { type: 'entry'; entry: TimelineEntry } | { type: 'now' };

/** Entries with "Now" slotted in between the past and anything still to come (a warning's end). */
function withNow(entries: TimelineEntry[], now: number): Row[] {
  const rows: Row[] = [];
  let placed = false;
  for (const entry of entries) {
    if (!placed && new Date(entry.at).getTime() > now) {
      rows.push({ type: 'now' });
      placed = true;
    }
    rows.push({ type: 'entry', entry });
  }
  if (!placed) rows.push({ type: 'now' });
  return rows;
}

/** Full timeline for the brief sheet. Rows rise in one after another when `animate`. */
export function BriefTimeline({ entries, animate = true }: { entries: TimelineEntry[]; animate?: boolean }) {
  const { theme } = useTheme();
  const reduce = useReducedMotion();
  const [now] = useState(() => Date.now());
  const rows = useMemo(() => withNow(entries, now), [entries, now]);
  const [progress] = useState(() => rows.map(() => new Animated.Value(animate ? 0 : 1)));

  useEffect(() => {
    if (!animate || reduce) {
      progress.forEach((p) => p.setValue(1));
      return;
    }
    Animated.stagger(
      70,
      progress.map((p) =>
        Animated.timing(p, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ),
    ).start();
  }, [animate, reduce, progress]);

  if (entries.length === 0) return null;

  return (
    <View accessibilityRole="list" accessibilityLabel="Timeline">
      {rows.map((row, i) => {
        const p = progress[i] ?? new Animated.Value(1);
        const last = i === rows.length - 1;
        const style = { opacity: p, transform: [{ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] };
        return (
          <Animated.View key={i} style={[styles.row, style]}>
            <View style={styles.rail}>
              {row.type === 'now' ? (
                <View style={[styles.nowDot, { backgroundColor: theme.accent.calm, borderColor: theme.bg.raised }]} />
              ) : (
                <Dot entry={row.entry} now={now} />
              )}
              {!last && <View style={[styles.line, { backgroundColor: theme.line.hairline }]} />}
            </View>
            {row.type === 'now' ? (
              <View style={styles.content}>
                <Text style={[typography.label, { color: theme.accent.calm }]}>Now</Text>
              </View>
            ) : (
              <EntryContent entry={row.entry} now={now} />
            )}
          </Animated.View>
        );
      })}
    </View>
  );
}

function Dot({ entry, now }: { entry: TimelineEntry; now: number }) {
  const { theme } = useTheme();
  const c = dotColor(entry, theme);
  const future = new Date(entry.at).getTime() > now;
  // Official: filled. Community: a ring on its pale fill (dashes break up at this size on Android).
  // Future (a warning's end): hollow.
  const filled = entry.kind === 'official' && !future;
  return <View style={[styles.dot, { backgroundColor: filled ? c.text : c.bg, borderColor: c.border }]} />;
}

function EntryContent({ entry, now }: { entry: TimelineEntry; now: number }) {
  const { theme } = useTheme();
  const c = dotColor(entry, theme);
  const who =
    entry.kind === 'official'
      ? entry.detail
      : `${entry.reporters} ${entry.reporters === 1 ? 'person' : 'people'} nearby · unverified`;
  return (
    <View style={styles.content} accessible accessibilityLabel={`${entry.label}. ${who}. ${when(entry, now)}`}>
      <View style={styles.titleRow}>
        <Text style={[typography.bodyStrong, styles.flex, { color: theme.text.primary }]}>{entry.label}</Text>
        {entry.after_brief && (
          <View style={[styles.newPill, { borderColor: theme.accent.calm }]}>
            <Text style={[typography.label, { color: theme.accent.calm }]}>New</Text>
          </View>
        )}
      </View>
      <Text style={[typography.meta, { color: c.text }]}>{who}</Text>
      <Text style={[typography.meta, { color: theme.text.secondary }]}>{when(entry, now)}</Text>
      {entry.kind === 'community' && (entry.times?.length ?? 0) > 1 && <ReportTicks entry={entry} />}
    </View>
  );
}

/** One tick per report across the group's time span: how reports built up. */
function ReportTicks({ entry }: { entry: TimelineEntry }) {
  const { theme } = useTheme();
  const times = (entry.times ?? []).map((t) => new Date(t).getTime());
  const start = Math.min(...times);
  const span = Math.max(...times) - start || 1;
  return (
    <View style={[styles.ticks, { backgroundColor: theme.trust.unverified.bg }]}>
      {times.map((t, i) => (
        <View
          key={i}
          style={[styles.tick, { left: `${((t - start) / span) * 94 + 3}%`, backgroundColor: theme.trust.unverified.border }]}
        />
      ))}
    </View>
  );
}

/** A one-line strip for the teaser card: every entry as a dot across time, with "now". */
export function TimelineStrip({ entries }: { entries: TimelineEntry[] }) {
  const { theme } = useTheme();
  const [now] = useState(() => Date.now());
  // The past only, up to now: a warning's end hours away would squash everything else to one edge
  // (the card's legend says "until …" instead).
  const points = entries
    .flatMap((e) =>
      e.kind === 'community' && e.times?.length ? e.times.map((t) => ({ t: new Date(t).getTime(), e })) : [{ t: new Date(e.at).getTime(), e }],
    )
    .filter((p) => p.t <= now);
  if (points.length === 0) return null;
  const start = Math.min(...points.map((p) => p.t));
  const end = now;
  const pos = (t: number) => `${((t - start) / (end - start || 1)) * 92 + 4}%` as const;
  return (
    <View style={styles.strip} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.stripLine, { backgroundColor: theme.line.hairline }]} />
      {points.map((p, i) => {
        const c = dotColor(p.e, theme);
        return (
          <View
            key={i}
            style={[
              styles.stripDot,
              { left: pos(p.t), backgroundColor: p.e.kind === 'official' ? c.text : c.bg, borderColor: c.border },
            ]}
          />
        );
      })}
      <View style={[styles.stripNow, { left: pos(now), backgroundColor: theme.accent.calm }]} />
    </View>
  );
}

const DOT = 14;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.scale[2] },
  rail: { width: DOT + 4, alignItems: 'center' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2, marginTop: 5 },
  nowDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, marginTop: 4 },
  line: { width: 2, flex: 1, marginVertical: 2, borderRadius: 1 },
  content: { flex: 1, paddingBottom: spacing.scale[4], gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.scale[2] },
  newPill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.scale[2], paddingVertical: 1 },
  ticks: { height: 8, borderRadius: radius.pill, marginTop: spacing.scale[1], position: 'relative' },
  tick: { position: 'absolute', top: 1, width: 6, height: 6, borderRadius: 3, marginLeft: -3 },
  strip: { height: 18, justifyContent: 'center', position: 'relative' },
  stripLine: { height: 2, borderRadius: 1, marginHorizontal: '4%' },
  stripDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, marginLeft: -5 },
  stripNow: { position: 'absolute', width: 2, height: 16, borderRadius: 1, marginLeft: -1 },
});
