import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'react-native': 'react-native-web',
      'react-native-safe-area-context': path.resolve(
        __dirname,
        './src/shims/safe-area-context.tsx',
      ),
    },
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js'],
  },
  optimizeDeps: {
    include: ['react-native-web', 'react-native-paper'],
    esbuild: {
      loader: { '.js': 'jsx' },
    },
  },
});
