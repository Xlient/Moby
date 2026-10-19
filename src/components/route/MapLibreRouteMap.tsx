import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { useTheme } from '@/theme/ThemeContext';
import { radius } from '@/theme/tokens';
import { countryAt } from '@/data/emergencyNumbers';
import { basemapFor } from '@/maps/basemap';
import { RouteDiagram, type RouteMapProps } from './RouteDiagram';

/**
 * The route on MapLibre, the app's default map (open tiles, works in China): usual
 * route dashed when it crosses a hazard, the way around solid, a dot by severity where
 * the route meets each hazard. Falls back to the drawn diagram when tiles can't load.
 */
export function MapLibreRouteMap({ check, height = 240 }: RouteMapProps) {
  const { theme, isDark } = useTheme();
  const [failed, setFailed] = useState(false);
  const [startLon, startLat] = check.route.geometry.coordinates[0]!;

  const { lines, hazards, bounds } = useMemo(() => {
    const all = [check.route, ...(check.alternative ? [check.alternative] : [])].flatMap((r) => r.geometry.coordinates);
    const lons = all.map((c) => c[0]!);
    const lats = all.map((c) => c[1]!);
    const lineFeatures: GeoJSON.Feature[] = [
      { type: 'Feature', geometry: check.route.geometry as GeoJSON.LineString, properties: { kind: 'usual' } },
    ];
    if (check.alternative) {
      lineFeatures.push({ type: 'Feature', geometry: check.alternative.geometry as GeoJSON.LineString, properties: { kind: 'around' } });
    }
    return {
      lines: { type: 'FeatureCollection', features: lineFeatures } as GeoJSON.FeatureCollection,
      hazards: {
        type: 'FeatureCollection',
        features: check.route.hazards.map((h) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [h.at.lon, h.at.lat] },
          properties: { severity: h.severity },
        })),
      } as GeoJSON.FeatureCollection,
      bounds: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] as [number, number, number, number],
    };
  }, [check]);

  if (failed) return <RouteDiagram check={check} height={height} />;

  const crosses = check.route.hazards.length > 0;
  const sev = theme.severity;
  const severityColor = ['match', ['get', 'severity'], 'critical', sev.critical, 'high', sev.high, 'medium', sev.medium, sev.low];

  return (
    <View style={[styles.box, { height }]}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={basemapFor(countryAt(startLat!, startLon!), isDark).mapStyle}
        onDidFailLoadingMap={() => setFailed(true)}
        touchRotate={false}
        touchPitch={false}
        logo={false}
      >
        <Camera initialViewState={{ bounds, padding: { top: 32, bottom: 32, left: 32, right: 32 } }} key={JSON.stringify(bounds)} />
        <GeoJSONSource id="route-lines" data={lines}>
          <Layer
            id="route-usual"
            type="line"
            filter={['==', ['get', 'kind'], 'usual'] as never}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': crosses ? theme.text.secondary : theme.accent.calm,
              'line-width': crosses ? 3 : 5,
              ...(crosses ? { 'line-dasharray': [2, 2] } : {}),
            }}
          />
          <Layer
            id="route-around"
            type="line"
            filter={['==', ['get', 'kind'], 'around'] as never}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': theme.accent.calm, 'line-width': 5 }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="route-hazards" data={hazards}>
          <Layer
            id="route-hazard-dots"
            type="circle"
            paint={{
              'circle-radius': 8,
              'circle-color': severityColor as never,
              'circle-stroke-color': theme.bg.raised,
              'circle-stroke-width': 2,
            }}
          />
        </GeoJSONSource>
      </Map>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.card, overflow: 'hidden' },
});
