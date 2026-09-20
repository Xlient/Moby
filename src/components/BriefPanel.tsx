import type { CSSProperties } from 'react';
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

  const styles: Record<string, CSSProperties> = {
    container: {
      backgroundColor: theme.bg.raised,
      borderRadius: radius.card,
      padding: r.cardPadding,
      marginTop: spacing.scale[3],
    },
    heading: {
      ...r.heading,
      color: theme.text.primary,
      margin: 0,
      fontVariantNumeric: undefined,
    },
    body: {
      ...typography.body,
      color: theme.text.primary,
      margin: `${spacing.scale[2]}px 0 0 0`,
      lineHeight: '25px',
      maxWidth: '70ch',
      fontVariantNumeric: undefined,
    },
    sectionTitle: {
      ...typography.meta,
      color: theme.text.secondary,
      fontWeight: 600,
      margin: `${spacing.scale[4]}px 0 ${spacing.scale[1]}px 0`,
    },
    uncertainty: {
      backgroundColor: theme.bg.recessed,
      borderRadius: radius.chip,
      padding: spacing.scale[3],
      marginTop: spacing.scale[4],
    },
    uncertaintyLabel: {
      ...typography.meta,
      color: theme.text.secondary,
      fontWeight: 600,
      margin: 0,
    },
    uncertaintyText: {
      ...typography.body,
      color: theme.text.primary,
      margin: `${spacing.scale[1]}px 0 0 0`,
      fontVariantNumeric: undefined,
    },
    pendingText: {
      ...typography.meta,
      color: theme.text.secondary,
      margin: `${spacing.scale[2]}px 0 0 0`,
    },
    failedText: {
      ...typography.meta,
      color: theme.text.faint,
      margin: `${spacing.scale[2]}px 0 0 0`,
    },
    sourcesList: {
      listStyle: 'none',
      padding: 0,
      margin: `${spacing.scale[1]}px 0 0 0`,
    },
    sourceItem: {
      ...typography.meta,
      color: theme.text.secondary,
    },
  };

  if (state.status === 'idle') return null;

  if (state.status === 'pending') {
    return (
      <div style={styles.container} role="status" aria-label="Generating situational brief">
        <h3 style={styles.heading}>Situational brief</h3>
        <p style={styles.pendingText}>
          Generating analysis
          {state.retryAfterSeconds > 0 && ` — expected in about ${state.retryAfterSeconds} seconds`}
        </p>
      </div>
    );
  }

  if (state.status === 'failed') {
    return (
      <div style={styles.container} role="status">
        <h3 style={styles.heading}>Situational brief</h3>
        <p style={styles.failedText}>{state.error}</p>
      </div>
    );
  }

  const { brief } = state;

  return (
    <div style={styles.container} role="region" aria-label="Situational brief">
      <h3 style={styles.heading}>Situational brief</h3>

      <p style={styles.body}>{brief.summary}</p>

      {brief.likely_progression && (
        <>
          <p style={styles.sectionTitle}>Likely progression</p>
          <p style={styles.body}>{brief.likely_progression}</p>
        </>
      )}

      {brief.official_guidance && (
        <>
          <p style={styles.sectionTitle}>Official guidance</p>
          <p style={styles.body}>{brief.official_guidance}</p>
        </>
      )}

      {brief.exposed_areas && brief.exposed_areas.length > 0 && (
        <>
          <p style={styles.sectionTitle}>Areas that may be affected</p>
          {brief.exposed_areas.map((area, i) => (
            <p key={i} style={styles.body}>
              {area.description}{area.rationale ? ` — ${area.rationale}` : ''}
            </p>
          ))}
        </>
      )}

      <div style={styles.uncertainty}>
        <p style={styles.uncertaintyLabel}>What this analysis does not know</p>
        <p style={styles.uncertaintyText}>{brief.uncertainty}</p>
      </div>

      {brief.sources && brief.sources.length > 0 && (
        <>
          <p style={styles.sectionTitle}>Sources</p>
          <ul style={styles.sourcesList}>
            {brief.sources.map((src, i) => (
              <li key={i} style={styles.sourceItem}>{src}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
