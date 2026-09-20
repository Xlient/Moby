import type { CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';

export function AssistantScreen() {
  const { theme } = useTheme();
  const r = useResponsive();

  const styles: Record<string, CSSProperties> = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      justifyContent: 'center',
      height: '100%',
      padding: r.gutter,
    },
    heading: {
      ...r.heading,
      color: theme.text.primary,
      margin: 0,
      fontVariantNumeric: undefined,
    },
    body: {
      ...typography.body,
      color: theme.text.secondary,
      margin: `${spacing.scale[2]}px 0 0 0`,
      maxWidth: '40ch',
      fontVariantNumeric: undefined,
    },
  };

  return (
    <div style={styles.container} role="region" aria-label="Assistant">
      <h2 style={styles.heading}>Assistant</h2>
      <p style={styles.body}>
        Ask a question about an active alert or safety guidance. This feature is coming soon.
      </p>
    </div>
  );
}
