import { useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';
import { GuidanceCard } from '@/components/GuidanceCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResponsive } from '@/hooks/useResponsive';
import { cardsForHazard, useGuidance } from '@/guidance/guidanceStore';
import { formatTimeAgo } from '@/lib/alerts';
import type { HazardType } from '@/api/types';

interface GuidanceScreenProps {
  onBack: () => void;
  /** Open on one hazard (e.g. from an alert). */
  initialHazard?: HazardType;
}

const FILTERS: { value: HazardType | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'flood', label: 'Flood' },
  { value: 'fire', label: 'Wildfire' },
  { value: 'earthquake', label: 'Earthquake' },
  { value: 'storm', label: 'Storms' },
  { value: 'landslide', label: 'Landslide' },
  { value: 'other', label: 'Other' },
];

/**
 * Safety guidance, readable with no signal: cards synced from official sources
 * plus the built-in essentials. Most urgent first.
 */
export function GuidanceScreen({ onBack, initialHazard }: GuidanceScreenProps) {
  const { theme } = useTheme();
  const r = useResponsive();
  const isOnline = useOnlineStatus();
  const { cards, syncedAt } = useGuidance();
  const [hazard, setHazard] = useState<HazardType | undefined>(initialHazard);
  const shown = cardsForHazard(cards, hazard);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Safety guidance" onBack={onBack} />
      <ScrollView style={styles.container} contentContainerStyle={{ padding: r.gutter, gap: spacing.scale[3] }}>
        <Text style={[typography.body, { color: theme.text.secondary }]}>
          {isOnline ? 'Saved on this phone, so it works without signal. ' : 'You’re offline. This guidance is saved on your phone. '}
          {syncedAt ? `Updated ${formatTimeAgo(syncedAt)}.` : ''}
        </Text>
        <Text style={[typography.meta, { color: theme.text.secondary }]}>
          Always follow instructions from local authorities and emergency services first.
        </Text>

        <View style={styles.chips} accessibilityRole="radiogroup">
          {FILTERS.map((f) => {
            const selected = hazard === f.value;
            return (
              <Pressable
                key={f.label}
                onPress={() => setHazard(f.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? theme.bg.recessed : 'transparent',
                    borderColor: selected ? theme.text.secondary : theme.line.hairline,
                  },
                ]}
              >
                <Text variant="bodyMedium" style={{ color: theme.text.primary, fontWeight: selected ? '600' : '400' }}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {shown.length === 0 ? (
          <Text style={[typography.body, styles.empty, { color: theme.text.secondary }]}>
            No guidance for this hazard yet. Check “All” for general advice.
          </Text>
        ) : (
          shown.map((card) => <GuidanceCard key={card.card_id} card={card} />)
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.scale[1],
  },
  chip: {
    minHeight: spacing.minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.scale[3],
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  empty: {
    textAlign: 'center',
    paddingVertical: spacing.scale[6],
  },
});
