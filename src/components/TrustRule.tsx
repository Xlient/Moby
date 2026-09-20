import type { CSSProperties } from 'react';
import type { VerificationLabel, Severity } from '@/api/types';
import { useTheme } from '@/theme/ThemeContext';
import { radius } from '@/theme/tokens';

interface TrustRuleProps {
  verification: VerificationLabel;
  severity: Severity;
}

export function TrustRule({ verification, severity }: TrustRuleProps) {
  const { theme } = useTheme();

  if (verification === 'unverified_report') {
    return null;
  }

  const severityColor = theme.severity[severity];

  const style: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderRadius: `${radius.card}px 0 0 ${radius.card}px`,
    backgroundColor: severityColor,
    opacity: verification === 'corroborated_report' ? 0.5 : 1,
  };

  return <div style={style} aria-hidden="true" />;
}
