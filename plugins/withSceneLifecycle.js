// iOS: apps built with the iOS 27 SDK must adopt the scene-based life cycle, or UIKit
// stops them at launch (EXC_BREAKPOINT in _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption).
// Expo SDK 57 ships ExpoAppSceneDelegate but its prebuild template doesn't use it yet;
// this applies the SDK 58 template's setup. ios/ is generated, so it's done here.
// Drop this plugin after upgrading to SDK 58.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const MARKER = '// @moby/scene-lifecycle';

// Other plugins may insert generated blocks between the window and startReactNative
// (@react-native-firebase/app adds FirebaseApp.configure() there); group 1 keeps them.
const START_IN_APP_DELEGATE =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n {4}window = UIWindow\(frame: UIScreen\.main\.bounds\)\n((?:\/\/ @generated begin [\s\S]*?\/\/ @generated end [^\n]*\n)*) {4}factory\.startReactNative\([\s\S]*?\n#endif\n/;

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;
    if (cfg.modResults.language !== 'swift' || !START_IN_APP_DELEGATE.test(src)) {
      throw new Error('withSceneLifecycle: AppDelegate.swift has an unexpected shape; update the plugin.');
    }
    src = src
      .replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {')
      .replace(
        START_IN_APP_DELEGATE,
        (_, generated) => `\n    ${MARKER}\n    // SceneDelegate creates the window and starts React Native.\n${generated}`,
      );
    src += `
${MARKER}
@objc(SceneDelegate)
class SceneDelegate: ExpoAppSceneDelegate {}
`;
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });
}

module.exports = function withSceneLifecycle(config) {
  return withSceneManifest(withSceneAppDelegate(config));
};
