import { Text } from 'react-native-paper';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import type { Severity } from '@/api/types';

interface SeverityIndicatorProps {
  severity: Severity;
  size?: 'default' | 'small';
  neutral?: boolean;
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
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2L22 12L12 22L2 12L12 2z" stroke={color} strokeWidth="2" strokeLinejoin="round" fill={color} fillOpacity="0.15" />
          <path d="M12 8v4M12 16h.01" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
  }
}

export function SeverityIndicator({ severity, size = 'default', neutral = false }: SeverityIndicatorProps) {
  const { theme } = useTheme();
  const color = neutral ? theme.text.secondary : theme.severity[severity];
  const iconSize = size === 'small' ? 16 : 20;
  const label = getSeverityLabel(severity);

  return (
    <View style={styles.container} accessibilityLabel={`Severity: ${label}`}>
      <SeverityIcon severity={severity} color={color} size={iconSize} />
      <Text
        variant={size === 'small' ? 'labelSmall' : 'bodyMedium'}
        style={{ color, fontWeight: '600' }}
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
