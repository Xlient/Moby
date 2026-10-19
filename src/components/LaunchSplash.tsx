import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeContext';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useEmergencyAlert } from '@/hooks/useEmergencyAlert';
import { MARK_PATHS } from './MobyMark';

/** Matches app.json: splash.imageWidth, and render.js draws the mark at 0.9 of the image. */
const SPLASH_SIZE = 200;
const MARK_SCALE = 0.9;
/** Multiplies every timing: raise it to inspect the animation frame by frame. */
const PACE = 1;
const HOLD_MS = 1400 * PACE;
const FADE_MS = 250 * PACE;

/** One layer of the mark, drawn exactly where the native splash image draws it. */
function Layer({ children }: { children: ReactNode }) {
  const offset = 512 - 512 * MARK_SCALE;
  return (
    <Svg width={SPLASH_SIZE} height={SPLASH_SIZE} viewBox="0 0 1024 1024" style={StyleSheet.absoluteFill}>
      <G transform={`translate(${offset} ${offset}) scale(${MARK_SCALE})`}>{children}</G>
    </Svg>
  );
}

/**
 * The launch moment: picks up from the native splash (same navy, same mark, same place),
 * pulses the two arcs out, lifts the mark and writes "Moby" with the sunbeam underline,
 * then fades into the app. About 1.6 s, once per cold start.
 *
 * Never in the way: skipped under Reduce Motion, cut short the moment an official warning
 * covers this spot (emergency mode opens underneath), and a tap ends it.
 */
export function LaunchSplash() {
  const { theme } = useTheme();
  const reduceMotion = useReducedMotion();
  const { emergency } = useEmergencyAlert();
  const [done, setDone] = useState(false);

  const [inner] = useState(() => new Animated.Value(0));
  const [outer] = useState(() => new Animated.Value(0));
  const [lift] = useState(() => new Animated.Value(0));
  const [word] = useState(() => new Animated.Value(0));
  const [line] = useState(() => new Animated.Value(0));
  const [fade] = useState(() => new Animated.Value(1));

  const finish = useCallback(() => {
    Animated.timing(fade, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => setDone(true));
  }, [fade]);

  useEffect(() => {
    if (reduceMotion || emergency) return;
    const pulse = (v: Animated.Value) =>
      Animated.timing(v, { toValue: 1, duration: 450 * PACE, easing: Easing.out(Easing.quad), useNativeDriver: true });
    const anim = Animated.parallel([
      pulse(inner),
      Animated.sequence([Animated.delay(150 * PACE), pulse(outer)]),
      Animated.sequence([
        Animated.delay(300 * PACE),
        Animated.timing(lift, { toValue: 1, duration: 450 * PACE, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.sequence([Animated.delay(600 * PACE), Animated.timing(word, { toValue: 1, duration: 300 * PACE, useNativeDriver: true })]),
      Animated.sequence([
        Animated.delay(850 * PACE),
        Animated.timing(line, { toValue: 1, duration: 250 * PACE, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    ]);
    anim.start();
    const t = setTimeout(finish, HOLD_MS);
    return () => {
      anim.stop();
      clearTimeout(t);
    };
  }, [reduceMotion, emergency, inner, outer, lift, word, line, finish]);

  if (done || reduceMotion || emergency) return null;

  // Each arc swells and dims, then settles back: a signal going out.
  const arcStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 0.45, 1] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 1.1, 1] }) }],
  });
  const c = { outer: theme.brand.pop, inner: '#2DD4BF', person: theme.brand.onNavy };

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: '#0B1F33', opacity: fade }]}
      accessibilityLabel="Moby"
      accessibilityRole="image"
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={finish} accessibilityLabel="Skip" />
      <Animated.View
        pointerEvents="none"
        style={[styles.mark, { transform: [{ translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -36] }) }] }]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, arcStyle(outer)]}>
          <Layer>
            <Path d={MARK_PATHS.outer} stroke={c.outer} strokeWidth={60} strokeLinecap="round" fill="none" />
          </Layer>
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, arcStyle(inner)]}>
          <Layer>
            <Path d={MARK_PATHS.inner} stroke={c.inner} strokeWidth={60} strokeLinecap="round" fill="none" />
          </Layer>
        </Animated.View>
        <Layer>
          <Circle {...MARK_PATHS.head} fill={c.person} />
          <Path d={MARK_PATHS.body} fill={c.person} />
        </Layer>
      </Animated.View>
      <View pointerEvents="none" style={styles.wordmark}>
        <Animated.View
          style={{
            opacity: word,
            transform: [{ translateY: word.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
          }}
        >
          <Text style={[styles.word, { color: theme.brand.onNavy }]}>Moby</Text>
        </Animated.View>
        <Animated.View
          style={[styles.underline, { backgroundColor: theme.brand.pop, transform: [{ scaleX: line }] }]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    elevation: 10,
  },
  mark: {
    width: SPLASH_SIZE,
    height: SPLASH_SIZE,
  },
  wordmark: {
    position: 'absolute',
    top: '50%',
    marginTop: 28,
    alignItems: 'center',
  },
  word: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  underline: {
    width: 48,
    height: 4,
    borderRadius: 2,
    marginTop: 6,
    transformOrigin: 'left',
  },
});
