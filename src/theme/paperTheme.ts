import {
  MD3LightTheme,
  MD3DarkTheme,
  configureFonts,
} from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';
import { lightTheme, darkTheme } from './tokens';

// fontFamily is inherited from Paper's platform defaults (Roboto on Android,
// System on iOS, system-ui stack on web).
const baseFont = {
  letterSpacing: 0,
};

const fonts = configureFonts({
  config: {
    displayLarge:  { ...baseFont, fontSize: 26, lineHeight: 32, fontWeight: '600' },
    displayMedium: { ...baseFont, fontSize: 26, lineHeight: 32, fontWeight: '600' },
    displaySmall:  { ...baseFont, fontSize: 19, lineHeight: 25, fontWeight: '600' },
    headlineLarge: { ...baseFont, fontSize: 26, lineHeight: 32, fontWeight: '600' },
    headlineMedium:{ ...baseFont, fontSize: 19, lineHeight: 25, fontWeight: '600' },
    headlineSmall: { ...baseFont, fontSize: 17, lineHeight: 25, fontWeight: '600' },
    titleLarge:    { ...baseFont, fontSize: 26, lineHeight: 32, fontWeight: '600' },
    titleMedium:   { ...baseFont, fontSize: 19, lineHeight: 25, fontWeight: '600' },
    titleSmall:    { ...baseFont, fontSize: 17, lineHeight: 25, fontWeight: '600' },
    bodyLarge:     { ...baseFont, fontSize: 17, lineHeight: 25, fontWeight: '400' },
    bodyMedium:    { ...baseFont, fontSize: 14, lineHeight: 19, fontWeight: '400' },
    bodySmall:     { ...baseFont, fontSize: 13, lineHeight: 17, fontWeight: '500' },
    labelLarge:    { ...baseFont, fontSize: 17, lineHeight: 25, fontWeight: '600' },
    labelMedium:   { ...baseFont, fontSize: 14, lineHeight: 19, fontWeight: '400' },
    labelSmall:    { ...baseFont, fontSize: 13, lineHeight: 17, fontWeight: '500' },
  },
});

function buildColors(t: typeof lightTheme, isDark: boolean) {
  return {
    primary: t.accent.calm,
    primaryContainer: t.bg.recessed,
    secondary: t.text.secondary,
    secondaryContainer: t.bg.recessed,
    tertiary: t.text.secondary,
    tertiaryContainer: t.bg.recessed,
    surface: t.bg.raised,
    surfaceVariant: t.bg.recessed,
    surfaceDisabled: t.bg.recessed,
    background: t.bg.base,
    error: t.text.secondary,
    errorContainer: t.bg.recessed,
    onPrimary: isDark ? t.bg.base : '#FFFFFF',
    onPrimaryContainer: t.text.primary,
    onSecondary: isDark ? t.bg.base : '#FFFFFF',
    onSecondaryContainer: t.text.primary,
    onTertiary: isDark ? t.bg.base : '#FFFFFF',
    onTertiaryContainer: t.text.primary,
    onSurface: t.text.primary,
    onSurfaceVariant: t.text.secondary,
    onSurfaceDisabled: t.text.faint,
    onError: isDark ? t.bg.base : '#FFFFFF',
    onErrorContainer: t.text.primary,
    onBackground: t.text.primary,
    outline: t.line.hairline,
    outlineVariant: t.line.hairline,
    inverseSurface: isDark ? lightTheme.bg.raised : darkTheme.bg.raised,
    inverseOnSurface: isDark ? lightTheme.text.primary : darkTheme.text.primary,
    inversePrimary: isDark ? lightTheme.accent.calm : darkTheme.accent.calm,
    shadow: isDark ? '#000000' : '#000000',
    scrim: '#000000',
    backdrop: 'rgba(0, 0, 0, 0.4)',
    elevation: {
      level0: 'transparent',
      level1: t.bg.raised,
      level2: t.bg.raised,
      level3: t.bg.raised,
      level4: t.bg.raised,
      level5: t.bg.raised,
    },
  };
}

export const paperLightTheme: MD3Theme = {
  ...MD3LightTheme,
  dark: false,
  roundness: 8,
  fonts,
  colors: buildColors(lightTheme, false),
};

export const paperDarkTheme: MD3Theme = {
  ...MD3DarkTheme,
  dark: true,
  roundness: 8,
  fonts,
  colors: buildColors(darkTheme, true),
};
