import { useWindowDimensions } from 'react-native';
import { typography, spacing, typeToken } from '@/theme/tokens';
import type { TypeToken } from '@/theme/tokens';

// ── Breakpoints ──────────────────────────────────────────────

export type Breakpoint = 'compact' | 'regular' | 'wide' | 'tablet';

function getBreakpoint(w: number): Breakpoint {
  if (w < 360) return 'compact';
  if (w >= 768) return 'tablet';
  if (w >= 430) return 'wide';
  return 'regular';
}

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  return getBreakpoint(width);
}

// ── Responsive token overrides ───────────────────────────────

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
        title: typeToken(22, 28, '600'),
        heading: typeToken(18, 24, '600'),
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
