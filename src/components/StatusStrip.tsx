import type { CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';

interface StatusStripProps {
  areaCount: number;
  updatedMinutesAgo: number | null;
  isOffline: boolean;
  loading: boolean;
  locationAvailable: boolean;
}

function formatUpdatedTime(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes < 1) return 'updated just now';
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `updated ${hours}h ago`;
}

export function StatusStrip({
  areaCount,
  updatedMinutesAgo,
  isOffline,
  loading,
  locationAvailable,
}: StatusStripProps) {
  const { theme } = useTheme();
  const r = useResponsive();

  let text: string;
  if (!locationAvailable) {
    text = 'Location unavailable';
  } else if (loading) {
    text = 'Checking for alerts\u2026';
  } else if (isOffline) {
    const timeStr = formatUpdatedTime(updatedMinutesAgo);
    text = `Offline${timeStr ? ' \u00b7 ' + timeStr : ''}`;
  } else {
    const areaStr = areaCount === 1 ? '1 area' : `${areaCount} areas`;
    const timeStr = formatUpdatedTime(updatedMinutesAgo);
    text = `Watching ${areaStr}${timeStr ? ' \u00b7 ' + timeStr : ''}`;
  }

  const showCalmDot = locationAvailable && !isOffline && !loading;

  const styles: Record<string, CSSProperties> = {
    strip: {
      display: 'flex',
      alignItems: 'center',
      padding: `${spacing.scale[2]}px ${r.gutter}px`,
      minHeight: spacing.minTapTarget,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      backgroundColor: showCalmDot ? theme.accent.calm : theme.text.faint,
      marginRight: spacing.scale[2],
      flexShrink: 0,
    },
    text: {
      ...typography.meta,
      color: theme.text.secondary,
      fontVariantNumeric: undefined,
    },
  };

  return (
    <div style={styles.strip} role="status" aria-label={text}>
      <div style={styles.dot} aria-hidden="true" />
      <span style={styles.text}>{text}</span>
    </div>
  );
}
