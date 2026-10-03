import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Button, IconButton, Surface, Text } from 'react-native-paper';
import MapView, { Circle, Marker, Polygon, PROVIDER_GOOGLE } from 'react-native-maps';
import { useTheme } from '@/theme/ThemeContext';
import type { Theme } from '@/theme/tokens';
import { spacing } from '@/theme/tokens';
import { mapStyleDark, mapStyleLight } from '@/theme/mapStyle';
import { useNearbyAlerts } from '@/hooks/useNearbyAlerts';
import { useMapLoadFallback } from '@/hooks/useMapLoadFallback';
import { DiagramMapScreen } from './DiagramMapScreen';
import { RadiusChip, RadiusPicker } from '@/components/RadiusPicker';
import { AlertCard } from '@/components/AlertCard';
import { AlertMarker } from '@/components/AlertMarker';
import { USER_CENTER } from '@/lib/geo';
import { circlePoints, regionForRadius, surroundingBox, toLatLng } from '@/lib/mapGeometry';
import type { NearbyAlert } from '@/hooks/useNearbyAlerts';

// Full-screen map (home redesign spec v3, Part 4 / card H4). Android/iOS only;
// the web build uses MapScreen.web.tsx.

interface MapScreenProps {
  onBack: () => void;
  onAlertDetail: (alertId: string) => void;
}

function PinSheet({
  item,
  theme,
  onViewDetails,
  onDismiss,
}: {
  item: NearbyAlert;
  theme: Theme;
  onViewDetails: () => void;
  onDismiss: () => void;
}) {
  return (
    <Surface elevation={2} style={[styles.sheet, { backgroundColor: theme.bg.base }]}>
      {/* Identical trust treatment to the home list. */}
      <AlertCard alert={item.alert} distanceKm={item.distanceKm} />
      <View style={styles.sheetActions}>
        <Button mode="text" onPress={onDismiss} textColor={theme.text.secondary} contentStyle={styles.tapTarget}>
          Close
        </Button>
        <Button mode="contained-tonal" onPress={onViewDetails} contentStyle={styles.tapTarget}>
          View details
        </Button>
      </View>
    </Surface>
  );
}

export function MapScreen({ onBack, onAlertDetail }: MapScreenProps) {
  const { theme, isDark } = useTheme();
  // Same source as the home list, so the pins always match it for the same radius.
  const { nearby, radiusKm, setRadiusKm, isOffline } = useNearbyAlerts();
  const mapRef = useRef<MapView>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // TODO(location): centre on the device position.
  const center = USER_CENTER;
  const selected = nearby.find((n) => n.alert.alert_id === selectedId) ?? null;

  const { failed: tilesFailed, onMapLoaded } = useMapLoadFallback();

  const recenter = () => {
    mapRef.current?.animateToRegion(regionForRadius(center, radiusKm), 350);
  };

  // Re-fit when the radius changes; drop a selection the new radius excludes.
  useEffect(() => {
    recenter();
  }, [radiusKm]);
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  if (tilesFailed) {
    return (
      <DiagramMapScreen
        onBack={onBack}
        onAlertDetail={onAlertDetail}
        notice={
          isOffline
            ? 'Offline — map tiles unavailable. Pins show the last saved alerts.'
            : 'The map couldn’t load. Showing alert positions without it.'
        }
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.bg.base }]}>
      <MapView
        onMapLoaded={onMapLoaded}
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={regionForRadius(center, radiusKm)}
        customMapStyle={isDark ? mapStyleDark : mapStyleLight}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsCompass={false}
        onPress={(e) => {
          // Taps on markers also reach the map; only clear on taps elsewhere.
          if (e.nativeEvent.action !== 'marker-press') setSelectedId(null);
        }}
      >
        {/* Gently dim everything outside the radius. */}
        <Polygon
          coordinates={surroundingBox(center)}
          holes={[circlePoints(center, radiusKm)]}
          fillColor={isDark ? 'rgba(0,0,0,0.35)' : 'rgba(31,42,46,0.12)'}
          strokeWidth={0}
        />
        <Circle
          center={toLatLng(center)}
          radius={radiusKm * 1000}
          strokeColor={theme.accent.calm}
          strokeWidth={2}
        />
        <Marker
          coordinate={toLatLng(center)}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          accessibilityLabel="Your location"
        >
          <View style={[styles.you, { backgroundColor: theme.text.primary, borderColor: theme.bg.raised }]} />
        </Marker>
        {nearby.map(({ alert }) => (
          <AlertMarker
            key={alert.alert_id}
            alert={alert}
            selected={alert.alert_id === selectedId}
            onPress={() => setSelectedId(alert.alert_id)}
          />
        ))}
      </MapView>

      <View style={styles.topBar} pointerEvents="box-none">
        <Surface elevation={1} style={[styles.topBarInner, { backgroundColor: theme.bg.raised }]}>
          <IconButton icon="arrow-left" onPress={onBack} accessibilityLabel="Go back" iconColor={theme.text.primary} />
          <Text variant="titleMedium" accessibilityRole="header" style={[styles.title, { color: theme.text.primary }]}>
            Map
          </Text>
          <RadiusChip radiusKm={radiusKm} onPress={() => setPickerVisible(true)} />
        </Surface>

        {isOffline && (
          <Surface elevation={1} style={[styles.notice, { backgroundColor: theme.bg.raised }]}>
            <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
              Offline — pins show the last saved alerts; map tiles may be missing.
            </Text>
          </Surface>
        )}
        {!isOffline && nearby.length === 0 && (
          <Surface elevation={1} style={[styles.notice, { backgroundColor: theme.bg.raised }]}>
            <Text variant="bodyMedium" style={{ color: theme.text.secondary }}>
              All quiet within {radiusKm} km.
            </Text>
          </Surface>
        )}
      </View>

      <View style={styles.bottom} pointerEvents="box-none">
        <IconButton
          icon="crosshairs-gps"
          mode="contained"
          size={24}
          onPress={recenter}
          accessibilityLabel="Re-center map"
          containerColor={theme.bg.raised}
          iconColor={theme.text.primary}
          style={styles.recenter}
        />
        {selected && (
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    position: 'absolute',
    top: spacing.scale[2],
    left: spacing.screenGutter,
    right: spacing.screenGutter,
    gap: spacing.scale[2],
  },
  topBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingRight: spacing.scale[2],
  },
  title: {
    flex: 1,
  },
  notice: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingVertical: spacing.scale[1],
    paddingHorizontal: spacing.scale[3],
  },
  bottom: {
    position: 'absolute',
    left: spacing.screenGutter,
    right: spacing.screenGutter,
    bottom: spacing.screenGutter,
    gap: spacing.scale[2],
  },
  recenter: {
    alignSelf: 'flex-end',
    margin: 0,
  },
  sheet: {
    borderRadius: 20,
    padding: spacing.scale[2],
  },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.scale[1],
    paddingTop: spacing.scale[2],
  },
  tapTarget: {
    minHeight: spacing.minTapTarget,
  },
  you: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
  },
});
