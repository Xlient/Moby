import type { ReactNode } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeContext';
import { spacing } from '@/theme/tokens';

interface Tab {
  id: string;
  label: string;
  icon: (color: string) => ReactNode;
}

interface BottomTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  showAssistant?: boolean;
}

function HomeIcon({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function AssistantIcon({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function SettingsIcon({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={2} />
      <Path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
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

  return (
    <View
      style={[
        styles.bar,
        { borderTopColor: theme.line.hairline, backgroundColor: theme.bg.raised },
      ]}
      accessibilityRole="tablist"
      accessibilityLabel="Main navigation"
    >
      {visibleTabs.map((tab) => {
        const active = activeTab === tab.id;
        const color = active ? theme.text.primary : theme.text.faint;
        return (
          <Pressable
            key={tab.id}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            onPress={() => onTabChange(tab.id)}
          >
            {tab.icon(color)}
            <Text style={[styles.label, { color }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: spacing.minTapTarget + 8,
    paddingVertical: spacing.scale[1],
    gap: 2,
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
});
