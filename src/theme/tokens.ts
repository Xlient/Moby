// ─────────────────────────────────────────────────────────────
//  Design tokens v2 — Disaster Early-Warning System
//
//  Soft, daylight-neutral base. All interface chrome is low-
//  saturation. Saturated color appears ONLY in the severity
//  ramp — saturation means urgency — and in the two trust
//  colors, which answer "who says so?": blue for an official
//  agency, violet for unverified reports from people nearby.
//  Neither hue is used anywhere else, so they never read as
//  a severity.
// ─────────────────────────────────────────────────────────────

// ── Colour interfaces ────────────────────────────────────────

export interface BgColors {
  /** App background, soft neutral */
  base: string;
  /** Cards */
  raised: string;
  /** Unverified cards, inset areas */
  recessed: string;
}

export interface LineColors {
  /** Rare dividers */
  hairline: string;
}

export interface TextColors {
  /** Body, headings */
  primary: string;
  /** Metadata, timestamps */
  secondary: string;
  /** Placeholder, disabled */
  faint: string;
}

export interface AccentColors {
  /** Reassurance — "watching", all-clear, success */
  calm: string;
}

export interface TrustColor {
  /** Label text and icon (WCAG AA on `bg` and on cards, both themes) */
  text: string;
  /** Pill fill */
  bg: string;
  /** Pill outline (dashed for unverified) */
  border: string;
}

export interface TrustColors {
  /** Issued by an official agency */
  official: TrustColor;
  /** Reports from people nearby: nobody has checked them */
  unverified: TrustColor;
}

export interface SeverityColors {
  low: string;
  medium: string;
  high: string;
  critical: string;
}

// ── Theme interface ──────────────────────────────────────────

export interface Theme {
  bg: BgColors;
  line: LineColors;
  text: TextColors;
  accent: AccentColors;
  severity: SeverityColors;
  trust: TrustColors;
  shadow: string;
}

// ── Light theme (primary) ────────────────────────────────────

export const lightTheme: Theme = {
  bg: {
    base: '#F7F8F6',
    raised: '#FFFFFF',
    recessed: '#EFF1EE',
  },
  line: {
    hairline: '#E1E5E1',
  },
  text: {
    primary: '#1F2A2E',
    secondary: '#5F6E73',
    faint: '#93A1A4',
  },
  accent: {
    calm: '#6B8F87',
  },
  severity: {
    low: '#5B87A0',
    medium: '#C98A26',
    high: '#C55D23',
    critical: '#BC3B32',
  },
  trust: {
    official: { text: '#1E4FAE', bg: '#E4EDFC', border: '#1E4FAE' },     // 6.4:1 on bg, 7.5:1 on white
    unverified: { text: '#7339A8', bg: '#F3EAFB', border: '#7339A8' },   // 6.2:1 on bg, 6.4:1 on recessed
  },
  shadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
};

// ── Dark theme ───────────────────────────────────────────────

export const darkTheme: Theme = {
  bg: {
    base: '#181D1F',
    raised: '#212829',
    recessed: '#141819',
  },
  line: {
    hairline: '#2E3638',
  },
  text: {
    primary: '#E9EDEB',
    secondary: '#9BA8AB',
    faint: '#6C797C',
  },
  accent: {
    calm: '#7FA79E',
  },
  severity: {
    low: '#7BA3B8',
    medium: '#E0A33C',
    high: '#DD7434',
    critical: '#CE4B41',
  },
  trust: {
    official: { text: '#A3C2F7', bg: '#1C2A42', border: '#A3C2F7' },     // 8.0:1 on bg, 8.3:1 on raised
    unverified: { text: '#D2B0F4', bg: '#2B2238', border: '#B88AE8' },   // 8.1:1 on bg, 9.6:1 on recessed
  },
  shadow: '0 1px 3px rgba(0, 0, 0, 0.32)',
};

// ── Typography ───────────────────────────────────────────────
//
// React Native text styles. No fontFamily: the platform system
// font (Roboto on Android, SF on iOS, system-ui on web) is used.

export type FontWeight = '400' | '500' | '600' | '700';

export interface TypeToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: FontWeight;
  fontVariant: ['tabular-nums'];
}

export interface Typography {
  /** Alert headline — 26/32 semibold */
  title: TypeToken;
  /** Section heading — 19/25 semibold */
  heading: TypeToken;
  /** Body, guidance — 17/25 regular */
  body: TypeToken;
  /** Emphasis — 17/25 semibold */
  bodyStrong: TypeToken;
  /** Timestamps, distance, source — 14/19 regular */
  meta: TypeToken;
  /** Trust label, chips — 13/17 medium */
  label: TypeToken;
}

export const typeToken = (
  fontSize: number,
  lineHeight: number,
  fontWeight: FontWeight,
): TypeToken => ({
  fontSize,
  lineHeight,
  fontWeight,
  fontVariant: ['tabular-nums'],
});

export const typography: Typography = {
  title: typeToken(26, 32, '600'),
  heading: typeToken(19, 25, '600'),
  body: typeToken(17, 25, '400'),
  bodyStrong: typeToken(17, 25, '600'),
  meta: typeToken(14, 19, '400'),
  label: typeToken(13, 17, '500'),
};

// ── Spacing ──────────────────────────────────────────────────

export interface Spacing {
  scale: readonly [4, 8, 12, 16, 20, 24, 32, 48];
  screenGutter: 16;
  cardPadding: 16;
  sectionGap: 24;
  minTapTarget: 48;
}

export const spacing: Spacing = {
  scale: [4, 8, 12, 16, 20, 24, 32, 48] as const,
  screenGutter: 16,
  cardPadding: 16,
  sectionGap: 24,
  minTapTarget: 48,
};

// ── Radius ───────────────────────────────────────────────────

export interface Radius {
  card: number;
  chip: number;
  input: number;
  pill: number;
}

export const radius: Radius = {
  card: 12,
  chip: 8,
  input: 8,
  pill: 999,
};
