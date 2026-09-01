import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'protocolio',
      filename: 'remoteEntry.js',
      exposes: {
        './mount': './src/mount.tsx',
      },
      shared: {},
    }),
  ],
  server: {
    port: 3007,
    strictPort: true,
    cors: true,
    origin: 'http://localhost:3007',
    hmr: false,
    fs: {
      allow: ['..', '../../..', '../../../protocolio-dashboard'],
    },
    proxy: {
      // Sorye Hub (handoffs, events, Protocolio developer bridge)
      '/api/handoffs': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api/events': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api/protocolio': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api/auth': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Direct Protocolio PDF engine (when not using Hub bridge)
      '/api/generate': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
      '/api/validate': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 3007,
    strictPort: true,
    cors: true,
  },
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
  },
  optimizeDeps: {
    include: ['@sorye/sdk', 'lit', '@lit/react'],
  },
});
