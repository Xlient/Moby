# Early Warning (Moby)

Disaster early-warning client, built with **Expo (SDK 57) / React Native**. It runs on
Android, iOS and the web from one codebase (web goes through `react-native-web`).

## Setup

```bash
npm install
cp .env.example .env   # optional: API + Firebase settings (EXPO_PUBLIC_* only)
```

With no `EXPO_PUBLIC_API_URL` set the app runs on the built-in mock data, and with no
Firebase settings it skips sign-in.

## Run in development

```bash
npx expo start --go     # open in Expo Go on your phone (scan the QR code); "a" = Android emulator, "w" = web
npm run web             # web only
```

Every native module the app uses today ships in Expo Go, so no build is needed to try it.
(`expo-dev-client` is installed, so plain `npx expo start` targets a development build;
`--go` or pressing `s` switches to Expo Go.) Once you add a library with its own native code
(e.g. Bluetooth for the mesh relay), use a **development build** instead:

```bash
npx expo run:android    # builds + installs a debug build locally (needs Android Studio / SDK)
# or, in the cloud:
npx eas-cli@latest build -p android --profile development
```

## Accounts and database (Firebase)

Sign-in is Firebase Auth (email + password). Firestore holds **user-owned data only**:

| Path | Contents |
|---|---|
| `users/{uid}` | name, email, roles, `settings.nearby_radius_km` |
| `users/{uid}/subscriptions/{id}` | watched areas (same shape as `Subscription` in the API contract) |

Alerts, events and reports stay with the backend (Postgres + PostGIS) and come through the
REST API. Access is locked down in `firestore.rules`: users can only touch their own
documents, can't change their roles, and nothing else is readable. Data access lives in
`src/api/userData.ts`.

### Project setup (moby-52b4c)

The app talks to the real project by default. Its client config is in `.env`
(`EXPO_PUBLIC_FIREBASE_*`, copied from `google-services.json`) and `.firebaserc` points the
Firebase CLI at it. One-time console steps:

1. **Authentication → Sign-in method:** enable **Email/Password** and **Google**.
2. **Firestore Database:** create the database (production mode is fine — our rules lock it down).
3. **Project settings → Your apps → Android (`com.xlient.moby`) → Add fingerprint:** add the
   SHA-1 of every key that signs the app, then download `google-services.json` again and
   replace the one in the repo root. Debug builds use the React Native debug key:
   `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`.
   EAS and Play builds have their own keys (`eas credentials`, Play Console → App integrity).
4. Publish the security rules:
   ```bash
   npx -y firebase-tools@15 login
   npm run deploy:firestore
   ```

### Google Sign-In

Android uses `@react-native-google-signin/google-signin`: the Google account picker returns
an ID token for the OAuth **web** client (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`), which Firebase
Auth exchanges for a session (`src/auth/googleSignIn.ts`; the web build uses Firebase's popup).
`app.config.ts` sets `android.googleServicesFile`, so `expo prebuild` adds the Google Services
Gradle plugin to `android/build.gradle` and `android/app/build.gradle`; don't edit those by
hand. A "isn't set up for this version of the app" error means the signing SHA-1 isn't
registered (step 3).

### Local development with the emulators (no Firebase project needed)

```bash
npm run emulators         # Auth :9099, Firestore :8080, UI http://127.0.0.1:4000 — needs Java 21+
npm run start:emulators   # Metro with the app pointed at the emulators (project demo-moby)
npm run test:rules        # security-rule tests, with the emulators running
```

Inside the Android emulator, `localhost` is mapped to `10.0.2.2` automatically; for a
physical phone set `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST` to your computer's LAN IP. Emulator
data is saved to `.firebase-emulator-data/` on exit. A test account for the emulator is in
`tests/emulator-test-account.json`.

### Maps

Android uses Google Maps (`react-native-maps`). The key comes from `GOOGLE_MAPS_API_KEY` in
`.env` via `app.config.ts` (rebuild after changing it). Restrict the key in Google Cloud to
**Maps SDK for Android** and the app's package + SHA-1. The basemap is styled muted
(`src/theme/mapStyle.ts`) so only severity is saturated. The web build shows a plain diagram.

## Android builds

> **Java versions:** the Android build needs **JDK 17** (React Native's native build fails on
> newer JDKs with "A restricted method in java.lang.System has been called"); the Firebase
> emulators need **JDK 21+**. Set `JAVA_HOME` accordingly, or set Android Studio's Gradle JDK
> to 17.

`android/` is **generated** (Continuous Native Generation) and is gitignored. Configure
native settings in `app.json` (package name `com.xlient.moby`, version, icons,
permissions), not by editing generated files.

### Cloud builds with EAS (no Android SDK needed)

One-time setup:

```bash
npm install -g eas-cli      # or prefix commands with npx eas-cli@latest
eas login
eas init                    # links the project to your Expo account (writes projectId into app.json)
```

Then:

| Command | Profile | Output |
|---|---|---|
| `npm run build:android:apk` | `preview` | Installable `.apk` for testers (sideload / QR link) |
| `npm run build:android:aab` | `production` | `.aab` for Google Play |
| `eas build -p android --profile development` | `development` | Dev-client `.apk` for `expo start --dev-client` |

EAS generates and stores the signing keystore on the first build. Profiles live in
`eas.json`.

### Local builds

- `npm run build:android:local` runs the same EAS `preview` build on your machine
  (needs the Android SDK and a JDK, 17 or newer).
- Or generate the native project and use Gradle directly:

  ```bash
  npx expo prebuild -p android
  cd android && ./gradlew assembleRelease   # → app/build/outputs/apk/release/Moby.apk
  ```

  Without EAS this release APK is signed with the debug keystore, so it's fine for
  testing but not for Play.

### Versioning

`appVersionSource` is `local`: bump `expo.version` and `expo.android.versionCode` in
`app.json` before each Play upload.

## Project layout

- `index.ts` → `src/Root.tsx` (providers, safe area, status bar) → `src/App.tsx` (screen state, Android back button)
- `src/screens`, `src/components` — React Native UI (react-native-paper + react-native-svg)
- `src/lib/storage.ts` — synchronous on-device key-value cache (expo-sqlite; `storage.web.ts` uses localStorage)
- `src/hooks/useOnlineStatus.ts` — connectivity via NetInfo
- `src/config/env.ts` — `EXPO_PUBLIC_*` build-time config
