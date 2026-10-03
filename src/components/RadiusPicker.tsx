import { View, Pressable, StyleSheet } from 'react-native';
import { Text, Portal } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { spacing, radius } from '@/theme/tokens';
import { RADIUS_OPTIONS, type RadiusKm } from '@/hooks/useNearbyRadius';
import Svg, { Path } from 'react-native-svg';

interface RadiusPickerProps {
  visible: boolean;
  selected: RadiusKm;
  onSelect: (value: RadiusKm) => void;
  onDismiss: () => void;
}

export function RadiusPicker({ visible, selected, onSelect, onDismiss }: RadiusPickerProps) {
  const { theme } = useTheme();

  if (!visible) return null;

  return (
    <Portal>
      <Pressable
        style={styles.backdrop}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Close radius picker"
      >
        <View />
      </Pressable>
      <View style={styles.sheetWrapper}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.bg.raised,
              borderColor: theme.line.hairline,
            },
          ]}
        >
          <Text
            variant="titleMedium"
            style={{ color: theme.text.primary, marginBottom: spacing.scale[3] }}
          >
            Search radius
          </Text>

          {RADIUS_OPTIONS.map((option) => {
            const isSelected = option === selected;
            return (
              <Pressable
                key={option}
                onPress={() => onSelect(option)}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={`${option} kilometres`}
                style={[
                  styles.option,
                  {
                    backgroundColor: isSelected ? theme.bg.recessed : 'transparent',
                    borderRadius: radius.chip,
                  },
                ]}
              >
                <Text
                  variant="bodyLarge"
                  style={{
                    color: isSelected ? theme.text.primary : theme.text.secondary,
                    fontWeight: isSelected ? '600' : '400',
                  }}
                >
                  {option} km
                </Text>
                {isSelected && (
                  <Svg width={20} height={20} viewBox="0 0 20 20" fill="none">
                    <Path
                      d="M5 10l3.5 3.5L15 7"
                      stroke={theme.accent.calm}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    </Portal>
  );
}

export function RadiusChip({
  radiusKm,
  onPress,
}: {
  radiusKm: RadiusKm;
  onPress: () => void;
}) {
  const { theme } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Search radius: ${radiusKm} kilometres. Tap to change.`}
      style={[
        styles.chip,
        {
          backgroundColor: theme.bg.recessed,
          borderColor: theme.line.hairline,
        },
      ]}
    >
      <Text
        variant="labelSmall"
        style={{ color: theme.text.secondary }}
      >
        {radiusKm} km
      </Text>
      <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
        <Path
          d="M3 4.5L6 7.5L9 4.5"
          stroke={theme.text.faint}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheetWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.screenGutter,
    paddingBottom: spacing.scale[6],
  },
  sheet: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.scale[4],
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.scale[2],
    paddingHorizontal: spacing.scale[3],
    minHeight: spacing.minTapTarget,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.scale[0],
    paddingVertical: spacing.scale[0],
    paddingHorizontal: spacing.scale[2],
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
