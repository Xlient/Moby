import type {
  Alert,
  AlertPreferences,
  BriefPending,
  CascadeAssessment,
  ClientConfig,
  GuidanceCard,
  GuidanceBundle,
  RegionCode,
  ReportAccepted,
  ReportSubmission,
  SituationalBrief,
  Subscription,
  User,
  Event,
  EventReports,
  HazardType,
} from './types';
import {
  getMockAlerts,
  getMockAlert,
  getMockConfig,
  getMockBrief,
  getMockGuidanceCards,
  getMockSubscriptions,
  getMockEventReports,
} from './fixtures';
import { env } from '@/config/env';
import { appCheckToken } from '@/lib/appCheck';

export interface AlertAreas {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id?: string;
    geometry: GeoJSON.Geometry;
    properties: { alert_id: string; severity: Alert['severity']; hazard_type?: Alert['hazard_type'] };
  }[];
}

function mockAlertAreas(alerts: Alert[]): AlertAreas {
  const features = alerts.flatMap((a) => {
    if (!a.location || !a.affected_radius_km) return [];
    const { lat, lon } = a.location;
    const r = a.affected_radius_km;
    const ring = Array.from({ length: 33 }, (_, i) => {
      const t = (2 * Math.PI * i) / 32;
      return [lon + (r / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(t), lat + (r / 111.32) * Math.cos(t)];
    });
    return [{
      type: 'Feature' as const,
      id: a.alert_id,
      geometry: { type: 'Polygon' as const, coordinates: [ring] },
      properties: { alert_id: a.alert_id, severity: a.severity, hazard_type: a.hazard_type },
    }];
  });
  return { type: 'FeatureCollection', features };
}

// ── Configuration ────────────────────────────────────────────────────

const BASE_URL: string = env.apiUrl;

/**
 * When true the client returns mock data instead of hitting the network.
 * Controlled by EXPO_PUBLIC_USE_MOCK / EXPO_PUBLIC_API_URL (see src/config/env.ts).
 */
const USE_MOCK: boolean = env.useMock;

// ── Error types ──────────────────────────────────────────────────────

export class ApiRequestError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly body: unknown;

  constructor(status: number, code: string, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

// ── API Client ───────────────────────────────────────────────────────

export class ApiClient {
  private baseUrl: string;
  private getToken: (() => Promise<string | null>) | null;

  constructor(baseUrl: string = BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.getToken = null;
  }

  setTokenProvider(provider: (() => Promise<string | null>) | null): void {
    this.getToken = provider;
  }

  // ── Generic request plumbing ─────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
      noContent?: boolean;
    } = {},
  ): Promise<T> {
    // Built by hand: React Native's URL/URLSearchParams polyfill is incomplete.
    const qs = options.query
      ? Object.entries(options.query)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
          .join('&')
      : '';
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (this.getToken) {
      const token = await this.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }
    // Only the official app can call the API (server: moby/api/appcheck.py).
    const appCheck = await appCheckToken();
    if (appCheck) headers['X-Firebase-AppCheck'] = appCheck;

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      let errorBody: unknown;
      let code = 'UNKNOWN';
      let message = `HTTP ${response.status}`;
      try {
        errorBody = await response.json();
        if (
          errorBody &&
          typeof errorBody === 'object' &&
          'code' in errorBody &&
          'message' in errorBody
        ) {
          code = (errorBody as { code: string }).code;
          message = (errorBody as { message: string }).message;
        }
      } catch {
        // body wasn't JSON — use status text
        message = response.statusText || message;
      }
      throw new ApiRequestError(response.status, code, message, errorBody);
    }

    if (options.noContent || response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  // ── Config ───────────────────────────────────────────────────────

  async getConfig(): Promise<ClientConfig> {
    if (USE_MOCK) return getMockConfig();
    return this.request<ClientConfig>('GET', '/config');
  }

  // ── User ─────────────────────────────────────────────────────────

  async getMe(): Promise<User> {
    return this.request<User>('GET', '/me');
  }

  async registerDevice(data: {
    device_id: string;
    push_provider: 'fcm' | 'apns';
    push_token: string;
    platform: 'ios' | 'android';
  }): Promise<void> {
    return this.request<void>('POST', '/me/devices', {
      body: data,
      noContent: true,
    });
  }

  /** On sign-out: this phone stops receiving the person's alerts. */
  async unregisterDevice(deviceId: string): Promise<void> {
    return this.request<void>('DELETE', `/me/devices/${encodeURIComponent(deviceId)}`, { noContent: true });
  }

  /** Same preferences drive what the app lists and what may notify (critical always does). */
  async putAlertPreferences(prefs: AlertPreferences): Promise<AlertPreferences> {
    return this.request<AlertPreferences>('PUT', '/me/alert-preferences', { body: prefs });
  }

  /** Stop push for the area around the phone ("Alerts follow my location" off). */
  async deleteNearMe(): Promise<void> {
    return this.request<void>('DELETE', '/me/near-me', { noContent: true });
  }

  /** Everything the server holds about the caller (GDPR access / portability). */
  async exportMyData(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', '/me/export');
  }

  /** Erase the caller's data on the server (account deletion; the app removes the rest). */
  async deleteMe(): Promise<void> {
    return this.request<void>('DELETE', '/me', { noContent: true });
  }

  /** The area around the phone, for push. The server keeps it at ~1 km precision. */
  async putNearMe(center: { lat: number; lon: number }, radiusKm: number): Promise<void> {
    return this.request<void>('PUT', '/me/near-me', {
      body: { center: { ...center, frame: 'WGS84' }, radius_km: radiusKm },
      noContent: true,
    });
  }

  // ── Alerts ───────────────────────────────────────────────────────

  async getAlerts(params?: {
    region?: RegionCode;
    lat?: number;
    lon?: number;
    radius_km?: number;
    min_tier?: 0 | 1 | 2;
    since?: string;
  }): Promise<{ alerts?: Alert[] }> {
    if (USE_MOCK) return { alerts: getMockAlerts() };
    return this.request<{ alerts?: Alert[] }>('GET', '/alerts', {
      query: params as Record<string, string | number | boolean | undefined>,
    });
  }

  /** Warning areas for the map (GeoJSON). Mock: a circle per alert from affected_radius_km. */
  async getAlertAreas(params: { lat: number; lon: number; radius_km: number }): Promise<AlertAreas> {
    if (USE_MOCK) return mockAlertAreas(getMockAlerts());
    return this.request<AlertAreas>('GET', '/alerts/areas', { query: params });
  }

  async getAlert(alertId: string): Promise<Alert> {
    if (USE_MOCK) {
      const alert = getMockAlert(alertId);
      if (!alert) {
        throw new ApiRequestError(404, 'NOT_FOUND', `Alert ${alertId} not found`);
      }
      return alert;
    }
    return this.request<Alert>('GET', `/alerts/${encodeURIComponent(alertId)}`);
  }

  // ── Events ───────────────────────────────────────────────────────

  async getEvent(eventId: string): Promise<Event> {
    return this.request<Event>('GET', `/events/${encodeURIComponent(eventId)}`);
  }

  /** Community reports behind an event (public and coarse: no notes, no reporters). */
  async getEventReports(eventId: string): Promise<EventReports> {
    if (USE_MOCK) return getMockEventReports(eventId);
    return this.request<EventReports>('GET', `/events/${encodeURIComponent(eventId)}/reports`);
  }

  async confirmEvent(
    eventId: string,
    data: {
      response: 'confirm' | 'deny' | 'unsure';
      observed_at_location: boolean;
      observed_at: string;
      location?: { lat: number; lon: number; accuracy_m?: number; frame?: 'WGS84' | 'GCJ02' };
    },
  ): Promise<void> {
    return this.request<void>('POST', `/events/${encodeURIComponent(eventId)}/confirm`, {
      body: data,
      noContent: true,
    });
  }

  // ── Situational brief ────────────────────────────────────────────

  async getEventBrief(eventId: string): Promise<SituationalBrief | BriefPending> {
    if (USE_MOCK) return getMockBrief(eventId);
    // The server returns 200 for ready, 202 for pending.
    // Both are valid JSON — we return the parsed body and let the caller
    // check `'status' in result` to distinguish the two shapes.
    const url = `/events/${encodeURIComponent(eventId)}/brief`;

    const fullUrl = `${this.baseUrl}${url}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.getToken) {
      const token = await this.getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    const appCheck = await appCheckToken();
    if (appCheck) headers['X-Firebase-AppCheck'] = appCheck;

    const res = await fetch(fullUrl, { method: 'GET', headers });

    if (!res.ok && res.status !== 202) {
      let errorBody: unknown;
      try {
        errorBody = await res.json();
      } catch {
        /* empty */
      }
      throw new ApiRequestError(
        res.status,
        'BRIEF_ERROR',
        `Failed to fetch brief for ${eventId}`,
        errorBody,
      );
    }

    return (await res.json()) as SituationalBrief | BriefPending;
  }

  // ── Cascade assessment ───────────────────────────────────────────

  async getCascadeAssessment(region: RegionCode): Promise<CascadeAssessment | null> {
    const url = `/regions/${encodeURIComponent(region)}/cascade`;
    const fullUrl = `${this.baseUrl}${url}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.getToken) {
      const token = await this.getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    const appCheck = await appCheckToken();
    if (appCheck) headers['X-Firebase-AppCheck'] = appCheck;

    const res = await fetch(fullUrl, { method: 'GET', headers });

    if (res.status === 204) return null;

    if (!res.ok) {
      throw new ApiRequestError(res.status, 'CASCADE_ERROR', `Cascade fetch failed for ${region}`);
    }
    return (await res.json()) as CascadeAssessment;
  }

  // ── Guidance ─────────────────────────────────────────────────────

  async getGuidanceManifest(region?: RegionCode): Promise<{ bundles?: GuidanceBundle[] }> {
    if (USE_MOCK) {
      const cards = getMockGuidanceCards();
      return {
        bundles: [{
          bundle_id: 'us-mock', region: 'US', version: 'mock', content_hash: `mock-${cards.length}`,
          size_bytes: 0, generated_at: new Date(0).toISOString(), card_count: cards.length,
        }],
      };
    }
    return this.request<{ bundles?: GuidanceBundle[] }>('GET', '/guidance/manifest', {
      query: region ? { region } : undefined,
    });
  }

  async getGuidanceCards(params: {
    region: RegionCode;
    hazard_type?: HazardType;
    bundle_version?: string;
  }): Promise<{ cards?: GuidanceCard[] }> {
    if (USE_MOCK) return { cards: getMockGuidanceCards() };
    return this.request<{ cards?: GuidanceCard[] }>('GET', '/guidance/cards', {
      query: params as Record<string, string | number | boolean | undefined>,
    });
  }

  // ── Reports ──────────────────────────────────────────────────────

  /** Write-first: a 202 means durably received; fusion runs afterwards (contract 0.5.0). */
  async submitReport(report: ReportSubmission): Promise<ReportAccepted> {
    if (USE_MOCK) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return { client_event_id: report.client_event_id, report_id: `mock-${report.client_event_id}`, status: 'pending' };
    }
    return this.request<ReportAccepted>('POST', '/reports', { body: report });
  }

  /** Status of one of the caller's own reports (event_id / tier once fused). */
  async getReportStatus(clientEventId: string): Promise<ReportAccepted> {
    if (USE_MOCK) {
      return { client_event_id: clientEventId, report_id: `mock-${clientEventId}`, status: 'pending' };
    }
    return this.request<ReportAccepted>('GET', `/reports/${encodeURIComponent(clientEventId)}`);
  }

  // ── Subscriptions ────────────────────────────────────────────────

  async getSubscriptions(): Promise<Subscription[]> {
    if (USE_MOCK) return getMockSubscriptions();
    return this.request<Subscription[]>('GET', '/subscriptions');
  }

  async createSubscription(data: {
    region: RegionCode;
    label?: string;
    center: { lat: number; lon: number; frame?: 'WGS84' | 'GCJ02' };
    radius_km: number;
    min_severity?: 'low' | 'medium' | 'high' | 'critical';
  }): Promise<Subscription> {
    return this.request<Subscription>('POST', '/subscriptions', { body: data });
  }

  async deleteSubscription(subscriptionId: string): Promise<void> {
    return this.request<void>(
      'DELETE',
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { noContent: true },
    );
  }

  // ── Review (reviewer role) ───────────────────────────────────────

  async getReviewQueue(region?: RegionCode) {
    return this.request('GET', '/review/queue', {
      query: region ? { region } : undefined,
    });
  }

  async submitReviewDecision(
    eventId: string,
    data: {
      decision: 'approve' | 'reject' | 'hold';
      note?: string;
      override_severity?: 'low' | 'medium' | 'high' | 'critical';
    },
  ): Promise<void> {
    return this.request<void>(
      'POST',
      `/review/${encodeURIComponent(eventId)}/decision`,
      { body: data, noContent: true },
    );
  }

  // ── Mesh sync ────────────────────────────────────────────────────

  async syncMeshRecords(deviceId: string, records: unknown[]): Promise<{
    acknowledged?: string[];
    rejected?: { event_id?: string; reason?: string }[];
  }> {
    return this.request('POST', '/mesh/sync', {
      body: { device_id: deviceId, records },
    });
  }

  async getMeshAlerts(lat: number, lon: number, radiusKm?: number) {
    return this.request('GET', '/mesh/alerts', {
      query: { lat, lon, radius_km: radiusKm },
    });
  }
}

// ── Singleton instance ───────────────────────────────────────────────

export const api = new ApiClient();
