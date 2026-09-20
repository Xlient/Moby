// ─────────────────────────────────────────────────────────────
//  Design tokens — Disaster Early-Warning System
//
//  The entire UI is cold (slate / blue-grey). Warm hues appear
//  ONLY in the severity ramp. `severity.low` is intentionally
//  cold — that is load-bearing; do not change it.
// ─────────────────────────────────────────────────────────────

// ── Colour interfaces ────────────────────────────────────────

export interface BgColors {
  /** App background, cold slate */
  base: string;
  /** Cards, sheets */
  raised: string;
  /** Map canvas, inset wells */
  sunken: string;
}

export interface LineColors {
  /** Dividers, card edges */
  hairline: string;
  /** Structural rules, active borders */
  strong: string;
}

export interface TextColors {
  /** Body, headlines */
  primary: string;
  /** Metadata, timestamps */
  secondary: string;
  /** Disabled, placeholder */
  faint: string;
}

export interface SeverityColors {
  low: string;
  medium: string;
  high: string;
  critical: string;
}

export interface StatusColors {
  /** Muted, not celebratory */
  clear: string;
  /** Neutral — offline is not an error */
  offline: string;
}

// ── Theme interface ──────────────────────────────────────────

export interface Theme {
  bg: BgColors;
  line: LineColors;
  text: TextColors;
  severity: SeverityColors;
  status: StatusColors;
}

// ── Dark theme (primary) ─────────────────────────────────────

export const darkTheme: Theme = {
  bg: {
    base: '#131A21',
    raised: '#1C252E',
    sunken: '#0E1419',
  },
  line: {
    hairline: '#2B3742',
    strong: '#41505C',
  },
  text: {
    primary: '#E7EDF1',
    secondary: '#9DAEBB',
    faint: '#6B7C89',
  },
  severity: {
    low: '#6E93A8',
    medium: '#D9A038',
    high: '#DE6B1E',
    critical: '#D33B31',
  },
  status: {
    clear: '#5B9E78',
    offline: '#7E8C98',
  },
};

// ── Light theme ──────────────────────────────────────────────

export const lightTheme: Theme = {
  bg: {
    base: '#F1F4F6',
    raised: '#FFFFFF',
    sunken: '#E3E9ED',
  },
  line: {
    hairline: '#D2DAE0',
    strong: '#93A4B1',
  },
  text: {
    primary: '#141C23',
    secondary: '#54646F',
    faint: '#8493A0',
  },
  severity: {
    low: '#4A7186',
    medium: '#A97620',
    high: '#B45210',
    critical: '#AE2A22',
  },
  status: {
    clear: '#5B9E78',
    offline: '#7E8C98',
  },
};

// ── Typography ───────────────────────────────────────────────

const SYSTEM_FONT_STACK =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export interface TypeToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: number;
  fontFamily: string;
  fontVariantNumeric: string;
}

export interface Typography {
  /** Home status only — 40/44 semibold */
  display: TypeToken;
  /** Alert headline — 28/34 semibold */
  title: TypeToken;
  /** Section, card title — 20/26 semibold */
  heading: TypeToken;
  /** Guidance text — 17/25 regular */
  body: TypeToken;
  /** Emphasis — 17/25 semibold */
  bodyStrong: TypeToken;
  /** Timestamps, source — 14/19 regular */
  meta: TypeToken;
  /** Trust label only — 12/16 semibold */
  micro: TypeToken;
}

const token = (
  fontSize: number,
  lineHeight: number,
  fontWeight: number,
): TypeToken => ({
  fontSize,
  lineHeight,
  fontWeight,
  fontFamily: SYSTEM_FONT_STACK,
  fontVariantNumeric: 'tabular-nums',
});

export const typography: Typography = {
  display: token(40, 44, 600),
  title: token(28, 34, 600),
  heading: token(20, 26, 600),
  body: token(17, 25, 400),
  bodyStrong: token(17, 25, 600),
  meta: token(14, 19, 400),
  micro: token(12, 16, 600),
};

// ── Spacing ──────────────────────────────────────────────────

export interface Spacing {
  /** Base 4-pt scale */
  scale: readonly [4, 8, 12, 16, 24, 32, 48, 64];

  /** Named semantic values */
  screenGutter: 16;
  cardPadding: 16;
  alertCardPadding: 20;
  sectionGap: 32;
  minTapTarget: 48;
}

export const spacing: Spacing = {
  scale: [4, 8, 12, 16, 24, 32, 48, 64] as const,

  screenGutter: 16,
  cardPadding: 16,
  alertCardPadding: 20,
  sectionGap: 32,
  minTapTarget: 48,
};

// ── Radius ───────────────────────────────────────────────────

export interface Radius {
  card: number;
  chip: number;
  /** Banners bleed full-width — no rounding */
  banner: number;
}

export const radius: Radius = {
  card: 8,
  chip: 4,
  banner: 0,
};
