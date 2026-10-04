import { useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeContext';
import { pinPath } from '@/lib/alerts';
import { latLonToXY } from '@/lib/geo';
import { useUserCenter } from '@/location/UserLocationContext';
import type { NearbyAlert } from '@/hooks/useNearbyAlerts';

interface MapDiagramProps {
  nearby: NearbyAlert[];
  radiusKm: number;
}

const PIN_SIZE = 16;

/**
 * The preview's pins and radius circle as a simple diagram (no basemap). Used on
 * web, and on phones while/when Google map tiles can't load.
 */
export function MapDiagram({ nearby, radiusKm }: MapDiagramProps) {
  const { theme } = useTheme();
  const center = useUserCenter();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  let plot = null;
  if (size) {
    const cx = size.width / 2;
    const cy = size.height / 2;
    const rPx = size.height * 0.42;
    const pxPerKm = rPx / radiusKm;
    plot = (
      <Svg width={size.width} height={size.height}>
        <Circle cx={cx} cy={cy} r={rPx} fill={theme.accent.calm} fillOpacity={0.08} />
        <Circle
          cx={cx}
          cy={cy}
          r={rPx}
          stroke={theme.accent.calm}
          strokeOpacity={0.6}
          strokeWidth={1.5}
          strokeDasharray="6 4"
          fill="none"
        />
        {/* You are here — drawn first so alert pins stay visible on top */}
        <Circle cx={cx} cy={cy} r={7} fill={theme.bg.raised} />
        <Circle cx={cx} cy={cy} r={4.5} fill={theme.text.primary} />
        {nearby.map(({ alert }) => {
          if (!alert.location) return null;
          const { x, y } = latLonToXY(alert.location.lat, alert.location.lon, center);
          const unverified = alert.verification_label === 'unverified_report';
          const color = unverified ? theme.text.secondary : theme.severity[alert.severity];
          return (
            <G
              key={alert.alert_id}
              transform={`translate(${cx + x * pxPerKm - PIN_SIZE / 2}, ${cy + y * pxPerKm - PIN_SIZE / 2}) scale(${PIN_SIZE / 24})`}
            >
              <Path
                d={pinPath(alert.severity)}
                fill={unverified ? theme.bg.raised : color}
                fillOpacity={unverified ? 1 : 0.85}
                stroke={unverified ? color : theme.bg.raised}
                strokeWidth={2.5}
              />
            </G>
          );
        })}
      </Svg>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {plot}
    </View>
  );
}
