import outlinesFile from './countryOutlines.json';

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
  CN: { country: 'CN', name: 'China', ambulance: '120', fire: '119', police: '110', source: fcdo('china') },
  MO: { country: 'MO', name: 'Macao', general: '999', source: fcdo('macao') },
  TW: { country: 'TW', name: 'Taiwan', ambulance: '119', fire: '119', police: '110', source: fcdo('taiwan') },
};

export function emergencyFor(country: string | undefined | null): EmergencyNumbers | undefined {
  return country ? EMERGENCY_NUMBERS[country.toUpperCase()] : undefined;
}

/**
 * Country for a position, offline: simplified country outlines (Natural Earth,
 * public domain) for the countries above, plus small boxes for Hong Kong and Macao,
 * which are too small for the outlines and are checked first. Approximate near
 * borders (~10 km), so the UI always names the country it picked.
 */
const OUTLINES: Record<string, number[][][]> = outlinesFile.outlines;

const SMALL: [string, [number, number, number, number]][] = [
  // [lon_min, lat_min, lon_max, lat_max]
  ['HK', [113.82, 22.15, 114.44, 22.57]],
  ['MO', [113.52, 22.1, 113.61, 22.22]],
];

function inRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi = 0, yi = 0] = ring[i]!;
    const [xj = 0, yj = 0] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function countryAt(lat: number, lon: number): string | undefined {
  for (const [code, [x0, y0, x1, y1]] of SMALL) {
    if (lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1) return code;
  }
  const hit = (y: number, x: number) =>
    Object.entries(OUTLINES).find(([, rings]) => rings.some((ring) => inRing(x, y, ring)))?.[0];
  // Simplified coastlines cut corners, so coastal cities can fall just outside:
  // look ~15 km around before giving up.
  const d = 0.15;
  for (const [dy, dx] of [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d], [d, d], [d, -d], [-d, d], [-d, -d]]) {
    const code = hit(lat + dy!, lon + dx!);
    if (code) return code;
  }
  return undefined;
}
