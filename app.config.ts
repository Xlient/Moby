import { existsSync } from 'node:fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Static settings live in app.json; this adds the values that come from the
 * environment (.env is loaded by the Expo CLI before this runs) so keys stay out
 * of git.
 *
 * `android.googleServicesFile` makes `expo prebuild` add the Google Services
 * Gradle plugin to android/build.gradle (classpath) and android/app/build.gradle
 * (apply plugin), and copy google-services.json into android/app — which Google
 * Sign-In needs. android/ is generated, so configure it here, not by hand.
 *
 * The public repository has no google-services.json: without it the app builds and
 * runs on mock data (no Google Sign-In / push), which is all contributors need.
 * The native Firebase setup for App Check (@react-native-firebase/app) is added only
 * when the file exists, so public builds compile but can never obtain a token.
 *
 * Release builds (CI): MOBY_VERSION_NAME / MOBY_VERSION_CODE set the version (Play
 * needs a higher versionCode for every upload); signing comes from
 * plugins/withReleaseSigning.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!mapsKey) {
    console.warn('GOOGLE_MAPS_API_KEY is not set: maps will render blank on Android.');
  }
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
  const hasFirebase = existsSync(googleServicesFile);
  const versionCode = Number(process.env.MOBY_VERSION_CODE) || config.android?.versionCode;

  return {
    ...config,
    name: config.name ?? 'Moby',
    slug: config.slug ?? 'moby',
    version: process.env.MOBY_VERSION_NAME || config.version,
    plugins: [...(config.plugins ?? []), ...(hasFirebase ? ['@react-native-firebase/app'] : [])],
    android: {
      ...config.android,
      versionCode,
      ...(hasFirebase ? { googleServicesFile } : {}),
      config: {
        ...config.android?.config,
        googleMaps: { apiKey: mapsKey },
      },
    },
  };
};
