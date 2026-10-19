import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, View } from 'react-native';
import { ThemeProvider, useTheme } from '@/theme/ThemeContext';
import { AuthProvider } from '@/auth/AuthContext';
import { UserLocationProvider } from '@/location/UserLocationContext';
import { App } from '@/App';
import { LaunchSplash } from '@/components/LaunchSplash';
import { applyApiOverride } from '@/api/apiOverride';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
      networkMode: 'offlineFirst',
    },
  },
});

void applyApiOverride(queryClient);

function ThemedShell() {
  const { theme, isDark } = useTheme();
  return (
    <View style={styles.safeArea}>
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: theme.bg.base }]}
        edges={['top', 'left', 'right', 'bottom']}
      >
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <App />
      </SafeAreaView>
      {/* Over the whole window, not the safe area, so it lines up with the native splash. */}
      <LaunchSplash />
    </View>
  );
}

export function Root() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <UserLocationProvider>
              <ThemedShell />
            </UserLocationProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
});
