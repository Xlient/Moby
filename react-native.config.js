// React Native Firebase's native modules start Firebase as soon as the app launches:
// without google-services.json (Android) or GoogleService-Info.plist (iOS) the App
// Check module throws "Default FirebaseApp is not initialized" and the app crashes
// on launch. Builds from the public source have neither file, so the modules are not
// linked there; src/lib/appCheck.ts loads them lazily and only in official builds.
// The paths match app.config.ts (relative to the project root, where the CLI runs).
const { existsSync } = require('node:fs');

const hasFile = (envVar, fallback) => existsSync(process.env[envVar] ?? fallback);
const hasAndroidFirebase = hasFile('GOOGLE_SERVICES_JSON', 'google-services.json');
const hasIosFirebase = hasFile('GOOGLE_SERVICES_PLIST', 'GoogleService-Info.plist');

const platforms = {
  ...(hasAndroidFirebase ? {} : { android: null }),
  ...(hasIosFirebase ? {} : { ios: null }),
};

module.exports = {
  dependencies: Object.keys(platforms).length
    ? {
        '@react-native-firebase/app': { platforms },
        '@react-native-firebase/app-check': { platforms },
      }
    : {},
};
