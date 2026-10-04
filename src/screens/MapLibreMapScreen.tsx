import { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Button, IconButton, ProgressBar, Surface, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  OfflineManager,
  RasterDEMSource,
  UserLocation,
  type CameraRef,
  type LngLatBounds,
  type OfflinePack,
} from '@maplibre/maplibre-react-native';
import { useTheme } from '@/theme/ThemeContext';
import { spacing } from '@/theme/tokens';
import { api } from '@/api/client';
import { useNearbyAlerts } from '@/hooks/useNearbyAlerts';
import { fetchCenter } from '@/location/UserLocationContext';
import { RadiusChip, RadiusPicker } from '@/components/RadiusPicker';
import { RADIUS_OPTIONS } from '@/hooks/useNearbyRadius';
import { countryAt } from '@/data/emergencyNumbers';
import { basemapFor, TERRAIN_TILES } from '@/maps/basemap';
import { PinSheet } from './MapScreen';
import { DiagramMapScreen } from './DiagramMapScreen';

// MapLibre preview of the full-screen map (issue #21): open basemaps with terrain
// shading, alert *areas* drawn by severity, and offline packs. Behind the
// "Terrain map (preview)" switch in Settings; Google stays the default.

interface Props {
  onBack: () => void;
  onAlertDetail: (alertId: string) => void;
}

const MAX_RADIUS_KM: number = RADIUS_OPTIONS[RADIUS_OPTIONS.length - 1] ?? 100;

function circle(lat: number, lon: number, km: number, steps = 64): GeoJSON.Polygon {
  const ring = Array.from({ length: steps + 1 }, (_, i) => {
    const t = (2 * Math.PI * i) / steps;
    return [lon + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(t), lat + (km / 111.32) * Math.cos(t)];
  });
  return { type: 'Polygon', coordinates: [ring] };
}

function boundsAround(lat: number, lon: number, km: number): LngLatBounds {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

function mb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;
}

export function MapLibreMapScreen({ onBack, onAlertDetail }: Props) {
  const { theme, isDark } = useTheme();
  const { nearby, radiusKm, setRadiusKm, isOffline, center } = useNearbyAlerts();
  const camera = useRef<CameraRef>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const country = center.source === 'device' ? countryAt(center.lat, center.lon) : undefined;
  const basemap = useMemo(() => basemapFor(country, isDark), [country, isDark]);
  const selected = nearby.find((n) => n.alert.alert_id === selectedId) ?? null;
  const visibleIds = useMemo(() => new Set(nearby.map((n) => n.alert.alert_id)), [nearby]);

  // Areas for the same alerts the list shows (preferences and radius applied on-device).
  const q = fetchCenter(center);
  const areasQuery = useQuery({
    queryKey: ['alert-areas', q.lat, q.lon],
    queryFn: () => api.getAlertAreas({ lat: q.lat, lon: q.lon, radius_km: MAX_RADIUS_KM }),
    staleTime: 60_000,
  });
  const areas = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: (areasQuery.data?.features ?? []).filter((f) => visibleIds.has(f.properties.alert_id)),
  }), [areasQuery.data, visibleIds]);
  const withArea = useMemo(() => new Set(areas.features.map((f) => f.properties?.alert_id)), [areas]);

  // Alerts without an area (earthquakes, reports) still get a pin.
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

  const recenter = () =>
    camera.current?.fitBounds(boundsAround(center.lat, center.lon, radiusKm * 1.15), { duration: 400 });

  useEffect(() => {
    recenter();
  }, [radiusKm, center.source]);

  const select = (e: { nativeEvent: { features: GeoJSON.Feature[] }; stopPropagation: () => void }) => {
    // Otherwise the tap also reaches Map.onPress, which clears the selection.
    e.stopPropagation();
    // Overlapping warnings: show the most severe one under the finger.
    const rank = { critical: 0, high: 1, medium: 2, low: 3 } as Record<string, number>;
    const top = [...e.nativeEvent.features].sort(
      (a, b) => (rank[a.properties?.severity] ?? 9) - (rank[b.properties?.severity] ?? 9),
    )[0];
    const id = top?.properties?.alert_id;
    if (typeof id === 'string') setSelectedId(id);
  };

  if (failed) {
    return (
      <DiagramMapScreen
        onBack={onBack}
        onAlertDetail={onAlertDetail}
        notice="The map couldn’t load. Showing alert positions without it."
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.bg.base }]}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={basemap.mapStyle}
        onDidFailLoadingMap={() => setFailed(true)}
        onPress={() => setSelectedId(null)}
        attributionPosition={{ bottom: 8, left: 8 }}
        logo={false}
        touchRotate={false}
      >
        <Camera
          ref={camera}
          initialViewState={{ bounds: boundsAround(center.lat, center.lon, radiusKm * 1.15) }}
        />

        {/* Terrain: hillshading makes valleys, ridges and coasts readable at a glance. */}
        <RasterDEMSource id="terrain" tiles={TERRAIN_TILES} encoding="terrarium" tileSize={256} maxzoom={14}>
          <Layer
            id="hillshade"
            type="hillshade"
            // Only exaggeration: maplibre-react-native 11.4 on Android crashes on a single
            // 'hillshade-shadow-color' (it expects the newer multi-light array form).
            paint={{ 'hillshade-exaggeration': isDark ? 0.25 : 0.35 }}
          />
        </RasterDEMSource>

        <GeoJSONSource id="radius" data={ring}>
          <Layer id="radius-line" type="line" paint={{ 'line-color': theme.accent.calm, 'line-width': 2 }} />
        </GeoJSONSource>

        {/* Warning areas, most severe on top; tap selects the alert. */}
        <GeoJSONSource id="areas" data={areas} onPress={select}>
          <Layer
            id="areas-fill"
            type="fill"
            paint={{ 'fill-color': severityColor as never, 'fill-opacity': 0.12 }}
          />
          <Layer
            id="areas-line"
            type="line"
            paint={{ 'line-color': severityColor as never, 'line-width': ['case', ['==', ['get', 'alert_id'], selectedId ?? ''], 3, 1.5] as never }}
          />
        </GeoJSONSource>

        <GeoJSONSource id="pins" data={pins} onPress={select}>
          <Layer
            id="pins-circle"
            type="circle"
            paint={{
              'circle-radius': ['case', ['==', ['get', 'alert_id'], selectedId ?? ''], 10, 7] as never,
              'circle-color': severityColor as never,
              'circle-stroke-color': theme.bg.raised,
              'circle-stroke-width': 2,
            }}
          />
        </GeoJSONSource>

        <UserLocation accuracy />
      </Map>

      <View style={styles.topBar} pointerEvents="box-none">
        <Surface elevation={1} style={[styles.topBarInner, { backgroundColor: theme.bg.raised }]}>
          <IconButton icon="arrow-left" onPress={onBack} accessibilityLabel="Go back" iconColor={theme.text.primary} />
          <Text variant="titleMedium" accessibilityRole="header" style={[styles.title, { color: theme.text.primary }]}>
            Map
          </Text>
          <RadiusChip radiusKm={radiusKm} onPress={() => setPickerVisible(true)} />
        </Surface>
        <Surface elevation={1} style={[styles.notice, { backgroundColor: theme.bg.raised }]}>
          <Text variant="bodySmall" style={{ color: theme.text.secondary }}>
            Preview map · {basemap.kind === 'tianditu' ? 'Tianditu (China)' : 'OpenStreetMap'}
            {isOffline ? ' · offline: showing saved alerts' : ''}
          </Text>
        </Surface>
      </View>

      <View style={styles.bottom} pointerEvents="box-none">
        <View style={styles.buttons} pointerEvents="box-none">
          {basemap.offline && (
            <IconButton
              icon="download"
              mode="contained"
              size={24}
              onPress={() => setOfflineOpen((o) => !o)}
              accessibilityLabel="Offline maps"
              containerColor={theme.bg.raised}
              iconColor={theme.text.primary}
              style={styles.round}
            />
          )}
          <IconButton
            icon="crosshairs-gps"
            mode="contained"
            size={24}
            onPress={recenter}
            accessibilityLabel="Re-center map"
            containerColor={theme.bg.raised}
            iconColor={theme.text.primary}
            style={styles.round}
          />
        </View>
        {offlineOpen && basemap.offline && (
          <OfflinePanel
            styleUrl={basemap.mapStyle as string}
            center={center}
            radiusKm={radiusKm}
            onClose={() => setOfflineOpen(false)}
          />
        )}
        {selected && !offlineOpen && (
          <PinSheet
            item={selected}
            theme={theme}
            onViewDetails={() => onAlertDetail(selected.alert.alert_id)}
            onDismiss={() => setSelectedId(null)}
          />
        )}
      </View>

      <RadiusPicker
        visible={pickerVisible}
        selected={radiusKm}
        onSelect={(value) => {
          setRadiusKm(value);
          setPickerVisible(false);
        }}
        onDismiss={() => setPickerVisible(false)}
      />
    </View>
  );
}

/** Save the map around here for use with no signal, and manage saved maps. */
function OfflinePanel({
  styleUrl,
  center,
  radiusKm,
  onClose,
}: {
  styleUrl: string;
  center: { lat: number; lon: number };
  radiusKm: number;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const [packs, setPacks] = useState<{ pack: OfflinePack; name: string; size: number; done: boolean }[]>([]);
  const [progress, setProgress] = useState<{ pct: number; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const all = await OfflineManager.getPacks();
    setPacks(
      await Promise.all(
        all.map(async (pack) => {
          const s = await pack.status();
          const meta = (pack.metadata ?? {}) as { name?: string };
          return { pack, name: meta.name ?? 'Saved area', size: s.completedResourceSize, done: s.state === 'complete' };
        }),
      ),
    );
  };

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  const download = async () => {
    setError(null);
    setProgress({ pct: 0, size: 0 });
    const name = `${radiusKm} km around ${center.lat.toFixed(2)}, ${center.lon.toFixed(2)}`;
    try {
      await OfflineManager.createPack(
        {
          mapStyle: styleUrl,
          bounds: boundsAround(center.lat, center.lon, radiusKm),
          // Street level is enough to find your way; deeper zooms multiply the size.
          minZoom: 6,
          maxZoom: radiusKm > 25 ? 12 : 14,
          metadata: { name },
        },
        (_pack, status) => {
          setProgress({ pct: status.percentage, size: status.completedResourceSize });
          if (status.state === 'complete') {
            setProgress(null);
            refresh().catch(() => {});
          }
        },
        (_pack, err) => {
          setError(err.message);
          setProgress(null);
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  };

  return (
    <Surface elevation={2} style={[styles.sheet, { backgroundColor: theme.bg.base }]}>
      <Text variant="titleMedium" style={{ color: theme.text.primary }}>Offline map</Text>
      <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
        Save the map within {radiusKm} km of here, so it still shows with no signal. Alerts and guidance are saved
        separately.
      </Text>
      {progress ? (
        <View style={styles.progress}>
          <ProgressBar progress={progress.pct / 100} color={theme.accent.calm} />
          <Text variant="bodySmall" style={{ color: theme.text.secondary }}>
            {Math.round(progress.pct)}% · {mb(progress.size)}
          </Text>
        </View>
      ) : (
        <Button mode="contained-tonal" icon="download" onPress={download} style={styles.alignStart}>
          Save this area
        </Button>
      )}
      {error && <Text variant="bodySmall" style={{ color: theme.severity.high }}>Couldn’t save: {error}</Text>}
      {packs.map(({ pack, name, size, done }) => (
        <View key={pack.id} style={styles.packRow}>
          <Text variant="bodyMedium" style={{ color: theme.text.primary, flex: 1 }}>
            {name} · {mb(size)}{done ? '' : ' (incomplete)'}
          </Text>
          <Button
            mode="text"
            textColor={theme.text.secondary}
            onPress={async () => {
              await OfflineManager.deletePack(pack.id);
              refresh().catch(() => {});
            }}
          >
            Remove
          </Button>
        </View>
      ))}
      <Button mode="text" onPress={onClose} textColor={theme.text.secondary} style={styles.alignEnd}>
        Close
      </Button>
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: spacing.scale[2],
    left: spacing.screenGutter,
    right: spacing.screenGutter,
    gap: spacing.scale[2],
  },
  topBarInner: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingRight: spacing.scale[2] },
  title: { flex: 1 },
  notice: { alignSelf: 'flex-start', borderRadius: 12, paddingVertical: spacing.scale[1], paddingHorizontal: spacing.scale[3] },
  bottom: {
    position: 'absolute',
    left: spacing.screenGutter,
    right: spacing.screenGutter,
    bottom: spacing.screenGutter + 16,
    gap: spacing.scale[2],
  },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.scale[2] },
  round: { margin: 0 },
  sheet: { borderRadius: 20, padding: spacing.scale[3], gap: spacing.scale[2] },
  progress: { gap: spacing.scale[1] },
  packRow: { flexDirection: 'row', alignItems: 'center' },
  alignStart: { alignSelf: 'flex-start' },
  alignEnd: { alignSelf: 'flex-end' },
});
