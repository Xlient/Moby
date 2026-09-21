import { createContext, type ReactNode } from 'react';

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

export function SafeAreaProvider({ children }: { children: ReactNode }) {
  return <SafeAreaInsetsContext.Provider value={ZERO_INSETS}>{children}</SafeAreaInsetsContext.Provider>;
}

export function SafeAreaView({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useSafeAreaInsets() {
  return ZERO_INSETS;
}

export const SafeAreaInsetsContext = createContext(ZERO_INSETS);

export const initialWindowMetrics = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: ZERO_INSETS,
};
