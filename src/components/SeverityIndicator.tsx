import type { CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import type { Severity } from '@/api/types';

interface SeverityIndicatorProps {
  severity: Severity;
  size?: 'default' | 'small';
}

function getSeverityLabel(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function SeverityIcon({ severity, color, size }: { severity: Severity; color: string; size: number }) {
  switch (severity) {
    case 'low':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" />
          <path d="M12 8v4M12 16h.01" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'medium':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3L2 21h20L12 3z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          <path d="M12 10v4M12 18h.01" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'high':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke={color} strokeWidth="2" />
          <path d="M12 8v4M12 16h.01" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'critical':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke={color} strokeWidth="2" strokeLinejoin="round" fill="none" />
          <circle cx="12" cy="12" r="4" fill={color} />
        </svg>
      );
  }
}

export function SeverityIndicator({ severity, size = 'default' }: SeverityIndicatorProps) {
  const { theme } = useTheme();
  const color = theme.severity[severity];
  const iconSize = size === 'small' ? 16 : 20;
  const label = getSeverityLabel(severity);

  const styles: Record<string, CSSProperties> = {
    container: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
    },
    icon: {
      flexShrink: 0,
    },
    label: {
      color,
      fontSize: size === 'small' ? 12 : 14,
      lineHeight: size === 'small' ? '16px' : '19px',
      fontWeight: 600,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    },
  };

  return (
    <span style={styles.container} aria-label={`Severity: ${label}`}>
      <span style={styles.icon}>
        <SeverityIcon severity={severity} color={color} size={iconSize} />
      </span>
      <span style={styles.label}>{label}</span>
    </span>
  );
}
