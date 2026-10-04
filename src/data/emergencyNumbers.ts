/**
 * Emergency numbers per country (issue #12). Bundled, so they work offline.
 *
 * Every entry is copied from the UK Foreign, Commonwealth & Development Office's
 * official "Getting help" travel advice for that country (gov.uk), checked on CHECKED.
 * Change an entry only after re-reading that page, and update CHECKED.
 */
export const EMERGENCY_CHECKED = '2026-10-04';

export interface EmergencyNumbers {
  /** ISO 3166-1 alpha-2 */
  country: string;
  name: string;
  /** One number for ambulance, fire and police, when the country has one. */
  general?: string;
  ambulance?: string;
  fire?: string;
  police?: string;
  touristPolice?: string;
  note?: string;
  source: string;
}

const fcdo = (slug: string) => `https://www.gov.uk/foreign-travel-advice/${slug}/getting-help`;

export const EMERGENCY_NUMBERS: Record<string, EmergencyNumbers> = {
  US: { country: 'US', name: 'United States', general: '911', source: fcdo('usa') },
  JP: { country: 'JP', name: 'Japan', ambulance: '119', fire: '119', police: '110', source: fcdo('japan') },
  ID: { country: 'ID', name: 'Indonesia', ambulance: '118', fire: '112', police: '110', source: fcdo('indonesia') },
  PH: { country: 'PH', name: 'the Philippines', general: '911', source: fcdo('philippines') },
  MX: { country: 'MX', name: 'Mexico', general: '911', source: fcdo('mexico') },
  IT: { country: 'IT', name: 'Italy', ambulance: '118', fire: '115', police: '112', source: fcdo('italy') },
  GR: { country: 'GR', name: 'Greece', general: '112', source: fcdo('greece') },
  IS: { country: 'IS', name: 'Iceland', general: '112', source: fcdo('iceland') },
  NZ: { country: 'NZ', name: 'New Zealand', general: '111', source: fcdo('new-zealand') },
  NP: {
    country: 'NP', name: 'Nepal', ambulance: '102', fire: '101', police: '100', touristPolice: '1144',
    source: fcdo('nepal'),
  },
  ES: { country: 'ES', name: 'Spain', general: '112', source: fcdo('spain') },
  PT: { country: 'PT', name: 'Portugal', general: '112', source: fcdo('portugal') },
  IN: { country: 'IN', name: 'India', general: '112', source: fcdo('india') },
  JM: { country: 'JM', name: 'Jamaica', ambulance: '110', fire: '110', police: '119', source: fcdo('jamaica') },
  HK: { country: 'HK', name: 'Hong Kong', general: '999', source: fcdo('hong-kong') },
  TH: {
    country: 'TH', name: 'Thailand', general: '191', ambulance: '1669', fire: '199', police: '191',
    touristPolice: '1155', source: fcdo('thailand'),
  },
  VN: {
    country: 'VN', name: 'Vietnam', ambulance: '115', fire: '114', police: '113',
    note: 'Operated in Vietnamese only.', source: fcdo('vietnam'),
  },
};

export function emergencyFor(country: string | undefined | null): EmergencyNumbers | undefined {
  return country ? EMERGENCY_NUMBERS[country.toUpperCase()] : undefined;
}

/**
 * Rough country for a position, offline: bounding boxes, smallest first so a small
 * country inside a neighbour's box wins (Nepal before India, Hong Kong before…).
 * Imprecise near borders, so the UI always names the country it picked.
 */
const BOXES: [string, [number, number, number, number]][] = [
  // [lon_min, lat_min, lon_max, lat_max]
  ['HK', [113.8, 22.15, 114.45, 22.57]],
  ['JM', [-78.4, 17.7, -76.2, 18.6]],
  ['IS', [-24.6, 63.2, -13.4, 66.6]],
  ['PT', [-9.6, 36.9, -6.2, 42.2]],
  ['GR', [19.3, 34.7, 29.7, 41.8]],
  ['NP', [80.05, 26.35, 88.2, 30.45]],
  ['NZ', [166.0, -47.4, 178.7, -34.3]],
  ['IT', [6.6, 35.4, 18.6, 47.1]],
  ['ES', [-18.2, 27.6, 4.4, 43.8]],
  ['PH', [116.9, 4.5, 126.7, 21.2]],
  ['VN', [102.1, 8.4, 109.5, 23.4]],
  ['TH', [97.3, 5.6, 105.7, 20.5]],
  ['JP', [122.9, 24.0, 146.0, 45.6]],
  ['MX', [-118.4, 14.5, -86.7, 32.7]],
  ['IN', [68.1, 6.7, 97.4, 35.5]],
  ['ID', [95.0, -11.0, 141.0, 6.1]],
  ['US', [-125.0, 24.0, -66.5, 49.5]],
  ['US', [-180.0, 51.0, -129.0, 71.5]],
  ['US', [-160.5, 18.5, -154.5, 22.5]],
];

export function countryAt(lat: number, lon: number): string | undefined {
  for (const [code, [x0, y0, x1, y1]] of BOXES) {
    if (lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1) return code;
  }
  return undefined;
}
