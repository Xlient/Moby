import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Linking, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { radius, spacing, typography } from '@/theme/tokens';

// Ask Moby's chat pieces. Colour follows the tokens' rule: Moby's own voice (avatar,
// thinking dots, the stripe on an answer) uses the calm accent; citations and sources use
// the official trust colour, because every source Ask Moby answers from is an official
// alert, official guidance or an official website. The answer itself is never labelled
// official: it's Moby's summary of them.

export interface MessageSource {
  n: number;
  title: string;
  publisher: string;
  url?: string | null;
  note?: string;
}

/** The person's question: right-aligned, on a quiet calm tint. */
export function QuestionBubble({ text }: { text: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.question, { backgroundColor: theme.accent.calmSoft }]}>
      <Text style={[typography.body, { color: theme.text.primary }]}>{text}</Text>
    </View>
  );
}

/** Moby's side of a turn: avatar + name + where it answered from, then the content. */
export function MobyMessage({ via, children, label }: { via: string; children: ReactNode; label?: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.moby} accessibilityLabel={label}>
      <View style={styles.byline}>
        <View style={[styles.avatar, { backgroundColor: theme.accent.calm }]}>
          <Icon source="lifebuoy" size={14} color={theme.bg.raised} />
        </View>
        <Text style={[typography.label, { color: theme.text.primary }]}>Moby</Text>
        <Text style={[typography.meta, { color: theme.text.faint }]}>· {via}</Text>
      </View>
      {children}
    </View>
  );
}

/** A card with the calm stripe on its leading edge. */
export function AnswerSurface({ children, quiet }: { children: ReactNode; quiet?: boolean }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.answer,
        { backgroundColor: theme.bg.raised, borderLeftColor: quiet ? theme.line.hairline : theme.accent.calm },
      ]}
    >
      {children}
    </View>
  );
}

/** Three softly pulsing dots and a line saying what's happening. Static with reduced motion. */
export function ThinkingBubble({ status }: { status: string }) {
  const { theme } = useTheme();
  const [t] = useState(() => new Animated.Value(0));
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((r) => {
      if (cancelled) return;
      setReduce(r);
      if (r) return;
      loop = Animated.loop(
        Animated.timing(t, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [t]);

  // Each dot rises and brightens in turn, then all rest for the last part of the cycle.
  const dot = (i: number) => {
    const start = i * 0.2;
    const inputRange = [0, start, start + 0.2, start + 0.4, 1];
    const style = reduce
      ? { opacity: 0.6 }
      : {
          opacity: t.interpolate({ inputRange, outputRange: [0.35, 0.35, 1, 0.35, 0.35] }),
          transform: [{ translateY: t.interpolate({ inputRange, outputRange: [0, 0, -3, 0, 0] }) }],
        };
    return <Animated.View key={i} style={[styles.dot, { backgroundColor: theme.accent.calm }, style]} />;
  };

  return (
    <AnswerSurface>
      <View style={styles.thinking} accessibilityRole="progressbar" accessibilityLabel={status}>
        <View style={styles.dots}>{[0, 1, 2].map(dot)}</View>
        <Text style={[typography.meta, { color: theme.text.secondary }]}>{status}</Text>
      </View>
    </AnswerSurface>
  );
}

/** Inline citations: [1], [1][2], [1, 2]. Same pattern as src/ondevice/answer.ts. */
const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/** The answer text with its [n] citations drawn as small official-blue markers. */
export function CitedText({ text }: { text: string }) {
  const { theme } = useTheme();
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    for (const n of m[1]!.split(',').map((x) => x.trim())) {
      parts.push(
        <Text
          key={`${m.index}-${n}`}
          style={[typography.label, { color: theme.trust.official.text, backgroundColor: theme.trust.official.bg }]}
        >
          {` ${n} `}
        </Text>,
      );
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Text style={[typography.body, { color: theme.text.primary }]}>{parts}</Text>;
}

/** Numbered source rows; tappable when they have a link. */
export function SourceList({ sources }: { sources: MessageSource[] }) {
  const { theme } = useTheme();
  if (sources.length === 0) return null;
  return (
    <View style={[styles.sources, { borderTopColor: theme.line.hairline }]}>
      <Text style={[typography.label, { color: theme.text.secondary }]}>Sources</Text>
      {sources.map((s) => (
        <View key={s.n} style={styles.sourceRow}>
          <View style={[styles.sourceNum, { backgroundColor: theme.trust.official.bg }]}>
            <Text style={[typography.label, { color: theme.trust.official.text }]}>{s.n}</Text>
          </View>
          <Text
            style={[typography.meta, styles.flex, { color: s.url ? theme.trust.official.text : theme.text.secondary }]}
            onPress={s.url ? () => Linking.openURL(s.url!) : undefined}
            accessibilityRole={s.url ? 'link' : undefined}
            numberOfLines={2}
          >
            {s.title}
            <Text style={{ color: theme.text.faint }}>
              {' '}
              · {s.publisher}
              {s.note ? ` (${s.note})` : ''}
            </Text>
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Small print under an answer: which model, and "follow official instructions". */
export function Footnote({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return <Text style={[typography.meta, styles.footnote, { color: theme.text.faint }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  question: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    paddingVertical: spacing.scale[2],
    paddingHorizontal: spacing.scale[3],
    borderRadius: radius.card,
    borderBottomRightRadius: spacing.scale[0],
  },
  moby: { gap: spacing.scale[1], maxWidth: '100%' },
  byline: { flexDirection: 'row', alignItems: 'center', gap: spacing.scale[1] },
  avatar: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  answer: {
    padding: spacing.scale[3],
    paddingLeft: spacing.scale[3] + 1,
    borderRadius: radius.card,
    borderTopLeftRadius: spacing.scale[0],
    borderLeftWidth: 3,
    gap: spacing.scale[2],
  },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: spacing.scale[2] },
  dots: { flexDirection: 'row', gap: 5, paddingVertical: spacing.scale[1] },
  dot: { width: 7, height: 7, borderRadius: 4 },
  sources: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.scale[2], gap: spacing.scale[1] },
  sourceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.scale[2] },
  sourceNum: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  footnote: { marginTop: spacing.scale[0] },
});
