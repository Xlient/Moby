import type { CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { typography, spacing } from '@/theme/tokens';

interface Tab {
  id: string;
  label: string;
  icon: (color: string) => React.ReactNode;
}

interface BottomTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  showAssistant?: boolean;
}

function HomeIcon({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AssistantIcon({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke={color} strokeWidth="2" />
      <path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const TABS: Tab[] = [
  { id: 'home', label: 'Home', icon: (c) => <HomeIcon color={c} /> },
  { id: 'assistant', label: 'Assistant', icon: (c) => <AssistantIcon color={c} /> },
  { id: 'settings', label: 'Settings', icon: (c) => <SettingsIcon color={c} /> },
];

export function BottomTabs({ activeTab, onTabChange, showAssistant = true }: BottomTabsProps) {
  const { theme } = useTheme();

  const visibleTabs = showAssistant
    ? TABS
    : TABS.filter((t) => t.id !== 'assistant');

  const styles: Record<string, CSSProperties> = {
    bar: {
      display: 'flex',
      justifyContent: 'space-around',
      alignItems: 'stretch',
      borderTop: `1px solid ${theme.line.hairline}`,
      backgroundColor: theme.bg.raised,
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    },
    tab: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
      minHeight: spacing.minTapTarget + 8,
      padding: `${spacing.scale[1]}px 0`,
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      gap: 2,
    },
    label: {
      fontSize: 11,
      fontWeight: 600,
      fontFamily: typography.body.fontFamily,
    },
  };

  return (
    <nav style={styles.bar} role="tablist" aria-label="Main navigation">
      {visibleTabs.map((tab) => {
        const active = activeTab === tab.id;
        const color = active ? theme.text.primary : theme.text.faint;
        return (
          <button
            key={tab.id}
            style={styles.tab}
            role="tab"
            aria-selected={active}
            aria-label={tab.label}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.icon(color)}
            <span style={{ ...styles.label, color }}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
