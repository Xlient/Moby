import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Camera, Map, UserLocation } from '@maplibre/maplibre-react-native';
import { useTheme } from '@/theme/ThemeContext';
import { useUserCenter } from '@/location/UserLocationContext';
import { countryAt } from '@/data/emergencyNumbers';
import type { NearbyAlert } from '@/hooks/useNearbyAlerts';
import { AlertMapLayers } from '@/maps/AlertMapLayers';
import { basemapFor } from '@/maps/basemap';
import { boundsAround } from '@/maps/geo';
import { MapDiagram } from './MapDiagram';

/** Static MapLibre preview for the Home card: no gestures; the card opens the full map. */
export function MapLibrePreviewCanvas({ nearby, radiusKm }: { nearby: NearbyAlert[]; radiusKm: number }) {
  const { isDark } = useTheme();
  const center = useUserCenter();
  const [failed, setFailed] = useState(false);
  const country = center.source === 'device' ? countryAt(center.lat, center.lon) : undefined;

  // No tiles (no signal, nothing saved): the diagram still shows the alerts.
  if (failed) return <MapDiagram nearby={nearby} radiusKm={radiusKm} />;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={basemapFor(country, isDark).mapStyle}
        onDidFailLoadingMap={() => setFailed(true)}
        dragPan={false}
        touchZoom={false}
        doubleTapZoom={false}
        doubleTapHoldZoom={false}
        touchRotate={false}
        touchPitch={false}
        logo={false}
        attribution={false}
      >
        <Camera initialViewState={{ bounds: boundsAround(center.lat, center.lon, radiusKm * 1.2) }}
          key={`${radiusKm}-${center.lat.toFixed(3)},${center.lon.toFixed(3)}`} />
        <AlertMapLayers nearby={nearby} center={center} radiusKm={radiusKm} />
        <UserLocation />
      </Map>
    </View>
  );
}
