import { useMemo } from 'react';
import { GeoJSONSource, Layer, RasterDEMSource } from '@maplibre/maplibre-react-native';
import { useTheme } from '@/theme/ThemeContext';
import type { NearbyAlert } from '@/hooks/useNearbyAlerts';
import type { UserCenter } from '@/location/UserLocationContext';
import { TERRAIN_TILES } from './basemap';
import { circle } from './geo';
import { useAlertAreas } from './useAlertAreas';

type PressEvent = { nativeEvent: { features: GeoJSON.Feature[] }; stopPropagation: () => void };

interface Props {
  nearby: NearbyAlert[];
  center: UserCenter;
  radiusKm: number;
  selectedId?: string | null;
  /** Omit for the static Home preview. */
  onSelect?: (alertId: string) => void;
}

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * What both MapLibre maps draw (issue #21): terrain shading, the watch radius,
 * warning areas shaded by severity, and pins for alerts without an area.
 */
export function AlertMapLayers({ nearby, center, radiusKm, selectedId = null, onSelect }: Props) {
  const { theme, isDark } = useTheme();
  const ids = useMemo(() => new Set(nearby.map((n) => n.alert.alert_id)), [nearby]);
  const areas = useAlertAreas(center, ids);
  const withArea = useMemo(() => new Set(areas.features.map((f) => f.properties?.alert_id)), [areas]);
  const pins = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: nearby
      .filter(({ alert }) => alert.location && !withArea.has(alert.alert_id))
      .map(({ alert }) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [alert.location!.lon, alert.location!.lat] },
        properties: { alert_id: alert.alert_id, severity: alert.severity },
      })),
  }), [nearby, withArea]);
  const ring = useMemo(() => circle(center.lat, center.lon, radiusKm), [center.lat, center.lon, radiusKm]);
  const sev = theme.severity;
  const severityColor = ['match', ['get', 'severity'], 'critical', sev.critical, 'high', sev.high, 'medium', sev.medium, sev.low];
  const isSelected = ['==', ['get', 'alert_id'], selectedId ?? ''];

  const press = onSelect
    ? (e: PressEvent) => {
        // Otherwise the tap also reaches Map.onPress, which clears the selection.
        e.stopPropagation();
        // Overlapping warnings: the most severe one under the finger.
        const top = [...e.nativeEvent.features].sort(
          (a, b) => (RANK[a.properties?.severity] ?? 9) - (RANK[b.properties?.severity] ?? 9),
        )[0];
        const id = top?.properties?.alert_id;
        if (typeof id === 'string') onSelect(id);
      }
    : undefined;

  return (
    <>
      <RasterDEMSource id="terrain" tiles={TERRAIN_TILES} encoding="terrarium" tileSize={256} maxzoom={14}>
        {/* Only exaggeration: maplibre-react-native 11.4 on Android crashes on a single
            'hillshade-shadow-color' (it expects the newer multi-light array form). */}
        <Layer id="hillshade" type="hillshade" paint={{ 'hillshade-exaggeration': isDark ? 0.25 : 0.35 }} />
      </RasterDEMSource>

      <GeoJSONSource id="radius" data={ring}>
        <Layer id="radius-line" type="line" paint={{ 'line-color': theme.accent.calm, 'line-width': 2 }} />
      </GeoJSONSource>

      <GeoJSONSource id="areas" data={areas} onPress={press}>
        <Layer id="areas-fill" type="fill" paint={{ 'fill-color': severityColor as never, 'fill-opacity': 0.12 }} />
        <Layer
          id="areas-line"
          type="line"
          paint={{ 'line-color': severityColor as never, 'line-width': ['case', isSelected, 3, 1.5] as never }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="pins" data={pins} onPress={press}>
        <Layer
          id="pins-circle"
          type="circle"
          paint={{
            'circle-radius': ['case', isSelected, 10, 7] as never,
            'circle-color': severityColor as never,
            'circle-stroke-color': theme.bg.raised,
            'circle-stroke-width': 2,
          }}
        />
      </GeoJSONSource>
    </>
  );
}
