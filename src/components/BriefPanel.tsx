import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import type { SituationalBrief } from '@/api/types';

interface BriefPanelProps {
  state:
    | { status: 'idle' }
    | { status: 'pending'; retryAfterSeconds: number }
    | { status: 'ready'; brief: SituationalBrief }
    | { status: 'failed'; error: string };
}

export function BriefPanel({ state }: BriefPanelProps) {
  const { theme } = useTheme();
  const r = useResponsive();

  const s = {
    container: [
      styles.container,
      { backgroundColor: theme.bg.raised, padding: r.cardPadding },
    ],
    heading: [r.heading, { color: theme.text.primary }],
    body: [typography.body, styles.body, { color: theme.text.primary }],
    sectionTitle: [typography.meta, styles.sectionTitle, { color: theme.text.secondary }],
    meta: [typography.meta, styles.status],
  };

  if (state.status === 'idle') return null;

  if (state.status === 'pending') {
    return (
      <View style={s.container} accessibilityLabel="Generating situational brief">
        <Text accessibilityRole="header" style={s.heading}>Situational brief</Text>
        <Text style={[s.meta, { color: theme.text.secondary }]}>
          Generating analysis
          {state.retryAfterSeconds > 0 &&
            ` — expected in about ${state.retryAfterSeconds} seconds`}
        </Text>
      </View>
    );
  }

  if (state.status === 'failed') {
    return (
      <View style={s.container}>
        <Text accessibilityRole="header" style={s.heading}>Situational brief</Text>
        <Text style={[s.meta, { color: theme.text.faint }]}>{state.error}</Text>
      </View>
    );
  }

  const { brief } = state;

  return (
    <View style={s.container} accessibilityLabel="Situational brief">
      <Text accessibilityRole="header" style={s.heading}>Situational brief</Text>

      <Text style={s.body}>{brief.summary}</Text>

      {brief.likely_progression && (
        <>
          <Text style={s.sectionTitle}>Likely progression</Text>
          <Text style={s.body}>{brief.likely_progression}</Text>
        </>
      )}

      {brief.official_guidance && (
        <>
          <Text style={s.sectionTitle}>Official guidance</Text>
          <Text style={s.body}>{brief.official_guidance}</Text>
        </>
      )}

      {brief.exposed_areas && brief.exposed_areas.length > 0 && (
        <>
          <Text style={s.sectionTitle}>Areas that may be affected</Text>
          {brief.exposed_areas.map((area, i) => (
            <Text key={i} style={s.body}>
              {area.description}
              {area.rationale ? ` — ${area.rationale}` : ''}
            </Text>
          ))}
        </>
      )}

      <View style={[styles.uncertainty, { backgroundColor: theme.bg.recessed }]}>
        <Text style={[typography.meta, styles.strong, { color: theme.text.secondary }]}>
          What this analysis does not know
        </Text>
        <Text style={[typography.body, styles.uncertaintyText, { color: theme.text.primary }]}>
          {brief.uncertainty}
        </Text>
      </View>

      {brief.sources && brief.sources.length > 0 && (
        <>
          <Text style={s.sectionTitle}>Sources</Text>
          <View style={styles.sourcesList}>
            {brief.sources.map((src, i) => (
              <Text key={i} style={[typography.meta, { color: theme.text.secondary }]}>
                {src}
              </Text>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.card,
    marginTop: spacing.scale[3],
  },
  body: {
    marginTop: spacing.scale[2],
  },
  sectionTitle: {
    fontWeight: '600',
    marginTop: spacing.scale[4],
    marginBottom: spacing.scale[1],
  },
  status: {
    marginTop: spacing.scale[2],
  },
  strong: {
    fontWeight: '600',
  },
  uncertainty: {
    borderRadius: radius.chip,
    padding: spacing.scale[3],
    marginTop: spacing.scale[4],
  },
  uncertaintyText: {
    marginTop: spacing.scale[1],
  },
  sourcesList: {
    marginTop: spacing.scale[1],
  },
});
