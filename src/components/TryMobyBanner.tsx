import { StyleSheet, View } from 'react-native';
import { Avatar, Button, Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { radius, spacing } from '@/theme/tokens';
import { env } from '@/config/env';
import { setDemoMode, setViewing, useNoReplayHere, useTryMoby } from '@/lib/tryMoby';

/**
 * Home, while trying Moby (Settings → Try Moby): what's different and one tap to stop.
 * Never subtle: someone must not mistake another place, or a replay, for their own situation.
 */
export function TryMobyBanner() {
  const { theme } = useTheme();
  const { viewing, demoMode } = useTryMoby();
  const noReplayHere = useNoReplayHere();
  const showViewing = !!viewing && !env.useMock;
  if (!showViewing && !demoMode) return null;

  const lines = [
    showViewing ? `Viewing ${viewing!.name}, not where you are. Live alerts from there.` : null,
    demoMode
      ? noReplayHere
        ? // Only alerts from this region are replayed: say there are none, never borrow far-away ones.
          'Demo mode: Moby has no serious past alerts from this region to replay, so none are shown. Try a busy place from Try Moby.'
        : 'Demo mode: real past alerts from this region replayed here, marked Demo. Not current warnings.'
      : null,
  ].filter(Boolean) as string[];

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`Trying Moby. ${lines.join(' ')}`}
      style={[styles.banner, { backgroundColor: theme.bg.recessed, borderColor: theme.text.secondary }]}
    >
      <View style={styles.row}>
        <Avatar.Icon size={36} icon={demoMode ? 'play-circle-outline' : 'map-marker-radius-outline'}
          color={theme.text.primary} style={{ backgroundColor: theme.bg.raised }} />
        <View style={styles.text}>
          <Text variant="titleSmall" style={{ color: theme.text.primary }}>Trying Moby</Text>
          {lines.map((l) => (
            <Text key={l} variant="bodyMedium" style={{ color: theme.text.primary }}>{l}</Text>
          ))}
        </View>
      </View>
      <View style={styles.actions}>
        {showViewing && (
          <Button mode="text" compact textColor={theme.text.primary} onPress={() => setViewing(null)}>
            Use my location
          </Button>
        )}
        {demoMode && (
          <Button mode="text" compact textColor={theme.text.primary} onPress={() => setDemoMode(false)}>
            Stop demo
          </Button>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.card,
    padding: spacing.scale[3],
    marginBottom: spacing.sectionGap,
    gap: spacing.scale[1],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.scale[3],
  },
  text: {
    flex: 1,
    gap: spacing.scale[0],
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  },
});
