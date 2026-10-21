import type {
  Place,
  RouteCheck,
  RouteCheckRequest,
  Alert,
  ClientConfig,
  SituationalBrief,
  GuidanceCard,
  Subscription,
  BriefPending,
  AlertExplanation,
  AskAnswer,
  EventReports,
  ReportSummary,
  TripBrief,
  TripBriefRequest,
} from './types';

// ── Helpers: relative dates ──────────────────────────────────────────

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// ── Mock config ──────────────────────────────────────────────────────

// Mirrors the server's GET /v1/config (moby/api/app.py), so demo builds and store
// screenshots show exactly what ships. Flip a flag here locally to work on its UI.
export const mockConfig: ClientConfig = {
  min_supported_client: '1.0.0',
  flags: {
    situational_brief: true,
    cascade_analysis: false,
    offline_guidance_cards: true,
    on_device_assistant: false,
    ask_moby: true,
    mesh_relay: false,
    proximity_confirmation: false,
    early_tier_opt_in: false,
    trip_briefing: true,
  },
};

// ── Mock alerts ──────────────────────────────────────────────────────

export const mockAlerts: Alert[] = [
  {
    alert_id: 'alert-001',
    event_id: 'event-001',
    hazard_type: 'flood',
    product: 'Flash Flood Warning',
    headline: 'Flash flood warning',
    body: 'Move to higher ground immediately. Flash flood warning in effect for low-lying areas along the Russian River.',
    severity: 'critical',
    location: { lat: 37.7749, lon: -122.4194, accuracy_m: 500, frame: 'WGS84' },
    affected_radius_km: 25,
    issued_at: minutesAgo(14),
    expires_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    verification_label: 'official_confirmed',
    source_attribution: 'National Weather Service',
    location_name: 'Russian River Basin',
  },
  {
    alert_id: 'alert-002',
    event_id: 'event-002',
    hazard_type: 'storm',
    headline: 'Severe thunderstorm watch',
    body: 'Damaging winds up to 70 mph and quarter-sized hail expected. Seek sturdy shelter and stay away from windows.',
    severity: 'high',
    location: { lat: 38.5816, lon: -121.4944, accuracy_m: 2000, frame: 'WGS84' },
    affected_radius_km: 80,
    issued_at: minutesAgo(45),
    expires_at: new Date(Date.now() + 4 * 3_600_000).toISOString(),
    verification_label: 'official_confirmed',
    source_attribution: 'NOAA Storm Prediction Center',
    location_name: 'Central Valley',
  },
  {
    alert_id: 'alert-003',
    event_id: 'event-003',
    hazard_type: 'landslide',
    corroboration_count: 4,
    headline: 'Landslide reported',
    body: 'Multiple community reports of debris flow blocking both lanes of Highway 1 south of Pacifica. Avoid the area and use alternate routes.',
    severity: 'medium',
    location: { lat: 37.6138, lon: -122.4869, accuracy_m: 150, frame: 'WGS84' },
    affected_radius_km: 5,
    issued_at: minutesAgo(120),
    verification_label: 'corroborated_report',
    source_attribution: 'Community reports',
    location_name: 'Highway 1, Pacifica',
  },
  {
    alert_id: 'alert-004',
    event_id: 'event-004',
    hazard_type: 'other',
    headline: 'Possible sinkhole forming',
    body: 'Single report of a possible sinkhole forming near the intersection of Geary Blvd and 25th Ave. Not yet corroborated.',
    severity: 'low',
    location: { lat: 37.7812, lon: -122.4862, accuracy_m: 30, frame: 'WGS84' },
    affected_radius_km: 0.5,
    issued_at: minutesAgo(30),
    verification_label: 'unverified_report',
    location_name: 'Geary Blvd',
  },
  {
    alert_id: 'alert-005',
    event_id: 'event-005',
    hazard_type: 'fire',
    headline: 'Red flag warning',
    body: 'Gusty offshore winds and very low humidity. Any fire that starts will spread quickly. No outdoor burning.',
    severity: 'high',
    location: { lat: 37.8324, lon: -122.4795, accuracy_m: 3000, frame: 'WGS84' },
    affected_radius_km: 30,
    issued_at: minutesAgo(65),
    expires_at: new Date(Date.now() + 10 * 3_600_000).toISOString(),
    verification_label: 'official_confirmed',
    source_attribution: 'National Weather Service',
    location_name: 'Marin Headlands',
  },
  {
    alert_id: 'alert-006',
    event_id: 'event-006',
    hazard_type: 'storm',
    headline: 'Downed power lines',
    body: 'Several people report power lines down across Valencia St after strong gusts. Keep at least 10 m away.',
    severity: 'medium',
    location: { lat: 37.7599, lon: -122.4214, accuracy_m: 80, frame: 'WGS84' },
    affected_radius_km: 0.5,
    issued_at: minutesAgo(22),
    verification_label: 'corroborated_report',
    source_attribution: 'Community reports',
    corroboration_count: 3,
    location_name: 'Mission District',
  },
  {
    alert_id: 'alert-007',
    event_id: 'event-007',
    hazard_type: 'earthquake',
    headline: 'Magnitude 3.4 earthquake',
    body: 'Light shaking reported. No damage expected. Be ready for aftershocks.',
    severity: 'low',
    location: { lat: 37.8044, lon: -122.2712, accuracy_m: 1000, frame: 'WGS84' },
    issued_at: minutesAgo(180),
    verification_label: 'official_confirmed',
    source_attribution: 'U.S. Geological Survey',
    location_name: 'Oakland',
  },
  {
    alert_id: 'alert-008',
    event_id: 'event-008',
    hazard_type: 'storm',
    product: 'Small Craft Advisory',
    marine: true,
    headline: 'Small craft advisory',
    body: 'Northwest winds 20 to 30 kt and choppy seas. Inexperienced mariners should avoid navigating in these conditions.',
    severity: 'medium',
    location: { lat: 37.8199, lon: -122.4783, accuracy_m: 5000, frame: 'WGS84' },
    affected_radius_km: 15,
    issued_at: minutesAgo(50),
    expires_at: new Date(Date.now() + 8 * 3_600_000).toISOString(),
    verification_label: 'official_confirmed',
    source_attribution: 'National Weather Service',
    location_name: 'San Francisco Bay',
  },
];

// ── Mock situational briefs (shaped like Nemotron Ultra's real output) ──

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

export const mockBriefReady: SituationalBrief = {
  event_id: 'event-001',
  generated_at: minutesAgo(6),
  model: 'nvidia/Nemotron-3-Ultra-550b-a55b',
  version: 2,
  summary:
    'The National Weather Service has a flash flood warning in force for the Russian River basin. ' +
    'People nearby report a flooded road and rising water near the river; these reports are unverified.',
  claims: [
    { text: 'A flash flood warning is in force for the Russian River basin until later today.', basis: 'official', evidence: ['O1'] },
    { text: 'The warning tells people in low-lying areas to move to higher ground.', basis: 'official', evidence: ['O1'] },
    { text: 'Three people nearby report a flooded road, the most recent 9 minutes ago.', basis: 'community', evidence: ['C1'] },
    { text: 'Two people nearby report rising water near the river.', basis: 'community', evidence: ['C2'] },
  ],
  contradictions: [],
  official_guidance: 'The National Weather Service says to move to higher ground now and not to drive through flooded roads.',
  likely_progression: 'The warning is in force for about 6 more hours (an estimate from its end time).',
  uncertainty:
    'The community reports are unverified and come from 5 people. The brief can\'t say how deep the water is or ' +
    'which roads are affected beyond what people reported. Conditions may have changed since the last report.',
  changes: 'Two more people reported the flooded road since the last brief.',
  changes_since: minutesAgo(40),
  citations: [
    { id: 'O1', kind: 'official', title: 'Flash Flood Warning · National Weather Service' },
    { id: 'C1', kind: 'community', title: 'Flooded road · 3 people' },
    { id: 'C2', kind: 'community', title: 'Rising water · 2 people' },
  ],
  sources: ['Flash Flood Warning · National Weather Service', 'Flooded road · 3 people', 'Rising water · 2 people'],
  timeline: [
    { at: minutesAgo(48), until: minutesAgo(31), kind: 'community', type: 'reports', label: 'Rising water', reporters: 2,
      severity: 'high', times: [minutesAgo(48), minutesAgo(31)], after_brief: false },
    { at: minutesAgo(26), kind: 'official', type: 'issued', label: 'Flash Flood Warning issued',
      detail: 'National Weather Service', after_brief: false },
    { at: minutesAgo(21), until: minutesAgo(9), kind: 'community', type: 'reports', label: 'Flooded road', reporters: 3,
      severity: 'high', times: [minutesAgo(21), minutesAgo(15), minutesAgo(9)], after_brief: false },
    { at: minutesAgo(14), kind: 'official', type: 'updated', label: 'Flash Flood Warning updated',
      detail: 'National Weather Service', after_brief: false },
    { at: minutesAgo(2), until: minutesAgo(2), kind: 'community', type: 'reports', label: 'Blocked road', reporters: 1,
      severity: 'medium', times: [minutesAgo(2)], after_brief: true },
    { at: inHours(6), kind: 'official', type: 'expires', label: 'In force until', detail: 'National Weather Service',
      after_brief: false },
  ],
};

export const mockCommunityBrief: SituationalBrief = {
  event_id: 'event-003',
  generated_at: minutesAgo(18),
  model: 'nvidia/Nemotron-3-Ultra-550b-a55b',
  version: 1,
  summary:
    'People nearby report a landslide across the road, with debris still moving. There is no official warning; ' +
    'these reports are unverified.',
  claims: [
    { text: 'Four people nearby report debris blocking the road.', basis: 'community', evidence: ['C1'] },
    { text: 'One person reports the slope is still moving.', basis: 'community', evidence: ['C2'] },
  ],
  contradictions: ['C1 describes the road as fully blocked; one report in C1 says one lane is still open.'],
  uncertainty:
    'No agency has confirmed this. Only one person reports movement, and nobody has said whether anyone is hurt.',
  citations: [
    { id: 'C1', kind: 'community', title: 'Blocked road · 4 people' },
    { id: 'C2', kind: 'community', title: 'Ground movement · 1 person' },
  ],
  sources: ['Blocked road · 4 people', 'Ground movement · 1 person'],
  timeline: [
    { at: minutesAgo(118), until: minutesAgo(64), kind: 'community', type: 'reports', label: 'Blocked road', reporters: 4,
      severity: 'high', times: [minutesAgo(118), minutesAgo(104), minutesAgo(90), minutesAgo(64)], after_brief: false },
    { at: minutesAgo(40), until: minutesAgo(40), kind: 'community', type: 'reports', label: 'Ground movement',
      reporters: 1, severity: 'critical', times: [minutesAgo(40)], after_brief: false },
  ],
};

// ── Mock situational brief (pending) ─────────────────────────────────

export const mockBriefPending: BriefPending = {
  status: 'pending',
  retry_after_seconds: 2,
};

// ── Mock guidance cards ──────────────────────────────────────────────

export const mockGuidanceCards: GuidanceCard[] = [
  {
    card_id: 'card-flood-001',
    hazard_type: 'flood',
    applies_when: 'Flash flood warning in your area',
    title: 'Flash Flood Safety: What To Do Right Now',
    body:
      '1. Move to higher ground immediately \u2014 do not wait for official orders if you see rising water.\n' +
      '2. Avoid walking or driving through flood waters. Six inches of moving water can knock you down; one foot can sweep away a vehicle.\n' +
      '3. If trapped in a building, go to the highest floor. Do not climb into a closed attic \u2014 you may become trapped by rising water.\n' +
      '4. Disconnect electrical appliances and do not touch electrical equipment if you are wet or standing in water.\n' +
      '5. After the flood, avoid floodwater \u2014 it may be contaminated with sewage, chemicals, or debris.',
    priority: 1,
    source_name: 'FEMA',
    source_url: 'https://www.ready.gov/floods',
    last_reviewed_at: daysAgo(12),
    is_critical_fallback: true,
  },
  {
    card_id: 'card-earthquake-001',
    hazard_type: 'earthquake',
    applies_when: 'The ground is shaking',
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
    applies_when: 'Severe thunderstorm watch',
    title: 'Severe Thunderstorm Safety',
    body:
      '1. Move indoors to a sturdy building. Avoid sheds, isolated trees, and open fields.\n' +
      '2. Stay away from windows, skylights, and glass doors.\n' +
      '3. Unplug sensitive electronics \u2014 power surges from lightning can cause fires or damage equipment.\n' +
      '4. If caught outdoors, crouch low with feet together and head tucked. Minimize contact with the ground.\n' +
      '5. Wait at least 30 minutes after the last clap of thunder before going back outside.\n' +
      '6. Watch for flooding in low-lying areas \u2014 thunderstorms can produce heavy rainfall in short periods.',
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
    label: 'Home \u2014 San Francisco',
    center: { lat: 37.7749, lon: -122.4194, frame: 'WGS84' },
    radius_km: 30,
    min_severity: 'medium',
  },
  {
    subscription_id: 'sub-002',
    region: 'US',
    label: 'Work \u2014 Sacramento',
    center: { lat: 38.5816, lon: -121.4944, frame: 'WGS84' },
    radius_km: 15,
    min_severity: 'high',
  },
];

// ── Helper functions ─────────────────────────────────────────────────

export function getMockAlerts(): Alert[] {
  return mockAlerts;
}

export function getMockAlert(alertId: string): Alert | undefined {
  return mockAlerts.find((a) => a.alert_id === alertId);
}

const mockEventReports: Record<string, ReportSummary[]> = {
  'event-003': [
    { hazard_type: 'landslide', observed_effect: 'blocked_road', severity: 'medium', observed_at: minutesAgo(118), distance_from_event_m: 0, captured_offline: false },
    { hazard_type: 'landslide', observed_effect: 'blocked_road', severity: 'high', observed_at: minutesAgo(131), distance_from_event_m: 200, captured_offline: true },
    { hazard_type: 'landslide', observed_effect: 'structural_damage', severity: 'medium', observed_at: minutesAgo(140), distance_from_event_m: 300, captured_offline: false, via_mesh: true },
    { hazard_type: 'landslide', observed_effect: 'blocked_road', severity: 'medium', observed_at: minutesAgo(152), distance_from_event_m: 100, captured_offline: false },
  ],
  'event-004': [
    { hazard_type: 'other', observed_effect: 'other', severity: 'low', observed_at: minutesAgo(31), distance_from_event_m: 0, captured_offline: false },
  ],
  'event-006': [
    { hazard_type: 'storm', observed_effect: 'other', severity: 'medium', observed_at: minutesAgo(20), distance_from_event_m: 0, captured_offline: false },
    { hazard_type: 'storm', observed_effect: 'other', severity: 'medium', observed_at: minutesAgo(26), distance_from_event_m: 100, captured_offline: false },
    { hazard_type: 'storm', observed_effect: 'blocked_road', severity: 'high', observed_at: minutesAgo(29), distance_from_event_m: 100, captured_offline: false },
  ],
};

export function getMockEventReports(eventId: string): EventReports {
  // report_id as the real API sends it, so "This looks wrong" shows on each row.
  const reports = (mockEventReports[eventId] ?? []).map((r, i) => ({ report_id: `${eventId}-report-${i}`, ...r }));
  return { event_id: eventId, distinct_reporter_count: reports.length, reports };
}

export function getMockConfig(): ClientConfig {
  return mockConfig;
}

// The first look at an event "generates" its brief for a few seconds, like the real worker.
const MOCK_BRIEF_DELAY_MS = 4_000;
const mockBriefFirstAsked = new Map<string, number>();

/** null = no brief for this event (the API's 404). */
export function getMockBrief(eventId: string): SituationalBrief | BriefPending | null {
  const brief = eventId === 'event-001' ? mockBriefReady : eventId === 'event-003' ? mockCommunityBrief : null;
  if (!brief) return null;
  const first = mockBriefFirstAsked.get(eventId) ?? Date.now();
  mockBriefFirstAsked.set(eventId, first);
  return Date.now() - first < MOCK_BRIEF_DELAY_MS ? mockBriefPending : brief;
}

export function getMockGuidanceCards(): GuidanceCard[] {
  return mockGuidanceCards;
}

export function getMockSubscriptions(): Subscription[] {
  return mockSubscriptions;
}

// "What this means for you" sample (the real one is written by Nemotron Super from the agency's text).
export function getMockExplanation(eventId: string): AlertExplanation | undefined {
  if (eventId !== 'event-001') return undefined;
  return {
    event_id: eventId,
    summary:
      'Flash flooding is expected in low-lying areas along the Russian River. '
      + 'The warning tells anyone there to move to higher ground immediately.',
    actions: ['Move to higher ground immediately.'],
    model: 'nvidia/nemotron-3-super-120b-a12b',
    generated_at: new Date().toISOString(),
  };
}

// Ask Moby sample: answers about floods, abstains on anything else (like the real one off-topic).
export function getMockAnswer(question: string): AskAnswer {
  if (!/flood|water|road/i.test(question)) {
    return { answer: null, abstained: true, sources: [], model: 'nvidia/nemotron-3-super-120b-a12b', searched_web: false, search_limited: false };
  }
  return {
    answer: 'Turn around and find another route: never drive through a flooded road [1]. '
      + 'Just 12 inches of moving water can carry away most cars [1].',
    abstained: false,
    sources: [{ n: 1, kind: 'guidance', title: 'Flooded road: turn around', publisher: 'National Weather Service',
      url: 'https://www.weather.gov/safety/flood-turn-around-dont-drown' }],
    model: 'nvidia/nemotron-3-super-120b-a12b',
    searched_web: false,
  };
}

// ── Hazard route check (demo) ─────────────────────────────────────────

export function getMockPlaces(q: string): Place[] {
  return [
    { label: `${q} · Muir Woods, Mill Valley, CA`, lat: 37.8912, lon: -122.5719 },
    { label: `${q} · Golden Gate Park, San Francisco, CA`, lat: 37.7694, lon: -122.4862 },
  ];
}

/** A demo route: the straight way crosses the red flag warning; the way around doesn't. */
export function getMockRouteCheck(req: RouteCheckRequest): RouteCheck {
  const { origin: o, destination: d } = req;
  const mid = { lat: (o.lat + d.lat) / 2, lon: (o.lon + d.lon) / 2 };
  const km = Math.hypot((d.lat - o.lat) * 111, (d.lon - o.lon) * 88);
  const walking = req.profile === 'foot-hiking';
  const seconds = (k: number) => Math.round((k / (walking ? 4.5 : 40)) * 3600);
  return {
    profile: req.profile ?? 'driving-car',
    route: {
      geometry: { type: 'LineString', coordinates: [[o.lon, o.lat], [mid.lon, mid.lat], [d.lon, d.lat]] },
      distance_m: Math.round(km * 1000),
      duration_s: seconds(km),
      hazards: [{
        event_id: 'event-005', alert_id: 'alert-005', hazard_type: 'fire', severity: 'high',
        verification: 'official', headline: 'Red flag warning', km_along: Math.round(km * 5) / 10, at: mid,
        expires_at: new Date(Date.now() + 10 * 3_600_000).toISOString(),
      }],
    },
    alternative: {
      geometry: {
        type: 'LineString',
        coordinates: [[o.lon, o.lat], [mid.lon - 0.04, mid.lat - 0.03], [d.lon, d.lat]],
      },
      distance_m: Math.round(km * 1300),
      duration_s: seconds(km * 1.3),
      hazards: [],
    },
    alternative_problem: null,
  };
}

// "Before you go" sample (POST /v1/trips/brief): the Phakding demo — an official flood alert and
// community "bridge washed out" reports, explained with citations. Elsewhere: nothing found.
export function getMockTripBrief(req: TripBriefRequest): TripBrief {
  const now = new Date();
  const start = req.start_date ?? now.toISOString().slice(0, 10);
  const end = req.end_date ?? new Date(now.getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
  // A route's destination is its last stop.
  const stops = req.stops ?? [{ lat: req.lat ?? 0, lon: req.lon ?? 0, name: req.place_name }];
  const last = stops[stops.length - 1]!;
  const lat = Math.round(last.lat * 100) / 100;
  const lon = Math.round(last.lon * 100) / 100;
  const nearPhakding = stops.some((s) => Math.abs(s.lat - 27.74) < 0.5 && Math.abs(s.lon - 86.71) < 0.5);
  const base = {
    generated_at: now.toISOString(),
    destination: {
      lat, lon, radius_km: req.radius_km ?? 25,
      ...(last.name ? { place_name: last.name } : {}),
      ...(req.country ? { country: req.country } : {}),
    },
    ...(req.stops ? { route: { stops: req.stops, length_km: 13.5 } } : {}),
    trip: { start_date: start, end_date: end },
    language: 'en',
    cached: false,
  };
  const stale = `This briefing shows what Moby knew at ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC. `
    + 'Saved for offline, it goes stale: it can\u2019t know about warnings issued or changed after it was saved. '
    + 'Check again whenever you have signal, and follow local authorities.';
  if (!nearPhakding) {
    return {
      ...base, official_alerts: [], community_reports: [], hazards: [], web_sources: [], searched_web: false,
      web_status: 'no_official_sites', ai_status: 'nothing_to_explain',
      uncertainty: [stale, 'No active official alerts cover this area right now. That doesn\u2019t mean it\u2019s safe: '
        + 'Moby only sees agencies whose warnings it can read, and conditions change quickly.'],
    };
  }
  return {
    ...base,
    official_alerts: [{
      alert_id: 'trip-o1', event_id: 'trip-o1', cite_id: 'O1', ends_before_trip: false,
      hazard_type: 'flood', headline: 'Flood warning for the Dudh Koshi',
      body: 'Water level of the Dudh Koshi at Phakding is above the warning level and rising. People along the '
        + 'river banks and trails close to the river are advised to stay alert and avoid crossing the river.',
      severity: 'high', location: { lat: 27.74, lon: 86.71, frame: 'WGS84' },
      issued_at: minutesAgo(95), expires_at: new Date(Date.now() + 30 * 3_600_000).toISOString(),
      verification_label: 'official_confirmed', source_attribution: 'Department of Hydrology and Meteorology',
      location_name: 'Dudh Koshi, Solukhumbu', country: 'NP', distance_km: 0,
    }],
    community_reports: [{
      alert_id: 'trip-c1', event_id: 'trip-c1', cite_id: 'C1', reporter_count: 3, last_report_at: minutesAgo(70),
      hazard_type: 'flood', headline: 'Bridge washed out reported', severity: 'high',
      location: { lat: 27.75, lon: 86.71, frame: 'WGS84' }, issued_at: minutesAgo(180),
      verification_label: 'corroborated_report', source_attribution: 'Community reports', corroboration_count: 3,
      distance_km: 1.1,
    }],
    hazards: ['flood'],
    web_sources: [{ cite_id: 'W1', title: 'Flood early warning', url: 'https://bipad.gov.np/en/', publisher: 'bipad.gov.np' }],
    searched_web: true,
    web_status: 'searched',
    ai_status: 'ok',
    explanation: {
      model: 'nvidia/Nemotron-3-Ultra-550b-a55b',
      claims: [
        { text: 'The Dudh Koshi at Phakding is above the warning level and rising; avoid the river banks and trails '
          + 'close to the river, and don\u2019t cross the river.', basis: 'official', cites: ['O1'] },
        { text: '3 people nearby report a bridge washed out about 1.1 km from Phakding. This isn\u2019t confirmed, but '
          + 'plan for a river crossing being closed.', basis: 'community', cites: ['C1'] },
      ],
    },
    uncertainty: [
      stale,
      `Alerts and reports are matched to a ${req.radius_km ?? 25} km circle around the point you picked, not to your exact route.`,
      'Reports from people nearby are unverified: no official source has confirmed them.',
    ],
  };
}
