import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'studio',
      filename: 'remoteEntry.js',
      exposes: {
        './mount': './src/mount.tsx',
      },
      shared: {},
    }),
  ],
  server: {
    port: 3012,
    strictPort: true,
    cors: true,
    origin: 'http://localhost:3012',
    hmr: false,
  },
  preview: {
    port: 3012,
    strictPort: true,
    cors: true,
  },
  resolve: {
    // Loaders import `three`; bind only the bare specifier to the WebGPU build.
    // A string alias would also rewrite `three/addons/...` to `three/webgpu/addons/...`,
    // which is not an export of the three package.
    alias: [
      {
        find: /^three$/,
        replacement: 'three/webgpu',
      },
    ],
  },
  optimizeDeps: {
    include: ['three', 'three/webgpu'],
  },
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
  },
});
