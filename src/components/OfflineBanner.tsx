import { useTheme } from '@/theme/ThemeContext';
import { spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useOnlineStatus, useOfflineBannerDismiss } from '@/hooks/useOnlineStatus';
import type { CSSProperties } from 'react';

export function OfflineBanner() {
  const { theme } = useTheme();
  const isOnline = useOnlineStatus();
  const { isDismissed, dismiss } = useOfflineBannerDismiss();
  const r = useResponsive();

  if (isOnline || isDismissed) return null;

  const styles: Record<string, CSSProperties> = {
    banner: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.text.secondary,
      padding: `${spacing.scale[1]}px ${r.gutter}px`,
      borderRadius: 0,
      minHeight: spacing.minTapTarget,
    },
    text: {
      color: theme.bg.raised,
      fontSize: 14,
      lineHeight: '19px',
      fontWeight: 600,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    },
    dismissBtn: {
      background: 'none',
      border: 'none',
      color: theme.bg.raised,
      fontSize: 20,
      lineHeight: '20px',
      cursor: 'pointer',
      padding: spacing.scale[2],
      minWidth: spacing.minTapTarget,
      minHeight: spacing.minTapTarget,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  };

  return (
    <div style={styles.banner} role="status" aria-live="polite">
      <span style={styles.text}>Offline — showing saved information</span>
      <button
        style={styles.dismissBtn}
        onClick={dismiss}
        aria-label="Dismiss offline notice"
      >
        ×
      </button>
    </div>
  );
}
