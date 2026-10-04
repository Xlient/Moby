// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // React Compiler-readiness rules (react-hooks v6): warnings until the existing
    // patterns are refactored (tracked in an issue), so CI stays meaningful now.
    rules: {
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
  {
    ignores: ['.venv/**', 'dist/*', 'android/*', 'ios/*', '.worktrees/*', 'src/api/generated-types.ts', 'moby/**'],
  },
]);
