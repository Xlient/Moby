// iOS: React Native Firebase's pods are autolinked even when Firebase isn't configured,
// and its Swift Package Manager mode can't be combined with static frameworks (duplicate
// Firebase symbols at link time). Opting out of SPM, as its own error message advises,
// lets CocoaPods link Firebase once. ios/ is generated, so the Podfile is edited here.
const { withPodfile } = require('expo/config-plugins');

const MARKER = '# @moby/rnfirebase-no-spm';

module.exports = function withRNFirebasePods(config) {
  return withPodfile(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents = `${MARKER}\n$RNFirebaseDisableSPM = true\n\n${cfg.modResults.contents}`;
    }
    return cfg;
  });
};
