import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { radius, spacing } from '@/theme/tokens';
import { useResponsive } from '@/hooks/useResponsive';
import { useNearbyAlerts } from '@/hooks/useNearbyAlerts';
import { useExplanation } from '@/hooks/useExplanation';
import { cardsForHazard, useGuidance } from '@/guidance/guidanceStore';
import { EmergencyNumbers } from '@/components/EmergencyNumbers';
import { countryAt } from '@/data/emergencyNumbers';
import { formatTimeAgo, trustText } from '@/lib/alerts';
import { qualifiesForEmergency } from '@/lib/emergencyMode';
import type { HazardType } from '@/api/types';

interface EmergencyScreenProps {
  alertId: string;
  onClose: () => void;
  onHelp: () => void;
  onAlertDetail: (alertId: string) => void;
  onGuidance: (hazard?: HazardType) => void;
}

/** Few, big steps: someone in a flood reads three lines, not a page. */
const MAX_STEPS = 3;

/**
 * Emergency mode: one official warning the person is inside, and what to do now.
 * Large type, no feed. Everything on it is saved on the phone, so it works with no
 * signal: the warning (saved alert list), the safety steps (offline guidance cards),
 * the emergency numbers (bundled). Moby's plain-language actions (Nemotron Super) are
 * shown only when they were already fetched, and say where they came from.
 */
export function EmergencyScreen({ alertId, onClose, onHelp, onAlertDetail, onGuidance }: EmergencyScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const { nearby, center } = useNearbyAlerts();
  const found = useMemo(() => nearby.find((c) => c.alert.alert_id === alertId), [nearby, alertId]);
  const alert = found?.alert;
  const stillApplies = !!found && qualifiesForEmergency(found);

  const explained = useExplanation(alert?.event_id, !!alert?.body);
  const { cards } = useGuidance();
  const steps = cardsForHazard(cards, alert?.hazard_type ?? 'other').slice(0, MAX_STEPS);
  const agencyActions = explained.explanation?.actions ?? [];
  // The warning's own actions lead when Moby has them; otherwise the first guidance card does.
  const firstSteps = agencyActions.length > 0 ? [] : steps.slice(0, 1);
  const moreSteps = agencyActions.length > 0 ? steps : steps.slice(1);

  if (!alert) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.bg.base, padding: r.gutter }]}>
        <Text variant="titleLarge" style={{ color: theme.text.primary }}>This warning has ended</Text>
        <Text variant="bodyLarge" style={[styles.gapTop, { color: theme.text.secondary }]}>
          It’s no longer in Moby’s list for where you are. Keep following local authorities.
        </Text>
        <Button mode="contained" onPress={onClose} style={styles.gapTop}>Back to Moby</Button>
      </View>
    );
  }

  const band = theme.severity[alert.severity];

  return (
    <View style={[styles.container, { backgroundColor: theme.bg.base }]}>
      <View style={[styles.band, { backgroundColor: band, paddingHorizontal: r.gutter }]}>
        <Text variant="labelLarge" style={styles.bandLabel} accessibilityRole="header">
          EMERGENCY MODE
        </Text>
        <Text variant="headlineSmall" style={styles.bandTitle}>{alert.headline}</Text>
        <Text variant="bodyLarge" style={styles.bandMeta}>
          {stillApplies ? 'You are in the warning area' : 'You may have left the warning area'}
          {' · '}
          {formatTimeAgo(alert.issued_at)}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: r.gutter, paddingBottom: spacing.scale[7] }}>
        <Text variant="bodyMedium" style={{ color: theme.trust.official.text }}>
          {trustText(alert)}
        </Text>

        <View style={styles.block}>
          <Text variant="titleLarge" accessibilityRole="header" style={{ color: theme.text.primary }}>
            Do this now
          </Text>
          {agencyActions.length > 0 ? (
            <>
              {agencyActions.map((action, i) => (
                <Step key={action} n={i + 1} text={action} />
              ))}
              <Text variant="bodySmall" style={{ color: theme.text.secondary }}>
                From the warning, in plain words by Moby’s AI (NVIDIA Nemotron). The agency’s own text is in the full alert.
              </Text>
            </>
          ) : (
            firstSteps.map((card, i) => (
              <Step key={card.card_id} n={i + 1} text={card.title} detail={card.body} source={card.source_name} />
            ))
          )}
        </View>

        {/* Right after the first steps: in a crisis nobody scrolls past three cards to find it. */}
        <Button
          mode="contained"
          icon="lifebuoy"
          onPress={onHelp}
          style={styles.bigButton}
          contentStyle={styles.bigButtonContent}
          labelStyle={styles.bigButtonLabel}
          buttonColor={theme.severity.critical}
          textColor="#FFFFFF"
          accessibilityHint="Shows your exact location and ways to send it"
        >
          I need help
        </Button>
        <EmergencyNumbers country={alert.country ?? countryAt(center.lat, center.lon)} />

        {moreSteps.length > 0 && (
          <View style={styles.block}>
            <Text variant="titleLarge" accessibilityRole="header" style={{ color: theme.text.primary }}>
              Stay safe
            </Text>
            {moreSteps.map((card, i) => (
              <Step
                key={card.card_id}
                n={(agencyActions.length || firstSteps.length) + i + 1}
                text={card.title}
                detail={card.body}
                source={card.source_name}
              />
            ))}
          </View>
        )}

        <View style={styles.links}>
          <Button mode="outlined" onPress={() => onAlertDetail(alert.alert_id)} textColor={theme.text.primary}>
            Full warning
          </Button>
          <Button mode="outlined" onPress={() => onGuidance(alert.hazard_type)} textColor={theme.text.primary}>
            More guidance
          </Button>
        </View>
        <Button mode="text" onPress={onClose} textColor={theme.text.secondary} style={styles.gapTop}>
          Close emergency mode
        </Button>
      </ScrollView>
    </View>
  );
}

function Step({ n, text, detail, source }: { n: number; text: string; detail?: string; source?: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.step, { backgroundColor: theme.bg.raised }]} accessibilityLabel={`Step ${n}. ${text}. ${detail ?? ''}`}>
      <Text variant="headlineSmall" style={[styles.stepNumber, { color: theme.text.secondary }]}>{n}</Text>
      <View style={styles.stepText}>
        <Text variant="titleLarge" style={{ color: theme.text.primary }}>{text}</Text>
        {detail ? <Text variant="bodyLarge" style={{ color: theme.text.primary }}>{detail}</Text> : null}
        {source ? <Text variant="bodySmall" style={{ color: theme.text.secondary }}>Source: {source}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { justifyContent: 'center' },
  band: { paddingVertical: spacing.scale[4], gap: spacing.scale[1] },
  bandLabel: { color: '#FFFFFF', letterSpacing: 1 },
  bandTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 26, lineHeight: 32 },
  bandMeta: { color: '#FFFFFF' },
  block: { marginTop: spacing.scale[4], gap: spacing.scale[2] },
  step: { flexDirection: 'row', gap: spacing.scale[3], padding: spacing.scale[3], borderRadius: radius.card },
  stepNumber: { width: 24, fontWeight: '700' },
  stepText: { flex: 1, gap: spacing.scale[1] },
  bigButton: { marginTop: spacing.scale[5], borderRadius: radius.card },
  bigButtonContent: { minHeight: 64 },
  bigButtonLabel: { fontSize: 20, fontWeight: '700' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.scale[2], marginTop: spacing.scale[3] },
  gapTop: { marginTop: spacing.scale[3] },
});
