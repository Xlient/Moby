import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Pressable,
  PanResponder,
  StyleSheet,
  type LayoutChangeEvent,
  type GestureResponderEvent,
} from 'react-native';
import { Text } from 'react-native-paper';
import Svg, { Defs, Pattern, Mask, Path, Rect, Circle } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import type { RadiusKm } from '@/hooks/useNearbyRadius';
import { useNearbyAlerts } from '@/hooks/useNearbyAlerts';
import { RadiusChip, RadiusPicker } from '@/components/RadiusPicker';
import { AlertCard } from '@/components/AlertCard';
import { USER_CENTER, latLonToXY, distanceKm } from '@/lib/geo';
import { typography, spacing, radius as radiusTokens } from '@/theme/tokens';
import type { Alert } from '@/api/types';
import { pinPath } from '@/lib/alerts';
import type { Theme } from '@/theme/tokens';

// A drawn map (no basemap tiles): pins at their true relative positions inside
// the radius circle, with pan/zoom and pin selection. Used on web (react-native-maps
// has no web build) and on phones when Google map tiles can't load — e.g. no
// signal, or Google unreachable.

// ── Constants ───────────────────────────────────────────────────────

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 8;
const INITIAL_ZOOM = 1;
/** Movement (px) before a touch becomes a drag instead of a tap. */
const DRAG_SLOP = 4;

interface DiagramMapScreenProps {
  onBack: () => void;
  onAlertDetail: (alertId: string) => void;
  /** Shown at the bottom when this is a fallback for the real map. */
  notice?: string;
}

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

function touchDistance(e: GestureResponderEvent): number | null {
  const t = e.nativeEvent.touches;
  if (t.length < 2) return null;
  const a = t[0]!;
  const b = t[1]!;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

// ── Sub-components ──────────────────────────────────────────────────

function TopBar({
  theme,
  radiusKm,
  onBack,
  onRadiusPress,
  onRecenter,
}: {
  theme: Theme;
  radiusKm: RadiusKm;
  onBack: () => void;
  onRadiusPress: () => void;
  onRecenter: () => void;
}) {
  const btn = [
    styles.roundBtn,
    { backgroundColor: theme.bg.raised, borderColor: theme.line.hairline },
  ];

  return (
    <View style={styles.topBar} pointerEvents="box-none">
      <Pressable style={btn} onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back">
        <Svg width={20} height={20} viewBox="0 0 20 20" fill="none">
          <Path
            d="M12 4L6 10L12 16"
            stroke={theme.text.primary}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>
      <RadiusChip radiusKm={radiusKm} onPress={onRadiusPress} />
      <Pressable
        style={btn}
        onPress={onRecenter}
        accessibilityRole="button"
        accessibilityLabel="Re-center map"
      >
        <Svg width={20} height={20} viewBox="0 0 20 20" fill="none">
          <Circle cx="10" cy="10" r="3" stroke={theme.text.primary} strokeWidth={1.5} />
          <Path
            d="M10 2v3M10 15v3M2 10h3M15 10h3"
            stroke={theme.text.primary}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        </Svg>
      </Pressable>
    </View>
  );
}

function BottomSheet({
  alert,
  theme,
  onViewDetails,
  onDismiss,
}: {
  alert: Alert;
  theme: Theme;
  onViewDetails: () => void;
  onDismiss: () => void;
}) {
  const dist = alert.location
    ? distanceKm(USER_CENTER.lat, USER_CENTER.lon, alert.location.lat, alert.location.lon)
    : undefined;

  return (
    <View style={styles.sheetOverlay}>
      <View
        style={[styles.sheet, { backgroundColor: theme.bg.base, borderColor: theme.line.hairline }]}
      >
        <AlertCard alert={alert} distanceKm={dist ? +dist.toFixed(1) : undefined} />
        <View style={styles.sheetActions}>
          <Pressable
            style={[
              styles.sheetBtn,
              { borderWidth: 1, borderColor: theme.line.hairline, backgroundColor: theme.bg.raised },
            ]}
            onPress={onDismiss}
            accessibilityRole="button"
          >
            <Text style={[typography.label, { color: theme.text.primary }]}>Dismiss</Text>
          </Pressable>
          <Pressable
            style={[styles.sheetBtn, { backgroundColor: theme.accent.calm }]}
            onPress={onViewDetails}
            accessibilityRole="button"
          >
            <Text style={[typography.label, { color: theme.bg.raised }]}>View details</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function EmptyMapMessage({ theme }: { theme: Theme }) {
  return (
    <View style={styles.centerOverlay} pointerEvents="none">
      <Svg width={48} height={48} viewBox="0 0 48 48" fill="none">
        <Circle cx="24" cy="24" r="20" stroke={theme.accent.calm} strokeWidth={2} opacity={0.5} />
        <Path
          d="M16 24l6 6 10-12"
          stroke={theme.accent.calm}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <Text style={[typography.heading, styles.emptyTitle, { color: theme.text.primary }]}>
        All clear nearby
      </Text>
      <Text style={[typography.body, styles.emptyBody, { color: theme.text.secondary }]}>
        No alerts in this area
      </Text>
    </View>
  );
}

function OfflineOverlay({ theme, text }: { theme: Theme; text: string }) {
  return (
    <View
      style={[
        styles.offlineBanner,
        { backgroundColor: theme.bg.raised, borderColor: theme.line.hairline },
      ]}
      accessibilityLiveRegion="polite"
    >
      <Text style={[typography.meta, styles.textCenter, { color: theme.text.secondary }]}>
        {text}
      </Text>
    </View>
  );
}

// ── Main component ──────────────────────────────────────────────────

export function DiagramMapScreen({ onBack, onAlertDetail, notice }: DiagramMapScreenProps) {
  const { theme } = useTheme();
  const isOnline = useOnlineStatus();
  // Same source as the home list, so pins always match it for the same radius.
  const { nearby, radiusKm: nearbyRadius, setRadiusKm: setNearbyRadius } = useNearbyAlerts();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(INITIAL_ZOOM);

  // Latest values for the gesture handlers (PanResponder is created once).
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  panRef.current = pan;
  zoomRef.current = zoom;
  const gesture = useRef<{
    startPan: { x: number; y: number };
    startZoom: number;
    pinchStartDist: number | null;
  }>({ startPan: { x: 0, y: 0 }, startZoom: INITIAL_ZOOM, pinchStartDist: null });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Let taps reach the pins; only claim the touch once it moves or pinches.
        onStartShouldSetPanResponder: (e) => e.nativeEvent.touches.length >= 2,
        onMoveShouldSetPanResponder: (e, g) =>
          e.nativeEvent.touches.length >= 2 ||
          Math.abs(g.dx) > DRAG_SLOP ||
          Math.abs(g.dy) > DRAG_SLOP,
        onPanResponderGrant: (e) => {
          gesture.current = {
            startPan: panRef.current,
            startZoom: zoomRef.current,
            pinchStartDist: touchDistance(e),
          };
        },
        onPanResponderMove: (e, g) => {
          const dist = touchDistance(e);
          if (dist !== null) {
            if (gesture.current.pinchStartDist === null) {
              // Second finger landed mid-drag: start the pinch from here.
              gesture.current.pinchStartDist = dist;
              gesture.current.startZoom = zoomRef.current;
            }
            setZoom(clampZoom(gesture.current.startZoom * (dist / gesture.current.pinchStartDist)));
            return;
          }
          setPan({
            x: gesture.current.startPan.x + g.dx,
            y: gesture.current.startPan.y + g.dy,
          });
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  );

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  }, []);

  const scaleFactor = useMemo(() => {
    const base = Math.max(nearbyRadius * 2.5, 20);
    return 300 / base;
  }, [nearbyRadius]);

  const alertsInRadius = useMemo(() => nearby.map((n) => n.alert), [nearby]);

  const selectedAlert = selectedId
    ? alertsInRadius.find((a) => a.alert_id === selectedId) ?? null
    : null;

  useEffect(() => {
    if (selectedId && !selectedAlert) setSelectedId(null);
  }, [selectedId, selectedAlert]);

  const recenter = useCallback(() => {
    setPan({ x: 0, y: 0 });
    setZoom(INITIAL_ZOOM);
    setSelectedId(null);
  }, []);

  const radiusPixels = nearbyRadius * scaleFactor * zoom;
  const gridSpacing = 20 * scaleFactor * zoom;
  const cx = size.width / 2 + pan.x;
  const cy = size.height / 2 + pan.y;
  const mod = (n: number, m: number) => ((n % m) + m) % m;

  return (
    <View style={styles.flex}>
      <View
        style={[styles.flex, styles.mapArea, { backgroundColor: theme.bg.recessed }]}
        onLayout={handleLayout}
        accessibilityLabel="Alert map"
        {...panResponder.panHandlers}
      >
        {size.width > 0 && (
          <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill}>
            <Defs>
              <Pattern
                id="grid"
                width={gridSpacing}
                height={gridSpacing}
                patternUnits="userSpaceOnUse"
                x={mod(cx, gridSpacing)}
                y={mod(cy, gridSpacing)}
              >
                <Path
                  d={`M ${gridSpacing} 0 L 0 0 0 ${gridSpacing}`}
                  fill="none"
                  stroke={theme.line.hairline}
                  strokeWidth={0.5}
                  opacity={0.5}
                />
              </Pattern>
              <Mask id="radius-mask" x={0} y={0} width={size.width} height={size.height}>
                <Rect width={size.width} height={size.height} fill="white" />
                <Circle cx={cx} cy={cy} r={radiusPixels} fill="black" />
              </Mask>
            </Defs>

            <Rect width={size.width} height={size.height} fill="url(#grid)" />

            <Circle
              cx={cx}
              cy={cy}
              r={radiusPixels}
              fill="none"
              stroke={theme.accent.calm}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              opacity={0.6}
            />

            <Rect
              width={size.width}
              height={size.height}
              fill={theme.bg.base}
              opacity={0.35}
              mask="url(#radius-mask)"
            />

            {/* Center dot */}
            <Circle cx={cx} cy={cy} r={4} fill={theme.accent.calm} />
            <Circle cx={cx} cy={cy} r={8} fill={theme.accent.calm} opacity={0.2} />
          </Svg>
        )}

        {/* Pins layer */}
        {size.width > 0 &&
          alertsInRadius.map((alert) => {
            if (!alert.location) return null;
            const pos = latLonToXY(alert.location.lat, alert.location.lon, USER_CENTER);
            const px = cx + pos.x * scaleFactor * zoom;
            const py = cy + pos.y * scaleFactor * zoom;
            const isUnverified = alert.verification_label === 'unverified_report';
            const color = isUnverified ? theme.text.faint : theme.severity[alert.severity];
            const isSelected = selectedId === alert.alert_id;
            const pinSize = isSelected ? 32 : 24;
            const touchSize = Math.max(pinSize, 40);

            return (
              <Pressable
                key={alert.alert_id}
                style={[
                  styles.pin,
                  {
                    left: px - touchSize / 2,
                    top: py - touchSize / 2,
                    width: touchSize,
                    height: touchSize,
                    zIndex: isSelected ? 3 : 1,
                    transform: [{ scale: isSelected ? 1.2 : 1 }],
                  },
                ]}
                onPress={() => setSelectedId(isSelected ? null : alert.alert_id)}
                accessibilityRole="button"
                accessibilityLabel={`${alert.headline}, ${alert.severity} severity`}
              >
                <Svg width={pinSize} height={pinSize} viewBox="0 0 24 24">
                  <Path
                    d={pinPath(alert.severity)}
                    stroke={color}
                    strokeWidth={isUnverified ? 1.5 : 2}
                    strokeLinejoin="round"
                    fill={isUnverified ? 'none' : color}
                    fillOpacity={isUnverified ? 0 : 0.25}
                  />
                </Svg>
              </Pressable>
            );
          })}
      </View>

      <TopBar
        theme={theme}
        radiusKm={nearbyRadius}
        onBack={onBack}
        onRadiusPress={() => setPickerVisible(true)}
        onRecenter={recenter}
      />

      {alertsInRadius.length === 0 && !selectedAlert && <EmptyMapMessage theme={theme} />}

      {(notice || !isOnline) && !selectedAlert && (
        <OfflineOverlay theme={theme} text={notice ?? 'Offline — showing last known positions'} />
      )}

      {selectedAlert && (
        <BottomSheet
          alert={selectedAlert}
          theme={theme}
          onViewDetails={() => onAlertDetail(selectedAlert.alert_id)}
          onDismiss={() => setSelectedId(null)}
        />
      )}

      {pickerVisible && (
        <RadiusPicker
          visible
          selected={nearbyRadius}
          onSelect={(v) => {
            setNearbyRadius(v);
            setPickerVisible(false);
          }}
          onDismiss={() => setPickerVisible(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  mapArea: {
    overflow: 'hidden',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.scale[2],
    paddingHorizontal: spacing.screenGutter,
    zIndex: 10,
  },
  roundBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
  },
  pin: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    paddingHorizontal: spacing.screenGutter,
    paddingBottom: spacing.screenGutter,
  },
  sheet: {
    borderRadius: radiusTokens.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sheetActions: {
    flexDirection: 'row',
    gap: spacing.scale[2],
    paddingHorizontal: spacing.scale[3],
    paddingBottom: spacing.scale[3],
  },
  sheetBtn: {
    flex: 1,
    minHeight: spacing.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radiusTokens.input,
  },
  centerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  emptyTitle: {
    marginTop: spacing.scale[2],
    textAlign: 'center',
  },
  emptyBody: {
    marginTop: spacing.scale[1],
    textAlign: 'center',
  },
  offlineBanner: {
    position: 'absolute',
    bottom: spacing.screenGutter,
    left: spacing.screenGutter,
    right: spacing.screenGutter,
    paddingVertical: spacing.scale[2],
    paddingHorizontal: spacing.scale[3],
    borderRadius: radiusTokens.card,
    borderWidth: 1,
    zIndex: 15,
  },
  textCenter: {
    textAlign: 'center',
  },
});
