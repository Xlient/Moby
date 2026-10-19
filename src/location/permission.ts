import * as Location from 'expo-location';

/**
 * Foreground location permission, asking only when it isn't granted yet.
 *
 * On Android, requestForegroundPermissionsAsync opens the system permission screen
 * even when permission is already granted. The app goes inactive and active again,
 * and anything that refreshes on "active" asks again: a loop of hundreds of requests
 * that blocks other permission checks and ends with Android removing the activity.
 *
 * `ask: false` never shows a prompt (use it for refreshes on returning to the app;
 * after a denial, asking there would re-prompt in a loop).
 */
export async function ensureForegroundLocation({ ask = true } = {}): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return true;
  if (!ask || !current.canAskAgain) return false;
  return (await Location.requestForegroundPermissionsAsync()).granted;
}
