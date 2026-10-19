import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeContext';
import { radius } from '@/theme/tokens';
import type { RouteCheck } from '@/api/types';

export interface RouteMapProps {
  check: RouteCheck;
  height?: number;
}

const W = 320;

/**
 * The routes drawn without map tiles: on the web, and on a phone when the map can't
 * load (no signal). Usual route dashed, the way around solid, hazards as dots by severity.
 */
export function RouteDiagram({ check, height = 200 }: RouteMapProps) {
  const { theme } = useTheme();
  const lines = [check.route, ...(check.alternative ? [check.alternative] : [])];
  const all = lines.flatMap((r) => r.geometry.coordinates);
  const lons = all.map((c) => c[0]!);
  const lats = all.map((c) => c[1]!);
  const [minLon, maxLon, minLat, maxLat] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const pad = 16;
  const scale = Math.min((W - 2 * pad) / Math.max(maxLon - minLon, 1e-6), (height - 2 * pad) / Math.max(maxLat - minLat, 1e-6));
  const x = (lon: number) => pad + (lon - minLon) * scale + ((W - 2 * pad) - (maxLon - minLon) * scale) / 2;
  const y = (lat: number) => height - pad - (lat - minLat) * scale - ((height - 2 * pad) - (maxLat - minLat) * scale) / 2;
  const points = (coords: number[][]) => coords.map(([lon, lat]) => `${x(lon!)},${y(lat!)}`).join(' ');
  const crosses = check.route.hazards.length > 0;
  const [startLon, startLat] = check.route.geometry.coordinates[0]!;
  const [endLon, endLat] = check.route.geometry.coordinates[check.route.geometry.coordinates.length - 1]!;

  return (
    <View
      style={[styles.box, { height, backgroundColor: theme.bg.recessed }]}
      accessibilityLabel={check.alternative ? 'Diagram: the usual route, dashed, and the way around, solid' : 'Diagram of the route'}
    >
      <Svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`}>
        <Polyline
          points={points(check.route.geometry.coordinates)}
          fill="none"
          stroke={crosses ? theme.text.faint : theme.accent.calm}
          strokeWidth={crosses ? 3 : 5}
          strokeDasharray={crosses ? '6 6' : undefined}
        />
        {check.alternative && (
          <Polyline points={points(check.alternative.geometry.coordinates)} fill="none" stroke={theme.accent.calm} strokeWidth={5} />
        )}
        {check.route.hazards.map((h) => (
          <Circle key={h.event_id} cx={x(h.at.lon)} cy={y(h.at.lat)} r={8} fill={theme.severity[h.severity]} />
        ))}
        <Circle cx={x(startLon!)} cy={y(startLat!)} r={6} fill={theme.text.primary} />
        <Circle cx={x(endLon!)} cy={y(endLat!)} r={6} fill={theme.bg.raised} stroke={theme.text.primary} strokeWidth={3} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.card, overflow: 'hidden' },
});
