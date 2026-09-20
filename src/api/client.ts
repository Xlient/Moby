import type {
  Alert,
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
  HazardType,
} from './types';
import {
  getMockAlerts,
  getMockAlert,
  getMockConfig,
  getMockBrief,
  getMockGuidanceCards,
  getMockSubscriptions,
} from './mock-data';

// ── Configuration ────────────────────────────────────────────────────

const BASE_URL: string =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) ||
  'https://api.example.dev/v1';

/**
 * When true the client returns mock data instead of hitting the network.
 * Defaults to true in development (Vite sets import.meta.env.DEV).
 */
const USE_MOCK: boolean =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ?? true;

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
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (this.getToken) {
      const token = await this.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url.toString(), {
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

    const fullUrl = new URL(`${this.baseUrl}${url}`);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.getToken) {
      const token = await this.getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(fullUrl.toString(), { method: 'GET', headers });

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
    const fullUrl = new URL(`${this.baseUrl}${url}`);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.getToken) {
      const token = await this.getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(fullUrl.toString(), { method: 'GET', headers });

    if (res.status === 204) return null;

    if (!res.ok) {
      throw new ApiRequestError(res.status, 'CASCADE_ERROR', `Cascade fetch failed for ${region}`);
    }
    return (await res.json()) as CascadeAssessment;
  }

  // ── Guidance ─────────────────────────────────────────────────────

  async getGuidanceManifest(region?: RegionCode): Promise<{ bundles?: GuidanceBundle[] }> {
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

  async submitReport(report: ReportSubmission): Promise<ReportAccepted> {
    return this.request<ReportAccepted>('POST', '/reports', { body: report });
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
