import Svg, { Circle, Path } from 'react-native-svg';

interface MobyMarkProps {
  size: number;
  /** `onDark` for navy surfaces (the default), `onLight` for light ones. */
  tone?: 'onDark' | 'onLight';
}

// Same geometry as assets/brand/moby-mark.svg (1024 box). Fixed colours: the mark
// is a logo, not chrome, so it doesn't follow the theme beyond the two tones.
const TONES = {
  onDark: { outer: '#FFD34D', inner: '#2DD4BF', person: '#F4F7FA' },
  onLight: { outer: '#F2B705', inner: '#0B7A70', person: '#0B1F33' },
} as const;

export const MARK_PATHS = {
  outer: 'M246.1 603.9 A270 270 0 1 1 777.9 603.9',
  inner: 'M335 588.5 A180 180 0 1 1 689 588.5',
  body: 'M384.5 767 Q384.5 632 512 632 Q639.5 632 639.5 767 Z',
  head: { cx: 512, cy: 527, r: 71 },
} as const;

/** The Moby mark ("Sheltered"): a person under two arcs. Decorative, hidden from screen readers. */
export function MobyMark({ size, tone = 'onDark' }: MobyMarkProps) {
  const c = TONES[tone];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="200 220 624 600"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path d={MARK_PATHS.outer} stroke={c.outer} strokeWidth={60} strokeLinecap="round" fill="none" />
      <Path d={MARK_PATHS.inner} stroke={c.inner} strokeWidth={60} strokeLinecap="round" fill="none" />
      <Circle {...MARK_PATHS.head} fill={c.person} />
      <Path d={MARK_PATHS.body} fill={c.person} />
    </Svg>
  );
}
