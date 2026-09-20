import { useState, useEffect, type CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import type { Subscription, Severity } from '@/api/types';
import { api } from '@/api/client';

interface SubscriptionsScreenProps {
  onBack: () => void;
}

function formatRadius(km: number): string {
  return `${km} km radius`;
}

function formatSeverity(s: Severity): string {
  return s.charAt(0).toUpperCase() + s.slice(1) + ' and above';
}

export function SubscriptionsScreen({ onBack }: SubscriptionsScreenProps) {
  const { theme } = useTheme();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const r = useResponsive();

  useEffect(() => {
    async function load() {
      try {
        const data = await api.getSubscriptions();
        setSubscriptions(data);
      } catch {
        setError('Could not load your subscriptions.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await api.deleteSubscription(id);
      setSubscriptions((prev) => prev.filter((s) => s.subscription_id !== id));
    } catch {
      setError('Could not remove subscription. Try again.');
    }
  };

  const styles: Record<string, CSSProperties> = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      padding: `${spacing.scale[2]}px ${r.gutter}px`,
      borderBottom: `1px solid ${theme.line.hairline}`,
      backgroundColor: theme.bg.raised,
      minHeight: spacing.minTapTarget + 8,
    },
    backBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: spacing.minTapTarget,
      minHeight: spacing.minTapTarget,
      background: 'none',
      border: 'none',
      color: theme.text.primary,
      cursor: 'pointer',
      padding: 0,
      marginRight: spacing.scale[2],
    },
    headerTitle: {
      ...r.heading,
      color: theme.text.primary,
      margin: 0,
      fontVariantNumeric: undefined,
    },
    scrollArea: {
      flex: 1,
      overflowY: 'auto',
      padding: r.gutter,
    },
    card: {
      backgroundColor: theme.bg.raised,
      borderRadius: radius.card,
      padding: r.cardPadding,
      marginBottom: spacing.scale[3],
    },
    label: {
      ...r.heading,
      color: theme.text.primary,
      margin: 0,
      fontVariantNumeric: undefined,
    },
    detail: {
      ...typography.meta,
      color: theme.text.secondary,
      marginTop: spacing.scale[1],
    },
    deleteBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: spacing.minTapTarget,
      marginTop: spacing.scale[2],
      background: 'none',
      border: `1px solid ${theme.line.hairline}`,
      borderRadius: radius.chip,
      color: theme.severity.critical,
      fontFamily: typography.body.fontFamily,
      fontSize: 14,
      fontWeight: 600,
      cursor: 'pointer',
      padding: `${spacing.scale[1]}px ${spacing.scale[3]}px`,
    },
    statusText: {
      ...typography.body,
      color: theme.text.secondary,
      textAlign: 'center',
      padding: `${r.sectionGap}px 0`,
      fontVariantNumeric: undefined,
    },
    emptyState: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
      textAlign: 'center',
      padding: r.sectionGap,
    },
    emptyTitle: {
      ...r.heading,
      color: theme.text.primary,
      margin: 0,
      fontVariantNumeric: undefined,
    },
    emptyBody: {
      ...typography.body,
      color: theme.text.secondary,
      margin: `${spacing.scale[2]}px 0 0 0`,
      maxWidth: '40ch',
      fontVariantNumeric: undefined,
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack} aria-label="Go back">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" stroke={theme.text.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h2 style={styles.headerTitle}>Subscriptions</h2>
      </div>

      <div style={styles.scrollArea}>
        {loading && <p style={styles.statusText}>Loading subscriptions</p>}
        {error && <p style={styles.statusText}>{error}</p>}

        {!loading && !error && subscriptions.length === 0 && (
          <div style={styles.emptyState}>
            <h3 style={styles.emptyTitle}>No subscriptions</h3>
            <p style={styles.emptyBody}>
              Subscribe to areas you care about to receive alerts when hazards are reported nearby.
            </p>
          </div>
        )}

        {subscriptions.map((sub) => (
          <div key={sub.subscription_id} style={styles.card}>
            <h3 style={styles.label}>{sub.label ?? 'Unnamed area'}</h3>
            <p style={styles.detail}>
              {formatRadius(sub.radius_km)} · {formatSeverity(sub.min_severity)}
            </p>
            <button
              style={styles.deleteBtn}
              onClick={() => handleDelete(sub.subscription_id)}
              aria-label={`Remove subscription for ${sub.label ?? 'this area'}`}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
