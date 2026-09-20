import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { lightTheme, darkTheme } from './tokens';
import type { Theme } from './tokens';

// ── Public hook return type ──────────────────────────────────

export interface ThemeContextValue {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
}

// ── Context (undefined sentinel — forces useTheme to guard) ──

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// ── Helpers ──────────────────────────────────────────────────

const DARK_MQ = '(prefers-color-scheme: dark)';

/** Read system preference. SSR-safe: defaults to light. */
function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(DARK_MQ).matches;
}

/**
 * Set `data-theme` on <html> and update the `<meta name="theme-color">`
 * tag so the browser chrome matches the app background.
 */
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

// ── Provider ─────────────────────────────────────────────────

export interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Provides the current `Theme` to the tree.
 *
 * Defaults to **light** (the primary theme per the design doc) and
 * reacts to the system `prefers-color-scheme` media query so the
 * app follows OS-level appearance changes.
 */
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

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === undefined) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return ctx;
}
