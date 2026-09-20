import type { CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing, radius } from '@/theme/tokens';

export function SettingsScreen() {
  const { theme, isDark, toggleTheme } = useTheme();

  const styles: Record<string, CSSProperties> = {
    container: {
      padding: spacing.screenGutter,
      overflowY: 'auto',
      height: '100%',
    },
    title: {
      ...typography.title,
      color: theme.text.primary,
      margin: `0 0 ${spacing.sectionGap}px 0`,
      fontVariantNumeric: undefined,
    },
    section: {
      marginBottom: spacing.sectionGap,
    },
    sectionHeading: {
      ...typography.heading,
      color: theme.text.primary,
      margin: `0 0 ${spacing.scale[3]}px 0`,
      fontVariantNumeric: undefined,
    },
    row: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: spacing.minTapTarget,
      padding: `${spacing.scale[2]}px 0`,
      borderBottom: `1px solid ${theme.line.hairline}`,
    },
    rowLabel: {
      ...typography.body,
      color: theme.text.primary,
      fontVariantNumeric: undefined,
    },
    rowValue: {
      ...typography.body,
      color: theme.text.secondary,
      fontVariantNumeric: undefined,
    },
    toggleTrack: {
      width: 48,
      height: 28,
      borderRadius: 14,
      backgroundColor: isDark ? theme.text.faint : theme.line.strong,
      position: 'relative',
      cursor: 'pointer',
      border: 'none',
      padding: 0,
      minWidth: spacing.minTapTarget,
      minHeight: spacing.minTapTarget,
      display: 'flex',
      alignItems: 'center',
    },
    toggleThumb: {
      position: 'absolute',
      top: 2,
      left: isDark ? 22 : 2,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: '#FFFFFF',
      transition: 'left 0.2s ease',
      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    },
    card: {
      backgroundColor: theme.bg.raised,
      borderRadius: radius.card,
      padding: spacing.cardPadding,
    },
    meta: {
      ...typography.meta,
      color: theme.text.faint,
      marginTop: spacing.sectionGap,
    },
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Settings</h1>

      <div style={styles.section}>
        <h2 style={styles.sectionHeading}>Appearance</h2>
        <div style={styles.card}>
          <div style={styles.row}>
            <span style={styles.rowLabel}>Dark mode</span>
            <button
              style={styles.toggleTrack}
              onClick={toggleTheme}
              role="switch"
              aria-checked={isDark}
              aria-label="Toggle dark mode"
            >
              <div style={styles.toggleThumb} />
            </button>
          </div>
        </div>
      </div>

      <div style={styles.section}>
        <h2 style={styles.sectionHeading}>About</h2>
        <div style={styles.card}>
          <div style={styles.row}>
            <span style={styles.rowLabel}>Version</span>
            <span style={styles.rowValue}>0.1.0</span>
          </div>
          <div style={{ ...styles.row, borderBottom: 'none' }}>
            <span style={styles.rowLabel}>Region</span>
            <span style={styles.rowValue}>US</span>
          </div>
        </div>
      </div>

      <p style={styles.meta}>
        Early Warning System. Data from NOAA, USGS, and community reports.
      </p>
    </div>
  );
}
