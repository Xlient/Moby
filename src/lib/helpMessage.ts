// "I need help": the location message a person sends from the Help screen.
//
// Plain text, so it works over SMS with no data connection. Coordinates are written
// out in full (rescuers read them aloud and type them in); the map link is a
// convenience for whoever receives it with data.

export interface HelpFix {
  lat: number;
  lon: number;
  accuracyM: number | null;
  /** ISO time of the GPS fix. */
  at: string;
}

/** 37.77490, -122.41940 — five decimals is about 1 m, more than GPS gives. */
export function formatCoords(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/** "±12 m", or null when the phone didn't say. */
export function formatAccuracy(accuracyM: number | null): string | null {
  if (accuracyM === null || !Number.isFinite(accuracyM)) return null;
  return accuracyM < 1000 ? `±${Math.round(accuracyM)} m` : `±${(accuracyM / 1000).toFixed(1)} km`;
}

/** "14:05 UTC" — UTC so the time means the same thing to whoever reads it, anywhere. */
export function formatUtcTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

export function helpMessage(fix: HelpFix): string {
  const coords = formatCoords(fix.lat, fix.lon);
  const accuracy = formatAccuracy(fix.accuracyM);
  return [
    'I need help.',
    `My location: ${coords}${accuracy ? ` (${accuracy})` : ''} at ${formatUtcTime(fix.at)}.`,
    `Map: https://www.openstreetmap.org/?mlat=${fix.lat.toFixed(5)}&mlon=${fix.lon.toFixed(5)}#map=17/${fix.lat.toFixed(5)}/${fix.lon.toFixed(5)}`,
    'Sent from Moby.',
  ].join('\n');
}
