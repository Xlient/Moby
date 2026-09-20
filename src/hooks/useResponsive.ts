import { useSyncExternalStore } from 'react';
import { typography, spacing } from '@/theme/tokens';
import type { TypeToken } from '@/theme/tokens';

// ── Breakpoints ──────────────────────────────────────────────

export type Breakpoint = 'compact' | 'regular' | 'wide' | 'tablet';

function getBreakpoint(w: number): Breakpoint {
  if (w < 360) return 'compact';
  if (w >= 768) return 'tablet';
  if (w >= 430) return 'wide';
  return 'regular';
}

// ── Subscribe to viewport width changes ──────────────────────

let cachedBreakpoint: Breakpoint = getBreakpoint(
  typeof window !== 'undefined' ? window.innerWidth : 390,
);

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): Breakpoint {
  return cachedBreakpoint;
}

function getServerSnapshot(): Breakpoint {
  return 'regular';
}

if (typeof window !== 'undefined') {
  const update = () => {
    const next = getBreakpoint(window.innerWidth);
    if (next !== cachedBreakpoint) {
      cachedBreakpoint = next;
      listeners.forEach((cb) => cb());
    }
  };
  window.addEventListener('resize', update, { passive: true });
}

// ── Hook ─────────────────────────────────────────────────────

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ── Responsive token overrides ───────────────────────────────

const compactToken = (
  fontSize: number,
  lineHeight: number,
  fontWeight: number,
): TypeToken => ({
  fontSize,
  lineHeight,
  fontWeight,
  fontFamily: typography.body.fontFamily,
  fontVariantNumeric: 'tabular-nums',
});

interface ResponsiveTokens {
  bp: Breakpoint;
  gutter: number;
  cardPadding: number;
  sectionGap: number;
  maxContent: number | undefined;
  title: TypeToken;
  heading: TypeToken;
}

function tokensForBreakpoint(bp: Breakpoint): ResponsiveTokens {
  switch (bp) {
    case 'compact':
      return {
        bp,
        gutter: 12,
        cardPadding: 12,
        sectionGap: 20,
        maxContent: undefined,
        title: compactToken(22, 28, 600),
        heading: compactToken(18, 24, 600),
      };
    case 'regular':
    case 'wide':
      return {
        bp,
        gutter: spacing.screenGutter,
        cardPadding: spacing.cardPadding,
        sectionGap: spacing.sectionGap,
        maxContent: undefined,
        title: typography.title,
        heading: typography.heading,
      };
    case 'tablet':
      return {
        bp,
        gutter: 24,
        cardPadding: spacing.cardPadding,
        sectionGap: spacing.sectionGap,
        maxContent: 680,
        title: typography.title,
        heading: typography.heading,
      };
  }
}

export function useResponsive(): ResponsiveTokens {
  const bp = useBreakpoint();
  return tokensForBreakpoint(bp);
}
