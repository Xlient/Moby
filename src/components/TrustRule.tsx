import type { CSSProperties } from 'react';
import type { VerificationLabel, Severity } from '@/api/types';
import { useTheme } from '@/theme/ThemeContext';

interface TrustRuleProps {
  verification: VerificationLabel;
  severity: Severity;
}

export function TrustRule({ verification, severity }: TrustRuleProps) {
  const { theme } = useTheme();
  const severityColor = theme.severity[severity];

  const baseStyle: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  };

  if (verification === 'official_confirmed') {
    return (
      <div
        style={{
          ...baseStyle,
          backgroundColor: severityColor,
          borderRadius: '8px 0 0 8px',
        }}
        aria-hidden="true"
      />
    );
  }

  if (verification === 'corroborated_report') {
    return (
      <div
        style={{
          ...baseStyle,
          borderRadius: '8px 0 0 8px',
          overflow: 'hidden',
        }}
        aria-hidden="true"
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            background: `repeating-linear-gradient(
              -45deg,
              transparent,
              transparent 2px,
              ${severityColor} 2px,
              ${severityColor} 4px
            )`,
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        ...baseStyle,
        borderRadius: '8px 0 0 8px',
        overflow: 'hidden',
      }}
      aria-hidden="true"
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundImage: `repeating-linear-gradient(
            to bottom,
            ${theme.text.secondary} 0px,
            ${theme.text.secondary} 3px,
            transparent 3px,
            transparent 6px
          )`,
          backgroundSize: '4px 6px',
        }}
      />
    </div>
  );
}
