import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useNearbyRadius, type RadiusKm } from '@/hooks/useNearbyRadius';
import { RadiusChip, RadiusPicker } from '@/components/RadiusPicker';
import { AlertCard } from '@/components/AlertCard';
import { mockAlerts } from '@/api/fixtures';
import { typography, spacing, radius as radiusTokens } from '@/theme/tokens';
import type { Alert, Severity } from '@/api/types';
import type { Theme } from '@/theme/tokens';

// ── Coordinate projection ───────────────────────────────────────────

export const USER_CENTER = { lat: 37.7749, lon: -122.4194 };
const KM_PER_DEG_LAT = 111.32;

function kmPerDegLon(lat: number): number {
  return 111.32 * Math.cos((lat * Math.PI) / 180);
}

function latLonToXY(
  lat: number,
  lon: number,
  center: { lat: number; lon: number },
): { x: number; y: number } {
  const x = (lon - center.lon) * kmPerDegLon(center.lat);
  const y = -(lat - center.lat) * KM_PER_DEG_LAT;
  return { x, y };
}

export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dy = (lat2 - lat1) * KM_PER_DEG_LAT;
  const dx = (lon2 - lon1) * kmPerDegLon((lat1 + lat2) / 2);
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Pin shapes (SVG paths at 24x24 viewBox) ────────────────────────

function pinPath(severity: Severity): string {
  switch (severity) {
    case 'critical':
      return 'M12 2L22 12L12 22L2 12Z';
    case 'high':
      return 'M3 3h18v18H3z';
    case 'medium':
      return 'M12 3L2 21h20Z';
    case 'low':
      return 'M12 21a9 9 0 110-18 9 9 0 010 18z';
  }
}

// ── Constants ───────────────────────────────────────────────────────

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 8;
const INITIAL_ZOOM = 1;

interface MapScreenProps {
  onBack: () => void;
  onAlertDetail: (alertId: string) => void;
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
  const s: Record<string, CSSProperties> = {
    bar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: `${spacing.scale[2]}px ${spacing.screenGutter}px`,
      zIndex: 10,
      pointerEvents: 'none',
    },
    btn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.bg.raised,
      border: `1px solid ${theme.line.hairline}`,
      cursor: 'pointer',
      pointerEvents: 'auto',
    },
    center: {
      display: 'flex',
      gap: spacing.scale[1],
      pointerEvents: 'auto',
    },
  };

  return (
    <div style={s.bar}>
      <button
        style={s.btn}
        onClick={onBack}
        aria-label="Go back"
      >
        <svg width={20} height={20} viewBox="0 0 20 20" fill="none">
          <path
            d="M12 4L6 10L12 16"
            stroke={theme.text.primary}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div style={s.center}>
        <RadiusChip radiusKm={radiusKm} onPress={onRadiusPress} />
      </div>
      <button
        style={s.btn}
        onClick={onRecenter}
        aria-label="Re-center map"
      >
        <svg width={20} height={20} viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="3" stroke={theme.text.primary} strokeWidth="1.5" />
          <path
            d="M10 2v3M10 15v3M2 10h3M15 10h3"
            stroke={theme.text.primary}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
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

  const s: Record<string, CSSProperties> = {
    overlay: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 20,
      padding: `0 ${spacing.screenGutter}px ${spacing.screenGutter}px`,
    },
    sheet: {
      backgroundColor: theme.bg.base,
      borderRadius: radiusTokens.card,
      border: `1px solid ${theme.line.hairline}`,
      overflow: 'hidden',
    },
    actions: {
      display: 'flex',
      gap: spacing.scale[2],
      padding: `0 ${spacing.scale[3]}px ${spacing.scale[3]}px`,
    },
    btn: {
      flex: 1,
      minHeight: spacing.minTapTarget,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radiusTokens.input,
      border: `1px solid ${theme.line.hairline}`,
      backgroundColor: theme.bg.raised,
      cursor: 'pointer',
      ...typography.label,
      color: theme.text.primary,
      fontVariantNumeric: undefined as unknown as string,
    },
    btnPrimary: {
      flex: 1,
      minHeight: spacing.minTapTarget,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radiusTokens.input,
      border: 'none',
      backgroundColor: theme.accent.calm,
      cursor: 'pointer',
      ...typography.label,
      color: theme.bg.raised,
      fontVariantNumeric: undefined as unknown as string,
    },
  };

  return (
    <div style={s.overlay}>
      <div style={s.sheet}>
        <AlertCard alert={alert} distanceKm={dist ? +dist.toFixed(1) : undefined} />
        <div style={s.actions}>
          <button style={s.btn} onClick={onDismiss}>
            Dismiss
          </button>
          <button style={s.btnPrimary} onClick={onViewDetails}>
            View details
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyMapMessage({ theme }: { theme: Theme }) {
  const s: Record<string, CSSProperties> = {
    container: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      textAlign: 'center',
      pointerEvents: 'none',
      zIndex: 5,
    },
  };

  return (
    <div style={s.container}>
      <svg width={48} height={48} viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <circle cx="24" cy="24" r="20" stroke={theme.accent.calm} strokeWidth="2" opacity={0.5} />
        <path
          d="M16 24l6 6 10-12"
          stroke={theme.accent.calm}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p style={{ ...typography.heading, color: theme.text.primary, margin: `${spacing.scale[2]}px 0 0`, fontVariantNumeric: undefined as unknown as string }}>
        All clear nearby
      </p>
      <p style={{ ...typography.body, color: theme.text.secondary, margin: `${spacing.scale[1]}px 0 0`, fontVariantNumeric: undefined as unknown as string }}>
        No alerts in this area
      </p>
    </div>
  );
}

function OfflineOverlay({ theme }: { theme: Theme }) {
  const s: Record<string, CSSProperties> = {
    banner: {
      position: 'absolute',
      bottom: spacing.screenGutter,
      left: spacing.screenGutter,
      right: spacing.screenGutter,
      padding: `${spacing.scale[2]}px ${spacing.scale[3]}px`,
      backgroundColor: theme.bg.raised,
      borderRadius: radiusTokens.card,
      border: `1px solid ${theme.line.hairline}`,
      textAlign: 'center',
      zIndex: 15,
    },
  };

  return (
    <div style={s.banner} role="status">
      <p style={{ ...typography.meta, color: theme.text.secondary, margin: 0, fontVariantNumeric: undefined as unknown as string }}>
        Offline — showing last known positions
      </p>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────

export function MapScreen({ onBack, onAlertDetail }: MapScreenProps) {
  const { theme } = useTheme();
  const isOnline = useOnlineStatus();
  const [nearbyRadius, setNearbyRadius] = useNearbyRadius();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const scaleFactor = useMemo(() => {
    const base = Math.max(nearbyRadius * 2.5, 20);
    return 300 / base;
  }, [nearbyRadius]);

  const alertsInRadius = useMemo(
    () =>
      mockAlerts.filter((a) => {
        if (!a.location) return false;
        const d = distanceKm(USER_CENTER.lat, USER_CENTER.lon, a.location.lat, a.location.lon);
        return d <= nearbyRadius;
      }),
    [nearbyRadius],
  );

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

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    },
    [pan],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
    },
    [],
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)));
    },
    [],
  );

  const radiusPixels = nearbyRadius * scaleFactor * zoom;

  const containerStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    backgroundColor: theme.bg.recessed,
    overflow: 'hidden',
    touchAction: 'none',
    cursor: dragRef.current ? 'grabbing' : 'grab',
  };

  const gridColor = theme.line.hairline;
  const gridSpacing = 20 * scaleFactor * zoom;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        style={containerStyle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        role="application"
        aria-label="Alert map"
      >
        <svg
          width="100%"
          height="100%"
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <defs>
            <pattern
              id="grid"
              width={gridSpacing}
              height={gridSpacing}
              patternUnits="userSpaceOnUse"
              x={pan.x % gridSpacing}
              y={pan.y % gridSpacing}
            >
              <path
                d={`M ${gridSpacing} 0 L 0 0 0 ${gridSpacing}`}
                fill="none"
                stroke={gridColor}
                strokeWidth="0.5"
                opacity="0.5"
              />
            </pattern>
            <mask id="radius-mask">
              <rect width="100%" height="100%" fill="white" />
              <circle
                cx="50%"
                cy="50%"
                r={radiusPixels}
                fill="black"
                transform={`translate(${pan.x}, ${pan.y})`}
              />
            </mask>
          </defs>

          <rect width="100%" height="100%" fill="url(#grid)" />

          <circle
            cx="50%"
            cy="50%"
            r={radiusPixels}
            fill="none"
            stroke={theme.accent.calm}
            strokeWidth="1.5"
            strokeDasharray="6 4"
            opacity="0.6"
            transform={`translate(${pan.x}, ${pan.y})`}
          />

          <rect
            width="100%"
            height="100%"
            fill={theme.bg.base}
            opacity="0.35"
            mask="url(#radius-mask)"
            style={{ pointerEvents: 'none' }}
          />

          {/* Center dot */}
          <circle
            cx="50%"
            cy="50%"
            r={4}
            fill={theme.accent.calm}
            transform={`translate(${pan.x}, ${pan.y})`}
          />
          <circle
            cx="50%"
            cy="50%"
            r={8}
            fill={theme.accent.calm}
            opacity="0.2"
            transform={`translate(${pan.x}, ${pan.y})`}
          />
        </svg>

        {/* Pins layer */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: `translate(${pan.x}px, ${pan.y}px)`,
            pointerEvents: 'none',
          }}
        >
          {alertsInRadius.map((alert) => {
            if (!alert.location) return null;
            const pos = latLonToXY(alert.location.lat, alert.location.lon, USER_CENTER);
            const px = pos.x * scaleFactor * zoom;
            const py = pos.y * scaleFactor * zoom;
            const isUnverified = alert.verification_label === 'unverified_report';
            const color = isUnverified ? theme.text.faint : theme.severity[alert.severity];
            const isSelected = selectedId === alert.alert_id;
            const pinSize = isSelected ? 32 : 24;

            return (
              <button
                key={alert.alert_id}
                style={{
                  position: 'absolute',
                  left: px - pinSize / 2,
                  top: py - pinSize / 2,
                  width: pinSize,
                  height: pinSize,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  pointerEvents: 'auto',
                  transition: 'transform 0.15s ease',
                  transform: isSelected ? 'scale(1.2)' : 'scale(1)',
                  zIndex: isSelected ? 3 : 1,
                  filter: isSelected
                    ? `drop-shadow(0 2px 4px ${color}66)`
                    : undefined,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(isSelected ? null : alert.alert_id);
                }}
                aria-label={`${alert.headline}, ${alert.severity} severity`}
              >
                <svg
                  width={pinSize}
                  height={pinSize}
                  viewBox="0 0 24 24"
                  fill={isUnverified ? 'none' : color}
                  fillOpacity={isUnverified ? 0 : 0.25}
                >
                  <path
                    d={pinPath(alert.severity)}
                    stroke={color}
                    strokeWidth={isUnverified ? '1.5' : '2'}
                    strokeLinejoin="round"
                    fill={isUnverified ? 'none' : color}
                    fillOpacity={isUnverified ? 0 : 0.25}
                  />
                </svg>
              </button>
            );
          })}
        </div>
      </div>

      <TopBar
        theme={theme}
        radiusKm={nearbyRadius}
        onBack={onBack}
        onRadiusPress={() => setPickerVisible(true)}
        onRecenter={recenter}
      />

      {alertsInRadius.length === 0 && !selectedAlert && (
        <EmptyMapMessage theme={theme} />
      )}

      {!isOnline && !selectedAlert && (
        <OfflineOverlay theme={theme} />
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
    </div>
  );
}
