import { useState, useCallback, useEffect } from 'react';
import { View, BackHandler, Platform, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/theme/ThemeContext';
import { useResponsive } from '@/hooks/useResponsive';
import { useAuth } from '@/auth/AuthContext';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { api } from '@/api/client';
import { useBackendSync } from '@/sync/useBackendSync';
import { syncGuidance } from '@/guidance/guidanceStore';
import { regionsToSync } from '@/guidance/regions';
import { countryAt } from '@/data/emergencyNumbers';
import { useUserCenterPassive } from '@/location/UserLocationContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import type { HazardType, RegionCode } from '@/api/types';
import { typography } from '@/theme/tokens';
import { BottomTabs } from '@/components/BottomTabs';
import { AuthScreen } from '@/screens/AuthScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { AlertDetailScreen } from '@/screens/AlertDetailScreen';
import { AlertsScreen } from '@/screens/AlertsScreen';
import { MapScreen } from '@/screens/MapScreen';
import { MapLibreMapScreen } from '@/screens/MapLibreMapScreen';
import { useMapEngine } from '@/maps/mapEngine';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { AssistantScreen } from '@/screens/AssistantScreen';
import { GuidanceScreen } from '@/screens/GuidanceScreen';
import { ReportScreen } from '@/screens/ReportScreen';
import { SubscriptionsScreen } from '@/screens/SubscriptionsScreen';
import { AlertPreferencesScreen } from '@/screens/AlertPreferencesScreen';
import { PrivacyScreen } from '@/screens/PrivacyScreen';
import { NearbyMeshScreen } from '@/screens/NearbyMeshScreen';
import { EmergencyScreen } from '@/screens/EmergencyScreen';
import { HelpScreen } from '@/screens/HelpScreen';
import { RouteCheckScreen } from '@/screens/RouteCheckScreen';
import { OfflineAnswersScreen } from '@/screens/OfflineAnswersScreen';
import { useModelState } from '@/ondevice/useModel';
import { useMeshLifecycle } from '@/mesh/useMeshLifecycle';
import { TrustReviewScreen } from '@/screens/TrustReviewScreen';
import { AlertCardReviewScreen } from '@/screens/AlertCardReviewScreen';
import { MyReportsScreen } from '@/screens/MyReportsScreen';
import { AboutScreen } from '@/screens/AboutScreen';
import { TripBriefScreen } from '@/screens/TripBriefScreen';
import { useTripPacks } from '@/trips/tripPacks';
import { OnboardingScreen, hasSeenOnboarding, resetOnboarding } from '@/screens/OnboardingScreen';

type Screen =
  | { name: 'home' }
  | { name: 'assistant' }
  | { name: 'settings' }
  | { name: 'map' }
  | { name: 'alerts' }
  | { name: 'alert-detail'; alertId: string }
  | { name: 'emergency'; alertId: string }
  | { name: 'help' }
  | { name: 'route-check' }
  | { name: 'guidance'; hazard?: HazardType }
  | { name: 'report' }
  | { name: 'my-reports' }
  | { name: 'about' }
  | { name: 'subscriptions' }
  | { name: 'alert-preferences' }
  | { name: 'privacy' }
  | { name: 'nearby-mesh' }
  | { name: 'offline-answers' }
  | { name: 'trust-review' }
  | { name: 'alert-card-review' }
  | { name: 'trip'; point?: { lat: number; lon: number } };

function getActiveTab(screen: Screen): string {
  switch (screen.name) {
    case 'home':
    case 'alerts':
    case 'alert-detail':
    case 'emergency':
    case 'help':
    case 'route-check':
    case 'guidance':
    case 'report':
    case 'my-reports':
    case 'map':
    case 'trust-review':
    case 'alert-card-review':
    case 'trip':
      return 'home';
    case 'assistant':
      return 'assistant';
    case 'settings':
    case 'subscriptions':
    case 'alert-preferences':
    case 'privacy':
    case 'nearby-mesh':
    case 'offline-answers':
    case 'about':
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
  const [onboarded, setOnboarded] = useState(hasSeenOnboarding);

  const modelState = useModelState();
  // Offline the server's flags can't be fetched, so a downloaded offline model also keeps Ask Moby visible.
  const showAssistant = isEnabled('ask_moby') || isEnabled('on_device_assistant') || modelState.kind === 'ready';
  // Saved trip packs must open with no signal, when /config (and so the flag) can't load.
  const tripPacks = useTripPacks();
  const showTrip = isEnabled('trip_briefing') || tripPacks.length > 0;
  useMeshLifecycle();

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

  // Push token, preferences and "near me" to the server; notification taps open the alert.
  useBackendSync(navigateToAlert);

  // Keep offline guidance fresh whenever we're online (cheap when nothing changed): the
  // US bundle, plus the bundle for the country we're in (only from a real fix, never the
  // demo city). Passive: guidance never triggers the location prompt.
  const isOnline = useOnlineStatus();
  const [mapEngine] = useMapEngine();
  const center = useUserCenterPassive();
  const country = center.source === 'device' ? countryAt(center.lat, center.lon) : undefined;
  const regions = regionsToSync(country).join(',');
  useEffect(() => {
    if (isOnline) regions.split(',').forEach((r) => syncGuidance(r as RegionCode));
  }, [isOnline, regions]);
  const openGuidance = useCallback((hazard?: HazardType) => push({ name: 'guidance', hazard }), [push]);
  const openTrip = useCallback(
    (point?: { lat: number; lon: number }) => push({ name: 'trip', point }),
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

  if (!onboarded) {
    return (
      <View style={shellStyle}>
        <OnboardingScreen onDone={() => setOnboarded(true)} />
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
            onGuidancePress={() => openGuidance()}
            onMyReportsPress={() => push({ name: 'my-reports' })}
            onEmergencyPress={(alertId) => push({ name: 'emergency', alertId })}
            onHelpPress={() => push({ name: 'help' })}
            onRouteCheckPress={() => push({ name: 'route-check' })}
            onTripPress={showTrip ? () => openTrip() : undefined}
          />
        )}
        {screen.name === 'alerts' && (
          <AlertsScreen onBack={goBack} onAlertPress={navigateToAlert} />
        )}
        {screen.name === 'alert-detail' && (
          <AlertDetailScreen alertId={screen.alertId} onBack={goBack} onGuidance={openGuidance} />
        )}
        {screen.name === 'emergency' && (
          <EmergencyScreen
            alertId={screen.alertId}
            onClose={goBack}
            onHelp={() => push({ name: 'help' })}
            onAlertDetail={navigateToAlert}
            onGuidance={openGuidance}
          />
        )}
        {screen.name === 'help' && <HelpScreen onBack={goBack} />}
        {screen.name === 'route-check' && <RouteCheckScreen onBack={goBack} onAlertPress={navigateToAlert} />}
        {screen.name === 'map' &&
          (mapEngine === 'maplibre' ? (
            <MapLibreMapScreen
              onBack={goBack}
              onAlertDetail={navigateToAlert}
              onLongPressPoint={showTrip ? openTrip : undefined}
            />
          ) : (
            <MapScreen onBack={goBack} onAlertDetail={navigateToAlert} onLongPressPoint={showTrip ? openTrip : undefined} />
          ))}
        {screen.name === 'assistant' && showAssistant && (
          <AssistantScreen onTripPress={showTrip ? () => openTrip() : undefined} />
        )}
        {screen.name === 'trip' && (
          <TripBriefScreen onBack={goBack} initialPoint={screen.point} onAlertPress={navigateToAlert} />
        )}
        {screen.name === 'settings' && (
          <SettingsScreen
            onSubscriptions={() => push({ name: 'subscriptions' })}
            onAlertPreferences={() => push({ name: 'alert-preferences' })}
            onPrivacy={() => push({ name: 'privacy' })}
            onNearbyMesh={() => push({ name: 'nearby-mesh' })}
            onOfflineAnswers={() => push({ name: 'offline-answers' })}
            onAbout={() => push({ name: 'about' })}
            onCardReview={() => push({ name: 'alert-card-review' })}
            onTrustReview={() => push({ name: 'trust-review' })}
          />
        )}
        {screen.name === 'guidance' && <GuidanceScreen onBack={goBack} initialHazard={screen.hazard} />}
        {screen.name === 'report' && <ReportScreen onBack={goBack} />}
        {screen.name === 'my-reports' && (
          <MyReportsScreen onBack={goBack} onNewReport={() => push({ name: 'report' })} />
        )}
        {screen.name === 'about' && (
          <AboutScreen
            onBack={goBack}
            onReplayIntro={() => {
              resetOnboarding();
              setStack([{ name: 'home' }]);
              setOnboarded(false);
            }}
          />
        )}
        {screen.name === 'subscriptions' && <SubscriptionsScreen onBack={goBack} />}
        {screen.name === 'alert-preferences' && <AlertPreferencesScreen onBack={goBack} />}
        {screen.name === 'privacy' && <PrivacyScreen onBack={goBack} />}
        {screen.name === 'nearby-mesh' && <NearbyMeshScreen onBack={goBack} />}
        {screen.name === 'offline-answers' && <OfflineAnswersScreen onBack={goBack} />}
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
