import type { MapStyleElement } from 'react-native-maps';

// Google's default map is saturated; the design system reserves saturation for
// hazard severity (§2, §3). These styles mute the basemap so severity pins are
// the loudest thing on screen. POIs and transit are hidden to reduce noise.

const quiet: MapStyleElement[] = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];

export const mapStyleLight: MapStyleElement[] = [
  { stylers: [{ saturation: -85 }, { lightness: 8 }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d6e0e2' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#eff1ee' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#5f6e73' }] },
  ...quiet,
];

export const mapStyleDark: MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: '#1c2224' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9ba8ab' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#181d1f' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#121618' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2e3638' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2e3638' }] },
  ...quiet,
];
