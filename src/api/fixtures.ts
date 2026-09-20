import type {
  Alert,
  ClientConfig,
  SituationalBrief,
  GuidanceCard,
  Subscription,
  BriefPending,
} from './types';

// ── Helpers: relative dates ──────────────────────────────────────────

/** Returns an ISO 8601 string for `minutesAgo` minutes before now. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** Returns an ISO 8601 string for `daysAgo` days before now. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// ── Mock config ──────────────────────────────────────────────────────

export const mockConfig: ClientConfig = {
  min_supported_client: '1.0.0',
  flags: {
    situational_brief: true,
    cascade_analysis: true,
    offline_guidance_cards: true,
    on_device_assistant: true,
    mesh_relay: true,
    proximity_confirmation: true,
    early_tier_opt_in: true,
  },
};

// ── Mock alerts ──────────────────────────────────────────────────────

export const mockAlerts: Alert[] = [
  {
    alert_id: 'alert-001',
    event_id: 'event-001',
    headline: 'Flash Flood Warning — Russian River Basin',
    body: 'Move to higher ground immediately. Flash flood warning in effect for low-lying areas along the Russian River.',
    severity: 'critical',
    location: { lat: 37.7749, lon: -122.4194, accuracy_m: 500, frame: 'WGS84' },
    affected_radius_km: 25,
    issued_at: minutesAgo(14),
    expires_at: new Date(Date.now() + 6 * 3_600_000).toISOString(), // +6 h
    verification_label: 'official_confirmed',
    source_attribution: 'National Weather Service',
  },
  {
    alert_id: 'alert-002',
    event_id: 'event-002',
    headline: 'Severe Thunderstorm Watch — Central Valley',
    body: 'Damaging winds up to 70 mph and quarter-sized hail expected. Seek sturdy shelter and stay away from windows.',
    severity: 'high',
    location: { lat: 38.5816, lon: -121.4944, accuracy_m: 2000, frame: 'WGS84' },
    affected_radius_km: 80,
    issued_at: minutesAgo(45),
    expires_at: new Date(Date.now() + 4 * 3_600_000).toISOString(),
    verification_label: 'official_confirmed',
    source_attribution: 'NOAA Storm Prediction Center',
  },
  {
    alert_id: 'alert-003',
    event_id: 'event-003',
    headline: 'Landslide Reported — Highway 1 near Pacifica',
    body: 'Multiple community reports of debris flow blocking both lanes of Highway 1 south of Pacifica. Avoid the area and use alternate routes.',
    severity: 'medium',
    location: { lat: 37.6138, lon: -122.4869, accuracy_m: 150, frame: 'WGS84' },
    affected_radius_km: 5,
    issued_at: minutesAgo(120),
    verification_label: 'corroborated_report',
    source_attribution: 'Community reports',
  },
  {
    alert_id: 'alert-004',
    event_id: 'event-004',
    headline: 'Unverified: Sinkhole on Geary Blvd',
    body: 'Single report of a possible sinkhole forming near the intersection of Geary Blvd and 25th Ave. Not yet corroborated.',
    severity: 'low',
    location: { lat: 37.7812, lon: -122.4862, accuracy_m: 30, frame: 'WGS84' },
    affected_radius_km: 0.5,
    issued_at: minutesAgo(30),
    verification_label: 'unverified_report',
    source_attribution: 'Single report',
  },
];

// ── Mock situational brief (ready) ──────────────────────────────────

export const mockBriefReady: SituationalBrief = {
  event_id: 'event-001',
  generated_at: minutesAgo(10),
  model: 'nemotron-3-ultra',
  summary:
    'Persistent atmospheric-river rainfall over the past 72 hours has pushed the Russian River above its 18-foot flood stage at Guerneville. ' +
    'Rapid runoff from saturated hillsides is funneling into the lower basin, where water levels are rising at approximately 0.8 feet per hour. ' +
    'Low-lying areas from Forestville to Jenner are experiencing street-level flooding, and several evacuation orders are in effect.',
  likely_progression:
    'Rain is forecast to continue for another 12–18 hours with an additional 2–4 inches expected. ' +
    'The river may crest near 32 feet by early tomorrow morning before gradually receding over the following 48 hours. ' +
    'Secondary flooding in tributaries (Austin Creek, Dry Creek) is possible as hillside saturation continues.',
  uncertainty:
    'Exact crest height depends on rainfall intensity overnight, which models currently disagree on by ±1.5 inches. ' +
    'Levee integrity near Guerneville has not been independently assessed since 2021 and could change the inundation footprint. ' +
    'This brief is an AI-generated estimate, not an official forecast.',
  exposed_areas: [
    {
      description: 'Downtown Guerneville and River Road corridor',
      location: { lat: 38.5021, lon: -122.9949, accuracy_m: 1000, frame: 'WGS84' },
      rationale: 'Historically the lowest-elevation zone in the basin; first to flood and last to drain.',
    },
    {
      description: 'Monte Rio and Villa Grande',
      location: { lat: 38.4658, lon: -123.0103, accuracy_m: 1500, frame: 'WGS84' },
      rationale: 'Narrow canyon concentrates flow; roads cut off when river exceeds 28 feet.',
    },
    {
      description: 'Jenner estuary and coastal bluffs',
      location: { lat: 38.4503, lon: -123.1086, accuracy_m: 2000, frame: 'WGS84' },
      rationale: 'Sediment-choked river mouth may cause backwater flooding combined with high tide at 06:12 PST.',
    },
  ],
  official_guidance:
    'The National Weather Service has issued a Flash Flood Warning (VTEC #0047) effective through 06:00 PST tomorrow. ' +
    'Sonoma County Office of Emergency Services advises immediate evacuation for Zone A (Guerneville floodplain). ' +
    'Do not drive through flooded roads — turn around, don\'t drown.',
  sources: [
    'NWS Sacramento — Flash Flood Warning VTEC #0047',
    'USGS Russian River at Guerneville gauge (11467000)',
    'Sonoma County OES Evacuation Order 2024-FLD-003',
    'NOAA CNRFC quantitative precipitation forecast',
  ],
};

// ── Mock situational brief (pending) ─────────────────────────────────

export const mockBriefPending: BriefPending = {
  status: 'pending',
  retry_after_seconds: 15,
};

// ── Mock guidance cards ──────────────────────────────────────────────

export const mockGuidanceCards: GuidanceCard[] = [
  {
    card_id: 'card-flood-001',
    hazard_type: 'flood',
    applies_when: 'flash_flood_warning',
    title: 'Flash Flood Safety: What To Do Right Now',
    body:
      '1. Move to higher ground immediately — do not wait for official orders if you see rising water.\n' +
      '2. Avoid walking or driving through flood waters. Six inches of moving water can knock you down; one foot can sweep away a vehicle.\n' +
      '3. If trapped in a building, go to the highest floor. Do not climb into a closed attic — you may become trapped by rising water.\n' +
      '4. Disconnect electrical appliances and do not touch electrical equipment if you are wet or standing in water.\n' +
      '5. After the flood, avoid floodwater — it may be contaminated with sewage, chemicals, or debris.',
    priority: 1,
    source_name: 'FEMA',
    source_url: 'https://www.ready.gov/floods',
    last_reviewed_at: daysAgo(12),
    is_critical_fallback: true,
  },
  {
    card_id: 'card-earthquake-001',
    hazard_type: 'earthquake',
    applies_when: 'ground_shaking_detected',
    title: 'Earthquake: Drop, Cover, and Hold On',
    body:
      '1. DROP to your hands and knees to prevent being knocked down.\n' +
      '2. Take COVER under a sturdy desk or table. If no shelter is nearby, cover your head and neck with your arms.\n' +
      '3. HOLD ON until the shaking stops. Be prepared for aftershocks.\n' +
      '4. If outdoors, move to a clear area away from buildings, power lines, and trees.\n' +
      '5. If driving, pull over to a clear spot, stop, and stay in the vehicle with your seatbelt fastened.\n' +
      '6. After shaking stops, check for injuries and damage. Do not use elevators.',
    priority: 1,
    source_name: 'American Red Cross',
    source_url: 'https://www.redcross.org/get-help/how-to-prepare-for-emergencies/types-of-emergencies/earthquake.html',
    last_reviewed_at: daysAgo(30),
    is_critical_fallback: true,
  },
  {
    card_id: 'card-storm-001',
    hazard_type: 'storm',
    applies_when: 'severe_thunderstorm_watch',
    title: 'Severe Thunderstorm Safety',
    body:
      '1. Move indoors to a sturdy building. Avoid sheds, isolated trees, and open fields.\n' +
      '2. Stay away from windows, skylights, and glass doors.\n' +
      '3. Unplug sensitive electronics — power surges from lightning can cause fires or damage equipment.\n' +
      '4. If caught outdoors, crouch low with feet together and head tucked. Minimize contact with the ground.\n' +
      '5. Wait at least 30 minutes after the last clap of thunder before going back outside.\n' +
      '6. Watch for flooding in low-lying areas — thunderstorms can produce heavy rainfall in short periods.',
    priority: 2,
    source_name: 'National Weather Service',
    source_url: 'https://www.weather.gov/safety/thunderstorm',
    last_reviewed_at: daysAgo(18),
    is_critical_fallback: false,
  },
];

// ── Mock subscriptions ───────────────────────────────────────────────

export const mockSubscriptions: Subscription[] = [
  {
    subscription_id: 'sub-001',
    region: 'US',
    label: 'Home — San Francisco',
    center: { lat: 37.7749, lon: -122.4194, frame: 'WGS84' },
    radius_km: 30,
    min_severity: 'medium',
  },
  {
    subscription_id: 'sub-002',
    region: 'US',
    label: 'Work — Sacramento',
    center: { lat: 38.5816, lon: -121.4944, frame: 'WGS84' },
    radius_km: 15,
    min_severity: 'high',
  },
];

// ── Helper functions ─────────────────────────────────────────────────

/** Return all mock alerts (fresh timestamps on every call). */
export function getMockAlerts(): Alert[] {
  return mockAlerts;
}

/** Return a single alert by its alert_id, or undefined. */
export function getMockAlert(alertId: string): Alert | undefined {
  return mockAlerts.find((a) => a.alert_id === alertId);
}

/** Return the mock client config. */
export function getMockConfig(): ClientConfig {
  return mockConfig;
}

/**
 * Return a mock brief.
 * - event-001 → ready brief
 * - anything else → pending (simulates generation in flight)
 */
export function getMockBrief(eventId: string): SituationalBrief | BriefPending {
  if (eventId === 'event-001') {
    return mockBriefReady;
  }
  return mockBriefPending;
}

/** Return all mock guidance cards. */
export function getMockGuidanceCards(): GuidanceCard[] {
  return mockGuidanceCards;
}

/** Return mock subscriptions for the current user. */
export function getMockSubscriptions(): Subscription[] {
  return mockSubscriptions;
}
