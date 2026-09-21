import { useState, useCallback, useEffect, type CSSProperties } from 'react';
import { useTheme } from '@/theme/ThemeContext';
import { useResponsive } from '@/hooks/useResponsive';
import { useAuth } from '@/auth/AuthContext';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { api } from '@/api/client';
import { typography } from '@/theme/tokens';
import { BottomTabs } from '@/components/BottomTabs';
import { AuthScreen } from '@/screens/AuthScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { AlertDetailScreen } from '@/screens/AlertDetailScreen';
import { MapScreen } from '@/screens/MapScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { AssistantScreen } from '@/screens/AssistantScreen';
import { GuidanceScreen } from '@/screens/GuidanceScreen';
import { ReportScreen } from '@/screens/ReportScreen';
import { SubscriptionsScreen } from '@/screens/SubscriptionsScreen';
import { TrustReviewScreen } from '@/screens/TrustReviewScreen';
import { AlertCardReviewScreen } from '@/screens/AlertCardReviewScreen';

type Screen =
  | { name: 'home' }
  | { name: 'assistant' }
  | { name: 'settings' }
  | { name: 'map' }
  | { name: 'alert-detail'; alertId: string }
  | { name: 'guidance' }
  | { name: 'report' }
  | { name: 'subscriptions' }
  | { name: 'trust-review' }
  | { name: 'alert-card-review' };

function getActiveTab(screen: Screen): string {
  switch (screen.name) {
    case 'home':
    case 'alert-detail':
    case 'guidance':
    case 'report':
    case 'map':
    case 'trust-review':
    case 'alert-card-review':
      return 'home';
    case 'assistant':
      return 'assistant';
    case 'settings':
    case 'subscriptions':
      return 'settings';
  }
}

const SHOW_TABS: Set<string> = new Set(['home', 'assistant', 'settings']);

export function App() {
  const { theme } = useTheme();
  const { maxContent } = useResponsive();
  const { user, loading: authLoading, getIdToken, isConfigured: authConfigured } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  const showAssistant = isEnabled('on_device_assistant');

  useEffect(() => {
    if (window.location.hash === '#dev-cards') {
      setScreen({ name: 'alert-card-review' });
    }
  }, []);

  useEffect(() => {
    api.setTokenProvider(user ? getIdToken : null);
  }, [user, getIdToken]);

  const navigateHome = useCallback(() => setScreen({ name: 'home' }), []);
  const navigateToAlert = useCallback((alertId: string) => {
    setScreen({ name: 'alert-detail', alertId });
  }, []);
  const navigateToReport = useCallback(() => setScreen({ name: 'report' }), []);
  const navigateToMap = useCallback(() => setScreen({ name: 'map' }), []);

  const handleTabChange = useCallback((tab: string) => {
    switch (tab) {
      case 'home':
        setScreen({ name: 'home' });
        break;
      case 'assistant':
        setScreen({ name: 'assistant' });
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
      maxWidth: maxContent,
      margin: maxContent ? '0 auto' : undefined,
      position: 'relative',
      overflow: 'hidden',
    },
    content: {
      flex: 1,
      overflow: 'hidden',
    },
    loadingContainer: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
    },
    loadingText: {
      ...typography.body,
      color: theme.text.faint,
      fontVariantNumeric: undefined,
    },
  };

  if (authLoading) {
    return (
      <div style={styles.shell}>
        <div style={styles.loadingContainer}>
          <p style={styles.loadingText}>Loading...</p>
        </div>
      </div>
    );
  }

  if (authConfigured && !user) {
    return (
      <div style={styles.shell}>
        <AuthScreen />
      </div>
    );
  }

  const showTabs = SHOW_TABS.has(screen.name);

  return (
    <div style={styles.shell}>
      <div style={styles.content}>
        {screen.name === 'home' && (
          <HomeScreen
            onReportPress={navigateToReport}
            onAlertPress={navigateToAlert}
            onSeeAllPress={navigateHome}
            onMapPress={navigateToMap}
          />
        )}
        {screen.name === 'alert-detail' && (
          <AlertDetailScreen
            alertId={screen.alertId}
            onBack={navigateHome}
          />
        )}
        {screen.name === 'map' && <MapScreen />}
        {screen.name === 'assistant' && showAssistant && <AssistantScreen />}
        {screen.name === 'settings' && (
          <SettingsScreen
            onTrustReview={() => setScreen({ name: 'trust-review' })}
          />
        )}
        {screen.name === 'guidance' && (
          <GuidanceScreen onBack={navigateHome} />
        )}
        {screen.name === 'report' && (
          <ReportScreen onBack={navigateHome} />
        )}
        {screen.name === 'subscriptions' && (
          <SubscriptionsScreen onBack={() => setScreen({ name: 'settings' })} />
        )}
        {screen.name === 'trust-review' && (
          <TrustReviewScreen onBack={navigateHome} />
        )}
        {screen.name === 'alert-card-review' && (
          <AlertCardReviewScreen onBack={navigateHome} />
        )}
      </div>
      {showTabs && (
        <BottomTabs
          activeTab={getActiveTab(screen)}
          onTabChange={handleTabChange}
          showAssistant={showAssistant}
        />
      )}
    </div>
  );
}
