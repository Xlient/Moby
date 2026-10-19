import { useCallback, useMemo, useState } from 'react';
import { kv } from '@/lib/storage';
import { emergencyAlert, type Candidate } from '@/lib/emergencyMode';
import { useNearbyAlerts } from './useNearbyAlerts';

const OPENED_KEY = 'emergency-opened-v1';
/** Enough to remember every warning of a long storm season; oldest drop first. */
const MAX_REMEMBERED = 50;

function readOpened(): string[] {
  try {
    const raw = kv.get(OPENED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export interface UseEmergencyAlertResult {
  /** The warning emergency mode is about, or null. Works offline (saved alerts). */
  emergency: Candidate | null;
  /** True once per warning: App opens emergency mode by itself, then only the banner stays. */
  shouldOpen: boolean;
  markOpened: (alertId: string) => void;
}

/**
 * The official warning the person is inside right now, if any (rule in lib/emergencyMode).
 * Emergency mode opens by itself once per warning; after that, Home keeps a banner to reopen it.
 */
export function useEmergencyAlert(): UseEmergencyAlertResult {
  const { nearby } = useNearbyAlerts();
  const [opened, setOpened] = useState<string[]>(readOpened);

  const emergency = useMemo(() => emergencyAlert(nearby), [nearby]);

  const markOpened = useCallback((alertId: string) => {
    setOpened((prev) => {
      if (prev.includes(alertId)) return prev;
      const next = [...prev, alertId].slice(-MAX_REMEMBERED);
      try {
        kv.set(OPENED_KEY, JSON.stringify(next));
      } catch {
        /* storage full: it may open once more, which is the safe side */
      }
      return next;
    });
  }, []);

  return {
    emergency,
    shouldOpen: !!emergency && !opened.includes(emergency.alert.alert_id),
    markOpened,
  };
}
