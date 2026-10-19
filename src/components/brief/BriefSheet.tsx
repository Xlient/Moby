import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, IconButton, Text } from 'react-native-paper';
import type { SituationalBrief } from '@/api/types';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useResponsive } from '@/hooks/useResponsive';
import { formatTimeAgo } from '@/lib/alerts';
import { useTheme } from '@/theme/ThemeContext';
import { radius, spacing, typography } from '@/theme/tokens';
import { BriefTimeline } from './BriefTimeline';

// The full situation brief. Colour says who says so: blue = an official agency, violet =
// people nearby (unverified), the calm teal = Moby's own voice. Saturated colour appears
// nowhere else (tokens.ts), so it never reads as a severity.

type Claim = NonNullable<SituationalBrief['claims']>[number];
type Citation = NonNullable<SituationalBrief['citations']>[number];

const BASIS_LABEL = { official: 'Official', community: 'Unverified · people nearby', news: 'Web' } as const;

export function modelName(model: string): string {
  return /ultra/i.test(model) ? 'NVIDIA Nemotron Ultra' : /super/i.test(model) ? 'NVIDIA Nemotron Super' : 'NVIDIA Nemotron';
}

export function BriefSheet({ brief, visible, onClose }: { brief: SituationalBrief; visible: boolean; onClose: () => void }) {
  const { theme } = useTheme();
  const r = useResponsive();
  const citations = brief.citations ?? [];
  const official = citations.some((c) => c.kind === 'official');
  const reports = (brief.timeline ?? []).reduce((n, e) => n + (e.times?.length ?? 0), 0);
  const newSince = (brief.timeline ?? []).filter((e) => e.after_brief).length;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close the brief" />
      <View style={[styles.sheet, { backgroundColor: theme.bg.base }]}>
        <View style={[styles.handle, { backgroundColor: theme.line.hairline }]} />
        <View style={[styles.header, { paddingHorizontal: r.gutter }]}>
          <View style={styles.flex}>
            <Text accessibilityRole="header" style={[typography.heading, { color: theme.text.primary }]}>
              Situation brief
            </Text>
            <Byline brief={brief} />
          </View>
          <IconButton icon="close" onPress={onClose} accessibilityLabel="Close" iconColor={theme.text.secondary} />
        </View>

        <ScrollView contentContainerStyle={{ padding: r.gutter, paddingTop: spacing.scale[1], gap: spacing.scale[4] }}>
          {visible && (
            <>
              {brief.changes && (
                <Rise i={0}>
                  <Callout icon="update" title={`What changed${brief.changes_since ? ` since ${formatTimeAgo(brief.changes_since)}` : ''}`} tone="calm">
                    {brief.changes}
                  </Callout>
                </Rise>
              )}

              <Rise i={1}>
                <Text style={[typography.body, styles.summary, { color: theme.text.primary }]}>{brief.summary}</Text>
                <View style={styles.chips}>
                  <Chip tone={official ? 'official' : 'neutral'} icon={official ? 'check-decagram' : 'minus-circle-outline'}>
                    {official ? 'Official warning' : 'No official warning'}
                  </Chip>
                  {reports > 0 && (
                    <Chip tone="community" icon="account-group-outline">{`${reports} ${reports === 1 ? 'report' : 'reports'} from people nearby`}</Chip>
                  )}
                  {newSince > 0 && <Chip tone="calm" icon="bell-ring-outline">{`${newSince} new since this brief`}</Chip>}
                </View>
              </Rise>

              {(brief.timeline?.length ?? 0) > 0 && (
                <Rise i={2}>
                  <Section title="Timeline">
                    <BriefTimeline entries={brief.timeline ?? []} />
                  </Section>
                </Rise>
              )}

              {(brief.claims?.length ?? 0) > 0 && (
                <Rise i={3}>
                  <Section title="What's reported">
                    {(brief.claims ?? []).map((c, i) => <ClaimRow key={i} claim={c} citations={citations} />)}
                  </Section>
                </Rise>
              )}

              {(brief.contradictions?.length ?? 0) > 0 && (
                <Rise i={4}>
                  <Callout icon="call-split" title="Where reports disagree">
                    {(brief.contradictions ?? []).join('\n')}
                  </Callout>
                </Rise>
              )}

              {brief.official_guidance && (
                <Rise i={5}>
                  <Callout icon="bullhorn-outline" title="What the agency says to do" tone="official">
                    {brief.official_guidance}
                  </Callout>
                </Rise>
              )}

              {brief.likely_progression && (
                <Rise i={6}>
                  <Section title="What may happen next (an estimate)">
                    <Text style={[typography.body, { color: theme.text.primary }]}>{brief.likely_progression}</Text>
                  </Section>
                </Rise>
              )}

              <Rise i={7}>
                <Callout icon="help-circle-outline" title="What we don't know">{brief.uncertainty}</Callout>
              </Rise>

              {citations.length > 0 && (
                <Rise i={8}>
                  <Section title="Sources">
                    {citations.map((c) => <SourceRow key={c.id} citation={c} />)}
                  </Section>
                </Rise>
              )}

              <Text style={[typography.meta, styles.footnote, { color: theme.text.faint }]}>
                An AI summary of the sources above, written only from them. Follow official instructions if they differ.
              </Text>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function Byline({ brief }: { brief: SituationalBrief }) {
  const { theme } = useTheme();
  return (
    <View style={styles.byline}>
      <View style={[styles.avatar, { backgroundColor: theme.accent.calm }]}>
        <Icon source="lifebuoy" size={12} color={theme.bg.raised} />
      </View>
      <Text style={[typography.meta, styles.flex, { color: theme.text.secondary }]} numberOfLines={1}>
        Moby · {modelName(brief.model)} · {formatTimeAgo(brief.generated_at)}
      </Text>
    </View>
  );
}

/** Sections rise in one after another as the sheet opens (snaps with reduced motion). */
function Rise({ i, children }: { i: number; children: ReactNode }) {
  const reduce = useReducedMotion();
  const [p] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) return p.setValue(1);
    Animated.timing(p, { toValue: 1, duration: 360, delay: 120 + i * 60, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [p, i, reduce]);
  return (
    <Animated.View style={{ opacity: p, transform: [{ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[typography.label, styles.sectionTitle, { color: theme.text.secondary }]}>
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

type Tone = 'official' | 'community' | 'calm' | 'neutral';

function useTone(tone: Tone) {
  const { theme } = useTheme();
  switch (tone) {
    case 'official':
      return { fg: theme.trust.official.text, bg: theme.trust.official.bg, border: theme.trust.official.border };
    case 'community':
      return { fg: theme.trust.unverified.text, bg: theme.trust.unverified.bg, border: theme.trust.unverified.border };
    case 'calm':
      return { fg: theme.accent.calm, bg: theme.bg.raised, border: theme.accent.calm };
    default:
      return { fg: theme.text.secondary, bg: theme.bg.recessed, border: theme.line.hairline };
  }
}

function Chip({ tone, icon, children }: { tone: Tone; icon: string; children: string }) {
  const c = useTone(tone);
  return (
    <View
      style={[styles.chip, { backgroundColor: c.bg, borderColor: c.border, borderStyle: tone === 'community' ? 'dashed' : 'solid' }]}
    >
      <Icon source={icon} size={14} color={c.fg} />
      <Text style={[typography.label, { color: c.fg }]}>{children}</Text>
    </View>
  );
}

function Callout({ icon, title, tone = 'neutral', children }: { icon: string; title: string; tone?: Tone; children: string }) {
  const { theme } = useTheme();
  const c = useTone(tone);
  return (
    <View style={[styles.callout, { backgroundColor: tone === 'neutral' ? theme.bg.recessed : theme.bg.raised, borderLeftColor: c.border }]}>
      <View style={styles.calloutTitle}>
        <Icon source={icon} size={18} color={tone === 'neutral' ? theme.text.secondary : c.fg} />
        <Text style={[typography.label, { color: tone === 'neutral' ? theme.text.secondary : c.fg }]}>{title}</Text>
      </View>
      <Text style={[typography.body, { color: theme.text.primary }]}>{children}</Text>
    </View>
  );
}

function ClaimRow({ claim, citations }: { claim: Claim; citations: Citation[] }) {
  const { theme } = useTheme();
  const c = useTone(claim.basis === 'official' ? 'official' : claim.basis === 'community' ? 'community' : 'neutral');
  return (
    <View style={[styles.claim, { backgroundColor: theme.bg.raised, borderLeftColor: c.border }]}>
      <Text style={[typography.body, { color: theme.text.primary }]}>{claim.text}</Text>
      <View style={styles.claimMeta}>
        <Text style={[typography.label, { color: c.fg }]}>{BASIS_LABEL[claim.basis]}</Text>
        {claim.evidence.map((id) => {
          const cited = citations.find((x) => x.id === id);
          return (
            <View key={id} style={[styles.ref, { backgroundColor: c.bg }]} accessibilityLabel={cited ? `Source: ${cited.title}` : id}>
              <Text style={[typography.label, { color: c.fg }]}>{id}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function SourceRow({ citation }: { citation: Citation }) {
  const { theme } = useTheme();
  const c = useTone(citation.kind === 'official' ? 'official' : citation.kind === 'community' ? 'community' : 'neutral');
  return (
    <View style={styles.source}>
      <View style={[styles.ref, { backgroundColor: c.bg }]}>
        <Text style={[typography.label, { color: c.fg }]}>{citation.id}</Text>
      </View>
      <Text style={[typography.meta, styles.flex, { color: theme.text.primary }]}>{citation.title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: '8%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%',
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: spacing.scale[2] },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: spacing.scale[2] },
  byline: { flexDirection: 'row', alignItems: 'center', gap: spacing.scale[1], marginTop: 2 },
  avatar: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  summary: { fontSize: 18, lineHeight: 27 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.scale[2], marginTop: spacing.scale[3] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.scale[2],
    paddingVertical: 3,
  },
  section: { gap: spacing.scale[2] },
  sectionTitle: { letterSpacing: 0.6 },
  callout: { borderRadius: radius.card, borderLeftWidth: 3, padding: spacing.scale[3], gap: spacing.scale[1] },
  calloutTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.scale[1] },
  claim: { borderRadius: radius.chip, borderLeftWidth: 3, padding: spacing.scale[3], gap: spacing.scale[1] },
  claimMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.scale[1] },
  ref: { borderRadius: radius.chip, paddingHorizontal: 6, paddingVertical: 1 },
  source: { flexDirection: 'row', alignItems: 'center', gap: spacing.scale[2] },
  footnote: { textAlign: 'center', marginBottom: spacing.scale[5] },
});
