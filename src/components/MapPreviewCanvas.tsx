import { View, StyleSheet } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useTheme } from '@/theme/ThemeContext';
import { mapStyleDark, mapStyleLight } from '@/theme/mapStyle';
import { useUserCenter } from '@/location/UserLocationContext';
import { regionForRadius, toLatLng } from '@/lib/mapGeometry';
import type { NearbyAlert } from '@/hooks/useNearbyAlerts';
import { useMapLoadFallback } from '@/hooks/useMapLoadFallback';
import { AlertMarker } from './AlertMarker';
import { MapDiagram } from './MapDiagram';

interface MapPreviewCanvasProps {
  nearby: NearbyAlert[];
  radiusKm: number;
}

/**
 * Android/iOS: a static Google map. Android "lite mode" renders a bitmap with no
 * gestures, which is exactly the spec's non-interactive preview. Touches pass
 * through to the card, which opens the full map.
 */
export function MapPreviewCanvas({ nearby, radiusKm }: MapPreviewCanvasProps) {
  const { theme, isDark } = useTheme();
  const center = useUserCenter();
  const mapKey = `${radiusKm}-${isDark ? 'dark' : 'light'}-${center.lat.toFixed(3)},${center.lon.toFixed(3)}`;
  const { failed, onMapLoaded } = useMapLoadFallback(mapKey);

  // No tiles (no signal, Google unreachable): the diagram still shows the pins.
  if (failed) return <MapDiagram nearby={nearby} radiusKm={radiusKm} />;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <MapView
        // Remount on radius/theme/centre change: lite mode doesn't animate region changes.
        key={mapKey}
        onMapLoaded={onMapLoaded}
        provider={PROVIDER_GOOGLE}
        liteMode
        style={StyleSheet.absoluteFill}
        initialRegion={regionForRadius(center, radiusKm, 1.15)}
        customMapStyle={isDark ? mapStyleDark : mapStyleLight}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Circle
          center={toLatLng(center)}
          radius={radiusKm * 1000}
          strokeColor={theme.accent.calm}
          strokeWidth={2}
          fillColor={`${theme.accent.calm}1A`}
        />
        <Marker coordinate={toLatLng(center)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View style={[styles.you, { backgroundColor: theme.text.primary, borderColor: theme.bg.raised }]} />
        </Marker>
        {nearby.map(({ alert }) => (
          <AlertMarker key={alert.alert_id} alert={alert} />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  you: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
  },
});
