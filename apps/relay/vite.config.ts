import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'relay',
      filename: 'remoteEntry.js',
      exposes: {
        './mount': './src/mount.tsx',
      },
      shared: {},
    }),
  ],
  server: {
    port: 3006,
    strictPort: true,
    cors: true,
    origin: 'http://localhost:3006',
    hmr: false,
  },
  preview: {
    port: 3006,
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
