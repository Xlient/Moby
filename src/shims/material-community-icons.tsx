import { Text } from 'react-native';

/**
 * Web stand-in for `react-native-vector-icons/MaterialCommunityIcons`.
 *
 * react-native-paper optionally require()s that package, and its published source
 * contains Flow syntax that Vite's dependency pre-bundler cannot parse, which stops
 * the dev server from starting. We alias it here (see vite.config.ts) and render a
 * plain placeholder glyph instead. Nothing in the app uses Paper icons yet; if that
 * changes, replace this with a real icon renderer.
 */
export default function MaterialCommunityIcons({
  color,
  size = 24,
}: {
  name?: string;
  color?: string;
  size?: number;
}) {
  return (
    <Text accessibilityElementsHidden importantForAccessibility="no" style={{ color, fontSize: size }}>
      {'□'}
    </Text>
  );
}
