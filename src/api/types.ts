import type { components } from './generated-types';

// ── Core domain types ────────────────────────────────────────────────
export type Alert = components['schemas']['Alert'];
export type Event = components['schemas']['Event'];
export type Severity = components['schemas']['Severity'];
export type HazardType = components['schemas']['HazardType'];
export type GeoPoint = components['schemas']['GeoPoint'];

// ── Verification & source ────────────────────────────────────────────
export type VerificationLabel = Alert['verification_label'];
export type SourceType = components['schemas']['SourceType'];
export type ObservedEffect = components['schemas']['ObservedEffect'];

// ── Config & feature flags ───────────────────────────────────────────
export type ClientConfig = components['schemas']['ClientConfig'];
export type RegionCode = components['schemas']['RegionCode'];
export type CoordinateFrame = components['schemas']['CoordinateFrame'];

// ── Situational awareness ────────────────────────────────────────────
export type SituationalBrief = components['schemas']['SituationalBrief'];
export type AlertExplanation = components['schemas']['AlertExplanation'];
export type AskRequest = components['schemas']['AskRequest'];
export type AskAnswer = components['schemas']['AskAnswer'];
export type CascadeAssessment = components['schemas']['CascadeAssessment'];

// ── Guidance ─────────────────────────────────────────────────────────
export type GuidanceCard = components['schemas']['GuidanceCard'];
export type GuidanceBundle = components['schemas']['GuidanceBundle'];

// ── User & auth ──────────────────────────────────────────────────────
export type User = components['schemas']['User'];
export type AlertPreferences = components['schemas']['AlertPreferences'];
export type AuthTokens = components['schemas']['AuthTokens'];

// ── Reports ──────────────────────────────────────────────────────────
export type ReportSubmission = components['schemas']['ReportSubmission'];
export type ReportAccepted = components['schemas']['ReportAccepted'];
export type EventReports = components['schemas']['EventReports'];
export type ReportSummary = components['schemas']['ReportSummary'];

// ── Subscriptions ────────────────────────────────────────────────────
export type Subscription = components['schemas']['Subscription'];

// ── Hazard route check ───────────────────────────────────────────────
export type RouteCheck = components['schemas']['RouteCheck'];
export type CheckedRoute = components['schemas']['CheckedRoute'];
export type RouteHazard = components['schemas']['RouteHazard'];
export type RouteCheckRequest = components['schemas']['RouteCheckRequest'];
export type Place = components['schemas']['Place'];

// ── Mesh relay ───────────────────────────────────────────────────────
export type MeshRecord = components['schemas']['MeshRecord'];

// ── Review ───────────────────────────────────────────────────────────
export type ReviewItem = components['schemas']['ReviewItem'];

// ── Errors ───────────────────────────────────────────────────────────
export type ApiError = components['schemas']['Error'];

// ── Brief pending response (inline schema from 202) ──────────────────
export interface BriefPending {
  status: 'pending';
  retry_after_seconds: number;
}
