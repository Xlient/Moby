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
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!mapsKey) {
    console.warn('GOOGLE_MAPS_API_KEY is not set: maps will render blank on Android.');
  }

  return {
    ...config,
    name: config.name ?? 'Moby',
    slug: config.slug ?? 'moby',
    android: {
      ...config.android,
      googleServicesFile: './google-services.json',
      config: {
        ...config.android?.config,
        googleMaps: { apiKey: mapsKey },
      },
    },
  };
};
