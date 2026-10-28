import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    federation({
      name: 'ocr',
      filename: 'remoteEntry.js',
      exposes: {
        './mount': './src/mount.tsx',
      },
      shared: {},
      // Hub consumes the mount contract directly. Generate declaration archives
      // at build time rather than spawning a type worker for each dev file change.
      dts: command === 'build',
    }),
  ],
  server: {
    port: 3011,
    strictPort: true,
    cors: true,
    origin: 'http://localhost:3011',
    hmr: false,
  },
  preview: {
    port: 3011,
    strictPort: true,
    cors: true,
  },
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
  },
}));
