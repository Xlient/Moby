import { View, ScrollView, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing } from '@/theme/tokens';
import { GuidanceCard } from '@/components/GuidanceCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useGuidanceCards } from '@/hooks/useGuidanceCards';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResponsive } from '@/hooks/useResponsive';

interface GuidanceScreenProps {
  onBack: () => void;
}

export function GuidanceScreen({ onBack }: GuidanceScreenProps) {
  const { theme } = useTheme();
  const isOnline = useOnlineStatus();
  const { cards, loading, error, isStale, cachedAt } = useGuidanceCards();
  const r = useResponsive();

  const statusText = [
    typography.body,
    styles.center,
    { color: theme.text.secondary, paddingVertical: r.sectionGap },
  ];

  return (
    <View style={styles.container}>
      <ScreenHeader title="Safety guidance" onBack={onBack} />

      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.scrollContent, { padding: r.gutter }]}
      >
        {loading && <Text style={statusText}>Loading guidance cards</Text>}

        {error && cards.length === 0 && <Text style={statusText}>{error}</Text>}

        {!loading && !error && cards.length === 0 && (
          <View style={[styles.emptyState, { padding: r.sectionGap }]}>
            <Text
              accessibilityRole="header"
              style={[r.heading, styles.center, { color: theme.text.primary }]}
            >
              No guidance cards available
            </Text>
            <Text
              style={[typography.body, styles.center, styles.emptyBody, { color: theme.text.secondary }]}
            >
              Guidance cards for your region will appear here when available.
            </Text>
          </View>
        )}

        {cards.length > 0 && (
          <>
            {!isOnline && cachedAt && (
              <Text
                style={[typography.meta, styles.center, styles.offlineNote, { color: theme.text.faint }]}
              >
                Showing saved guidance
              </Text>
            )}
            <View style={styles.list}>
              {cards.map((card) => (
                <GuidanceCard key={card.card_id} card={card} isStale={isStale} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  center: {
    textAlign: 'center',
  },
  list: {
    gap: spacing.scale[3],
  },
  offlineNote: {
    marginBottom: spacing.scale[3],
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBody: {
    marginTop: spacing.scale[2],
    maxWidth: 360,
  },
});
