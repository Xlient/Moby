import type { CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

export function MapScreen() {
  const { theme } = useTheme();
  const isOnline = useOnlineStatus();
  const r = useResponsive();

  const styles: Record<string, CSSProperties> = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      backgroundColor: theme.bg.recessed,
      padding: r.gutter,
      textAlign: 'center',
    },
    icon: {
      marginBottom: spacing.scale[4],
    },
    title: {
      ...r.heading,
      color: theme.text.primary,
      margin: 0,
      fontVariantNumeric: undefined,
    },
    subtitle: {
      ...typography.body,
      color: theme.text.secondary,
      margin: `${spacing.scale[2]}px 0 0 0`,
      maxWidth: '40ch',
      fontVariantNumeric: undefined,
    },
  };

  return (
    <div style={styles.container} role="region" aria-label="Map view">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" style={styles.icon} aria-hidden="true">
        <path
          d="M4 12v40l18.67-10.67L41.33 52 60 41.33V1.33L41.33 12 22.67 1.33 4 12z"
          stroke={theme.text.faint}
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path d="M22.67 1.33V41.33M41.33 12V52" stroke={theme.text.faint} strokeWidth="3" />
      </svg>
      <h2 style={styles.title}>Map</h2>
      <p style={styles.subtitle}>
        {isOnline
          ? 'Interactive map with alert locations and subscription areas is coming soon.'
          : 'Map tiles are unavailable offline. Cached tiles will appear here when available.'}
      </p>
    </div>
  );
}
