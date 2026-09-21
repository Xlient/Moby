import { Text } from 'react-native-paper';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { typography } from '@/theme/tokens';
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
      // Circle — information
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" />
          <path d="M12 8v4M12 16h.01" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'medium':
      // Triangle — warning
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3L2 21h20L12 3z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          <path d="M12 10v4M12 18h.01" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'high':
      // Square — alert
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke={color} strokeWidth="2" />
          <path d="M12 8v4M12 16h.01" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'critical':
      // Diamond — danger
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2L22 12L12 22L2 12L12 2z" stroke={color} strokeWidth="2" strokeLinejoin="round" fill={color} fillOpacity="0.15" />
          <path d="M12 8v4M12 16h.01" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
  }
}

export function SeverityIndicator({ severity, size = 'default' }: SeverityIndicatorProps) {
  const { theme } = useTheme();
  const color = theme.severity[severity];
  const iconSize = size === 'small' ? 16 : 20;
  const label = getSeverityLabel(severity);
  const fontSize = size === 'small' ? typography.label.fontSize : typography.meta.fontSize;
  const lineHeight = size === 'small' ? typography.label.lineHeight : typography.meta.lineHeight;

  return (
    <View style={styles.container} accessibilityLabel={`Severity: ${label}`}>
      <SeverityIcon severity={severity} color={color} size={iconSize} />
      <Text
        style={{
          color,
          fontSize,
          lineHeight,
          fontWeight: '600',
          fontVariant: ['tabular-nums'],
        }}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
