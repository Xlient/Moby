import { useState, useCallback, useEffect } from 'react';
import { View, BackHandler, Platform, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
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
import { AlertsScreen } from '@/screens/AlertsScreen';
import { MapScreen } from '@/screens/MapScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { AssistantScreen } from '@/screens/AssistantScreen';
import { GuidanceScreen } from '@/screens/GuidanceScreen';
import { ReportScreen } from '@/screens/ReportScreen';
import { SubscriptionsScreen } from '@/screens/SubscriptionsScreen';
import { AlertPreferencesScreen } from '@/screens/AlertPreferencesScreen';
import { TrustReviewScreen } from '@/screens/TrustReviewScreen';
import { AlertCardReviewScreen } from '@/screens/AlertCardReviewScreen';

type Screen =
  | { name: 'home' }
  | { name: 'assistant' }
  | { name: 'settings' }
  | { name: 'map' }
  | { name: 'alerts' }
  | { name: 'alert-detail'; alertId: string }
  | { name: 'guidance' }
  | { name: 'report' }
  | { name: 'subscriptions' }
  | { name: 'alert-preferences' }
  | { name: 'trust-review' }
  | { name: 'alert-card-review' };

function getActiveTab(screen: Screen): string {
  switch (screen.name) {
    case 'home':
    case 'alerts':
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
    case 'alert-preferences':
      return 'settings';
  }
}

const SHOW_TABS: Set<string> = new Set(['home', 'assistant', 'settings']);

export function App() {
  const { theme } = useTheme();
  const { maxContent } = useResponsive();
  const { user, loading: authLoading, getIdToken, isConfigured: authConfigured } = useAuth();
  const { isEnabled } = useFeatureFlags();
  // A small stack: tabs reset it, stacked screens push onto it, Back pops.
  const [stack, setStack] = useState<Screen[]>([{ name: 'home' }]);
  const screen = stack[stack.length - 1]!;

  const showAssistant = isEnabled('on_device_assistant');

  const push = useCallback((next: Screen) => setStack((s) => [...s, next]), []);
  const goBack = useCallback(
    () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    [],
  );

  useEffect(() => {
    // Web-only dev shortcut: open /#dev-cards to jump to the card review sheet.
    if (Platform.OS === 'web' && window.location.hash === '#dev-cards') {
      setStack([{ name: 'home' }, { name: 'alert-card-review' }]);
    }
  }, []);

  useEffect(() => {
    api.setTokenProvider(user ? getIdToken : null);
  }, [user, getIdToken]);

  // Signing out (or in as someone else) starts fresh on Home.
  useEffect(() => {
    setStack([{ name: 'home' }]);
  }, [user?.uid]);

  const navigateToAlert = useCallback(
    (alertId: string) => push({ name: 'alert-detail', alertId }),
    [push],
  );

  const handleTabChange = useCallback((tab: string) => {
    switch (tab) {
      case 'home':
      case 'assistant':
      case 'settings':
        setStack([{ name: tab }]);
        break;
    }
  }, []);

  // Android hardware/gesture back: pop the stack; from a tab root other than
  // Home, go to Home; on Home, fall through to the default (exit).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        goBack();
        return true;
      }
      if (screen.name !== 'home') {
        setStack([{ name: 'home' }]);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, screen.name, goBack]);

  const shellStyle = [
    styles.shell,
    { backgroundColor: theme.bg.base, maxWidth: maxContent },
  ];

  if (authLoading) {
    return (
      <View style={shellStyle}>
        <View style={styles.loadingContainer}>
          <Text style={[typography.body, { color: theme.text.faint }]}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (authConfigured && !user) {
    return (
      <View style={shellStyle}>
        <AuthScreen />
      </View>
    );
  }

  const showTabs = SHOW_TABS.has(screen.name);

  return (
    <View style={shellStyle}>
      <View style={styles.content}>
        {screen.name === 'home' && (
          <HomeScreen
            onReportPress={() => push({ name: 'report' })}
            onAlertPress={navigateToAlert}
            onSeeAllPress={() => push({ name: 'alerts' })}
            onMapPress={() => push({ name: 'map' })}
          />
        )}
        {screen.name === 'alerts' && (
          <AlertsScreen onBack={goBack} onAlertPress={navigateToAlert} />
        )}
        {screen.name === 'alert-detail' && (
          <AlertDetailScreen alertId={screen.alertId} onBack={goBack} />
        )}
        {screen.name === 'map' && (
          <MapScreen onBack={goBack} onAlertDetail={navigateToAlert} />
        )}
        {screen.name === 'assistant' && showAssistant && <AssistantScreen />}
        {screen.name === 'settings' && (
          <SettingsScreen
            onSubscriptions={() => push({ name: 'subscriptions' })}
            onAlertPreferences={() => push({ name: 'alert-preferences' })}
            onCardReview={() => push({ name: 'alert-card-review' })}
            onTrustReview={() => push({ name: 'trust-review' })}
          />
        )}
        {screen.name === 'guidance' && <GuidanceScreen onBack={goBack} />}
        {screen.name === 'report' && <ReportScreen onBack={goBack} />}
        {screen.name === 'subscriptions' && <SubscriptionsScreen onBack={goBack} />}
        {screen.name === 'alert-preferences' && <AlertPreferencesScreen onBack={goBack} />}
        {screen.name === 'trust-review' && <TrustReviewScreen onBack={goBack} />}
        {screen.name === 'alert-card-review' && <AlertCardReviewScreen onBack={goBack} />}
      </View>
      {showTabs && (
        <BottomTabs
          activeTab={getActiveTab(screen)}
          onTabChange={handleTabChange}
          showAssistant={showAssistant}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    width: '100%',
    alignSelf: 'center',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    overflow: 'hidden',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
