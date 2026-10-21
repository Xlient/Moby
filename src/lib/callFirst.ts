import type { EmergencyNumbers } from '@/data/emergencyNumbers';

/**
 * The Report screen's "call first" line, for the country the phone is in. Unknown
 * country: no number at all, never a guess (911 is US-only).
 */
export function callFirstLine(n: EmergencyNumbers | undefined): string {
  if (!n) return 'In immediate danger? Call your local emergency number first.';
  if (n.general) return `In immediate danger? Call ${n.general} first.`;
  const parts: string[] = [];
  if (n.ambulance && n.ambulance === n.fire) parts.push(`ambulance and fire ${n.ambulance}`);
  else {
    if (n.ambulance) parts.push(`ambulance ${n.ambulance}`);
    if (n.fire) parts.push(`fire ${n.fire}`);
  }
  if (n.police) parts.push(`police ${n.police}`);
  if (!parts.length) return 'In immediate danger? Call your local emergency number first.';
  return `In immediate danger? Call first: ${parts.join(', ')}.`;
}
