import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Marker } from 'react-native-maps';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeContext';
import { pinPath, severityLabel, trustText } from '@/lib/alerts';
import type { Alert } from '@/api/types';

interface AlertMarkerProps {
  alert: Alert;
  selected?: boolean;
  onPress?: () => void;
}

/**
 * A map pin with severity encoded by color and shape; unverified reports are
 * neutral outlines (never severity-colored), matching the card treatment.
 */
export function AlertMarker({ alert, selected = false, onPress }: AlertMarkerProps) {
  const { theme } = useTheme();
  // Custom-view markers are snapshotted to bitmaps. Track view changes only until
  // the SVG has drawn (Android otherwise snapshots an empty view), then stop so
  // 100+ pins stay smooth.
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  useEffect(() => {
    setTracksViewChanges(true);
    const t = setTimeout(() => setTracksViewChanges(false), 500);
    return () => clearTimeout(t);
  }, [selected, theme]);

  if (!alert.location) return null;

  const unverified = alert.verification_label === 'unverified_report';
  const color = unverified ? theme.text.secondary : theme.severity[alert.severity];
  const size = selected ? 30 : 22;

  return (
    <Marker
      coordinate={{ latitude: alert.location.lat, longitude: alert.location.lon }}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={onPress}
      tracksViewChanges={tracksViewChanges}
      zIndex={selected ? 10 : 1}
      accessibilityLabel={`${alert.headline}. ${severityLabel(alert.severity)}. ${trustText(alert)}.`}
    >
      <View style={styles.hit}>
        <Svg width={size} height={size} viewBox="-2 -2 28 28">
          <Path
            d={pinPath(alert.severity)}
            fill={unverified ? theme.bg.raised : color}
            stroke={unverified ? color : theme.bg.raised}
            strokeWidth={unverified ? 2.5 : 3}
            strokeLinejoin="round"
          />
        </Svg>
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  hit: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
