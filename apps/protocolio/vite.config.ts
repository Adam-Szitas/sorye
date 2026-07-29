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
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3000',
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
