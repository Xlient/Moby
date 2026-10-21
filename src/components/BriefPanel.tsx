import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import type { SituationalBrief } from '@/api/types';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useResponsive } from '@/hooks/useResponsive';
import { useTheme } from '@/theme/ThemeContext';
import { radius, spacing, typography } from '@/theme/tokens';
import { BriefSheet, Byline } from './brief/BriefSheet';
import { FlagAction } from './FlagContent';
import { TimelineStrip } from './brief/BriefTimeline';

interface BriefPanelProps {
  state:
    | { status: 'idle' }
    | { status: 'pending'; retryAfterSeconds: number }
    | { status: 'ready'; brief: SituationalBrief }
    | { status: 'failed'; error: string };
  onRetry?: () => void;
}

/**
 * The situation brief's card on an alert: a short, inviting preview (summary, a timeline
 * strip, who reported) that opens the full brief. While Nemotron Ultra writes it, a calm
 * shimmer says so; when it lands, the card rises in and its call to action nudges once.
 */
export function BriefPanel({ state, onRetry }: BriefPanelProps) {
  if (state.status === 'idle') return null;
  if (state.status === 'pending') return <PendingCard />;
  if (state.status === 'failed') return <FailedCard error={state.error} onRetry={onRetry} />;
  return <ReadyCard brief={state.brief} />;
}

function Card({ children, label }: { children: React.ReactNode; label: string }) {
  const { theme } = useTheme();
  const r = useResponsive();
  return (
    <View
      style={[styles.card, { backgroundColor: theme.bg.raised, borderTopColor: theme.accent.calm, padding: r.cardPadding }]}
      accessibilityLabel={label}
    >
      {children}
    </View>
  );
}

function Title({ children }: { children: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.titleRow}>
      <Icon source="text-box-search-outline" size={20} color={theme.accent.calm} />
      <Text accessibilityRole="header" style={[typography.heading, { color: theme.text.primary }]}>
        {children}
      </Text>
    </View>
  );
}

function PendingCard() {
  const { theme } = useTheme();
  const reduce = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce]);
  const shimmer = { opacity: reduce ? 0.6 : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] }) };
  return (
    <Card label="Moby is writing the situation brief">
      <Title>Situation brief</Title>
      <Text style={[typography.meta, styles.gap, { color: theme.text.secondary }]}>
        Moby is reading the warning and what people nearby reported…
      </Text>
      <View style={styles.skeleton} accessibilityElementsHidden>
        {[0.95, 0.8, 0.55].map((w, i) => (
          <Animated.View key={i} style={[styles.bar, shimmer, { width: `${w * 100}%`, backgroundColor: theme.bg.recessed }]} />
        ))}
        <Animated.View style={[styles.stripSkeleton, shimmer, { backgroundColor: theme.bg.recessed }]} />
      </View>
    </Card>
  );
}

function FailedCard({ error, onRetry }: { error: string; onRetry?: () => void }) {
  const { theme } = useTheme();
  return (
    <Card label="Situation brief unavailable">
      <Title>Situation brief</Title>
      <Text style={[typography.meta, styles.gap, { color: theme.text.secondary }]}>{error}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} accessibilityRole="button" style={styles.gap}>
          <Text style={[typography.label, { color: theme.accent.calm }]}>Try again</Text>
        </Pressable>
      )}
    </Card>
  );
}

function ReadyCard({ brief }: { brief: SituationalBrief }) {
  const { theme } = useTheme();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const [enter] = useState(() => new Animated.Value(0));
  const [nudge] = useState(() => new Animated.Value(0));

  // Rise in, then nudge the call to action once: "there's more here".
  useEffect(() => {
    if (reduce) return enter.setValue(1);
    Animated.sequence([
      Animated.timing(enter, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(nudge, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(nudge, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(nudge, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(nudge, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]),
    ]).start();
  }, [enter, nudge, reduce]);

  const timeline = brief.timeline ?? [];
  // Reports, not people: one person can appear in two groups (they saw two things).
  const reports = timeline.reduce((n, e) => n + (e.times?.length ?? 0), 0);
  const until = timeline.find((e) => e.type === 'expires' && new Date(e.at).getTime() > openedAt);
  const official = (brief.citations ?? []).some((c) => c.kind === 'official');
  const newSince = timeline.filter((e) => e.after_brief).length;

  return (
    <Animated.View
      style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}
    >
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Situation brief. Open the full brief"
        style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
      >
        <Card label="Situation brief">
          <View style={styles.titleRow}>
            <View style={styles.flex}>
              <Title>Situation brief</Title>
            </View>
            {brief.changes ? <Badge icon="update">Updated</Badge> : newSince > 0 ? <Badge icon="bell-ring-outline">{`${newSince} new`}</Badge> : null}
          </View>
          <Byline brief={brief} />
          <Text style={[typography.body, styles.gap, { color: theme.text.primary }]} numberOfLines={3}>
            {brief.summary}
          </Text>
          {timeline.length > 0 && (
            <View style={styles.gap}>
              <TimelineStrip entries={timeline} />
              <View style={styles.legend}>
                {official && <Legend color={theme.trust.official.text} label="Official" />}
                {reports > 0 && (
                  <Legend color={theme.trust.unverified.border} label={`${reports} ${reports === 1 ? 'report' : 'reports'} nearby`} ring />
                )}
                <Legend color={theme.accent.calm} label="Now" bar />
                {until && (
                  <Legend
                    color={theme.trust.official.border}
                    label={`Until ${new Date(until.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                    ring
                  />
                )}
              </View>
            </View>
          )}
          <View style={[styles.cta, styles.gap]}>
            <Text style={[typography.label, { color: theme.accent.calm }]}>Read the full brief</Text>
            <Animated.View style={{ transform: [{ translateX: nudge.interpolate({ inputRange: [0, 1], outputRange: [0, 5] }) }] }}>
              <Icon source="arrow-right" size={18} color={theme.accent.calm} />
            </Animated.View>
          </View>
          <View style={styles.gap}>
            <FlagAction target={{ kind: 'brief', targetId: brief.event_id }} />
          </View>
        </Card>
      </Pressable>
      <BriefSheet brief={brief} visible={open} onClose={() => setOpen(false)} />
    </Animated.View>
  );
}

function Badge({ icon, children }: { icon: string; children: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.badge, { borderColor: theme.accent.calm }]}>
      <Icon source={icon} size={13} color={theme.accent.calm} />
      <Text style={[typography.label, { color: theme.accent.calm }]}>{children}</Text>
    </View>
  );
}

function Legend({ color, label, ring, bar }: { color: string; label: string; ring?: boolean; bar?: boolean }) {
  const { theme } = useTheme();
  return (
    <View style={styles.legendItem}>
      <View
        style={
          bar
            ? [styles.legendBar, { backgroundColor: color }]
            : [styles.legendDot, { borderColor: color, backgroundColor: ring ? 'transparent' : color }]
        }
      />
      <Text style={[typography.meta, { color: theme.text.secondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderRadius: radius.card, borderTopWidth: 3, marginTop: spacing.scale[3] },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.scale[2] },
  gap: { marginTop: spacing.scale[2] },
  skeleton: { gap: spacing.scale[2], marginTop: spacing.scale[3] },
  bar: { height: 12, borderRadius: 6 },
  stripSkeleton: { height: 8, borderRadius: 4, marginTop: spacing.scale[2] },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.scale[3], marginTop: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
  legendBar: { width: 2, height: 11, borderRadius: 1 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: spacing.scale[1] },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.scale[2],
    paddingVertical: 1,
  },
});
