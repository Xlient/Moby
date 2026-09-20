import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { PaperProvider } from 'react-native-paper';
import { lightTheme, darkTheme } from './tokens';
import { paperLightTheme, paperDarkTheme } from './paperTheme';
import type { Theme } from './tokens';

export interface ThemeContextValue {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const DARK_MQ = '(prefers-color-scheme: dark)';

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(DARK_MQ).matches;
}

function applyRootMeta(isDark: boolean): void {
  if (typeof document === 'undefined') return;

  const t = isDark ? darkTheme : lightTheme;

  document.documentElement.setAttribute(
    'data-theme',
    isDark ? 'dark' : 'light',
  );

  const root = document.documentElement.style;
  root.setProperty('--focus-ring', t.severity.low);
  root.setProperty('--scrollbar-thumb', t.line.hairline);
  document.body.style.backgroundColor = t.bg.base;
  document.body.style.color = t.text.primary;

  let meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = t.bg.base;
}

export interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [isDark, setIsDark] = useState<boolean>(getSystemPrefersDark);
  const [userOverride, setUserOverride] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia(DARK_MQ);
    const handler = (e: MediaQueryListEvent) => {
      if (!userOverride) {
        setIsDark(e.matches);
      }
    };

    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [userOverride]);

  useEffect(() => {
    applyRootMeta(isDark);
  }, [isDark]);

  const toggleTheme = useCallback(() => {
    setUserOverride(true);
    setIsDark((prev) => !prev);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: isDark ? darkTheme : lightTheme,
      isDark,
      toggleTheme,
    }),
    [isDark, toggleTheme],
  );

  const paperTheme = isDark ? paperDarkTheme : paperLightTheme;

  return (
    <ThemeContext.Provider value={value}>
      <PaperProvider theme={paperTheme}>
        {children}
      </PaperProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === undefined) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return ctx;
}
