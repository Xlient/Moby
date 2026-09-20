import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { darkTheme, lightTheme } from './tokens';
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

/** Read system preference. SSR-safe: defaults to dark. */
function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia(DARK_MQ).matches;
}

/**
 * Set `data-theme` on <html> and update the `<meta name="theme-color">`
 * tag so the browser chrome matches the app background.
 */
function applyRootMeta(isDark: boolean): void {
  if (typeof document === 'undefined') return;

  // data-theme attribute
  document.documentElement.setAttribute(
    'data-theme',
    isDark ? 'dark' : 'light',
  );

  // meta theme-color
  const themeColor = isDark ? darkTheme.bg.base : lightTheme.bg.base;
  let meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = themeColor;
}

// ── Provider ─────────────────────────────────────────────────

export interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Provides the current `Theme` to the tree.
 *
 * Defaults to **dark** (the primary theme per the design doc) and
 * reacts to the system `prefers-color-scheme` media query so the
 * app follows OS-level appearance changes.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  // Initialise from system preference (dark wins when undetectable / SSR)
  const [isDark, setIsDark] = useState<boolean>(getSystemPrefersDark);

  // Track whether the user has explicitly toggled (overrides system pref)
  const [userOverride, setUserOverride] = useState<boolean>(false);

  // ── Sync with system preference when no manual override ────
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

  // ── Keep DOM in sync ───────────────────────────────────────
  useEffect(() => {
    applyRootMeta(isDark);
  }, [isDark]);

  // ── Toggle callback ────────────────────────────────────────
  const toggleTheme = useCallback(() => {
    setUserOverride(true);
    setIsDark((prev) => !prev);
  }, []);

  // ── Memoised context value ─────────────────────────────────
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

/**
 * Access the current theme, dark-mode flag, and toggle function.
 *
 * Must be called inside a `<ThemeProvider>`.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === undefined) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return ctx;
}
