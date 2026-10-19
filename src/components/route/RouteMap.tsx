import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useTheme } from '@/theme/ThemeContext';
import { radius } from '@/theme/tokens';
import { mapStyleDark, mapStyleLight } from '@/theme/mapStyle';
import { useMapLoadFallback } from '@/hooks/useMapLoadFallback';
import { RouteDiagram, type RouteMapProps } from './RouteDiagram';

const toLatLng = ([lon, lat]: number[]) => ({ latitude: lat!, longitude: lon! });

/**
 * The usual route (dashed when it crosses a hazard), the way around (solid), and a
 * marker where the route meets each hazard. Falls back to the drawn diagram when the
 * map can't load.
 */
export function RouteMap({ check, height = 240 }: RouteMapProps) {
  const { theme, isDark } = useTheme();
  const { failed, onMapLoaded } = useMapLoadFallback(check);
  if (failed) return <RouteDiagram check={check} height={height} />;

  const usual = check.route.geometry.coordinates.map(toLatLng);
  const around = check.alternative?.geometry.coordinates.map(toLatLng);
  const crosses = check.route.hazards.length > 0;

  return (
    <View style={[styles.box, { height }]}>
      <MapView
        onMapLoaded={onMapLoaded}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        style={StyleSheet.absoluteFill}
        customMapStyle={isDark ? mapStyleDark : mapStyleLight}
        userInterfaceStyle={isDark ? 'dark' : 'light'}
        toolbarEnabled={false}
        initialRegion={region([...usual, ...(around ?? [])])}
      >
        <Polyline
          coordinates={usual}
          strokeColor={crosses ? theme.text.faint : theme.accent.calm}
          strokeWidth={crosses ? 3 : 5}
          lineDashPattern={crosses ? [8, 8] : undefined}
        />
        {around && <Polyline coordinates={around} strokeColor={theme.accent.calm} strokeWidth={5} />}
        {check.route.hazards.map((h) => (
          <Marker
            key={h.event_id}
            coordinate={{ latitude: h.at.lat, longitude: h.at.lon }}
            pinColor={theme.severity[h.severity]}
            title={h.headline ?? 'Hazard'}
            tracksViewChanges={false}
          />
        ))}
      </MapView>
    </View>
  );
}

function region(points: { latitude: number; longitude: number }[]) {
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  const [minLat, maxLat, minLon, maxLon] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.3, 0.01),
    longitudeDelta: Math.max((maxLon - minLon) * 1.3, 0.01),
  };
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.card, overflow: 'hidden' },
});
