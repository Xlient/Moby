import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing, typography } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { AlertCard } from '@/components/AlertCard';
import { BriefPanel } from '@/components/BriefPanel';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ContributingReports } from '@/components/ContributingReports';
import { useBrief } from '@/hooks/useBrief';
import { useEventReports } from '@/hooks/useEventReports';
import { useAlerts } from '@/hooks/useAlerts';
import { GuidanceCard } from '@/components/GuidanceCard';
import { cardsForHazard, useGuidance } from '@/guidance/guidanceStore';
import type { HazardType } from '@/api/types';
import { alertDistanceKm } from '@/lib/geo';
import { fetchCenter, useUserCenter } from '@/location/UserLocationContext';

interface AlertDetailScreenProps {
  alertId: string;
  onBack: () => void;
  onGuidance: (hazard?: HazardType) => void;
}

/** Most urgent first; the alert detail shows only the top few. */
const WHAT_TO_DO_CARDS = 2;

export function AlertDetailScreen({ alertId, onBack, onGuidance }: AlertDetailScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const { isEnabled } = useFeatureFlags();
  const { alerts } = useAlerts();
  const center = useUserCenter();

  const listed = useMemo(
    () => alerts.find((a) => a.alert_id === alertId),
    [alerts, alertId],
  );
  // Opened from a notification, the alert may not be in the nearby list (a saved area
  // elsewhere, or not fetched yet): load it on its own.
  const single = useQuery({
    queryKey: ['alert', alertId],
    queryFn: () => api.getAlert(alertId),
    enabled: !listed,
    staleTime: 60_000,
  });
  const alert = listed ?? single.data;

  const { state: briefState } = useBrief(alert?.event_id);
  // Official alerts come from agencies, not people nearby; only community alerts have reports.
  const fromCommunity = !!alert && alert.verification_label !== 'official_confirmed';
  const reports = useEventReports(alert?.event_id, fromCommunity);
  const { cards } = useGuidance();
  const whatToDo = cardsForHazard(cards, alert?.hazard_type ?? 'other').slice(0, WHAT_TO_DO_CARDS);

  const raw = alert ? alertDistanceKm(alert, center, fetchCenter(center)) : undefined;
  const distance = raw === undefined ? undefined : Math.round(raw * 10) / 10;

  return (
    <View style={styles.container}>
      <ScreenHeader title={alert ? alert.headline : 'Alert details'} onBack={onBack} />

      {!alert ? (
        <View style={styles.notFound}>
          <Text style={[typography.body, { color: theme.text.secondary }]}>
            {single.isLoading ? 'Loading alert…' : 'This alert is no longer available.'}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.container} contentContainerStyle={{ padding: r.gutter }}>
          <AlertCard alert={alert} distanceKm={distance} />
          {alert.body ? (
            // The agency's message: what's happening and what to do.
            <Text variant="bodyLarge" style={[styles.body, { color: theme.text.primary }]}>
              {alert.body}
            </Text>
          ) : null}
          {alert.translated && (
            <TranslationNote
              language={alert.original_language ?? 'the original language'}
              headline={alert.original_headline}
              body={alert.original_body}
            />
          )}
          {whatToDo.length > 0 && (
            // Saved on the phone: works even if this alert arrived just before the signal went.
            <View style={styles.whatToDo}>
              <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.text.primary }}>
                What to do
              </Text>
              {whatToDo.map((card) => (
                <GuidanceCard key={card.card_id} card={card} compact />
              ))}
              <Button
                mode="text"
                onPress={() => onGuidance(alert.hazard_type)}
                style={styles.alignStart}
                textColor={theme.text.primary}
              >
                More safety guidance
              </Button>
            </View>
          )}
          {fromCommunity && (
            <ContributingReports
              data={reports.data}
              loading={reports.loading}
              error={reports.error}
              onRetry={reports.refetch}
            />
          )}
          {isEnabled('situational_brief') && <BriefPanel state={briefState} />}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Issue #11: Moby's translation is always labelled, and the agency's own words are
 * one tap away — a translation must never pass as the agency's instruction.
 */
function TranslationNote({ language, headline, body }: { language: string; headline?: string; body?: string }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.translation, { backgroundColor: theme.bg.recessed }]}>
      <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
        Translated by Moby from {language}. The official wording is the original.
      </Text>
      <Button mode="text" onPress={() => setOpen((o) => !o)} style={styles.alignStart} textColor={theme.text.primary}>
        {open ? 'Hide original' : 'Show original'}
      </Button>
      {open && (
        <View style={styles.original}>
          {headline ? <Text variant="titleSmall" style={{ color: theme.text.primary }}>{headline}</Text> : null}
          {body ? <Text variant="bodyMedium" style={{ color: theme.text.primary }}>{body}</Text> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    marginTop: spacing.scale[3],
  },
  translation: {
    marginTop: spacing.scale[3],
    padding: spacing.scale[3],
    borderRadius: 12,
  },
  original: {
    gap: spacing.scale[1],
    paddingTop: spacing.scale[1],
  },
  container: {
    flex: 1,
  },
  whatToDo: {
    marginTop: spacing.scale[4],
    gap: spacing.scale[3],
  },
  alignStart: {
    alignSelf: 'flex-start',
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
