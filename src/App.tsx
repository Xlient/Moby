import { useState, useCallback, type CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { BottomTabs } from '@/components/BottomTabs';
import { OfflineBanner } from '@/components/OfflineBanner';
import { HomeScreen } from '@/screens/HomeScreen';
import { AlertDetailScreen } from '@/screens/AlertDetailScreen';
import { MapScreen } from '@/screens/MapScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { GuidanceScreen } from '@/screens/GuidanceScreen';
import { ReportScreen } from '@/screens/ReportScreen';
import { SubscriptionsScreen } from '@/screens/SubscriptionsScreen';

type Screen =
  | { name: 'home' }
  | { name: 'map' }
  | { name: 'settings' }
  | { name: 'alert-detail'; alertId: string }
  | { name: 'guidance' }
  | { name: 'report' }
  | { name: 'subscriptions' };

function getActiveTab(screen: Screen): string {
  switch (screen.name) {
    case 'home':
    case 'alert-detail':
    case 'guidance':
    case 'report':
      return 'home';
    case 'map':
      return 'map';
    case 'settings':
    case 'subscriptions':
      return 'settings';
  }
}

const SHOW_TABS: Set<string> = new Set(['home', 'map', 'settings']);

export function App() {
  const { theme } = useTheme();
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  const navigateHome = useCallback(() => setScreen({ name: 'home' }), []);
  const navigateToAlert = useCallback((alertId: string) => {
    setScreen({ name: 'alert-detail', alertId });
  }, []);
  const navigateToGuidance = useCallback(() => setScreen({ name: 'guidance' }), []);
  const navigateToReport = useCallback(() => setScreen({ name: 'report' }), []);

  const handleTabChange = useCallback((tab: string) => {
    switch (tab) {
      case 'home':
        setScreen({ name: 'home' });
        break;
      case 'map':
        setScreen({ name: 'map' });
        break;
      case 'settings':
        setScreen({ name: 'settings' });
        break;
    }
  }, []);

  const styles: Record<string, CSSProperties> = {
    shell: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: theme.bg.base,
      maxWidth: 480,
      margin: '0 auto',
      position: 'relative',
      overflow: 'hidden',
    },
    content: {
      flex: 1,
      overflow: 'hidden',
    },
  };

  const showTabs = SHOW_TABS.has(screen.name);

  return (
    <div style={styles.shell}>
      <OfflineBanner />
      <div style={styles.content}>
        {screen.name === 'home' && (
          <HomeScreen
            onAlertPress={navigateToAlert}
            onGuidancePress={navigateToGuidance}
            onReportPress={navigateToReport}
          />
        )}
        {screen.name === 'alert-detail' && (
          <AlertDetailScreen
            alertId={screen.alertId}
            onBack={navigateHome}
          />
        )}
        {screen.name === 'map' && <MapScreen />}
        {screen.name === 'settings' && <SettingsScreen />}
        {screen.name === 'guidance' && (
          <GuidanceScreen onBack={navigateHome} />
        )}
        {screen.name === 'report' && (
          <ReportScreen onBack={navigateHome} />
        )}
        {screen.name === 'subscriptions' && (
          <SubscriptionsScreen onBack={() => setScreen({ name: 'settings' })} />
        )}
      </div>
      {showTabs && (
        <BottomTabs
          activeTab={getActiveTab(screen)}
          onTabChange={handleTabChange}
        />
      )}
    </div>
  );
}
