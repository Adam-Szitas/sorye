import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        register: resolve(__dirname, 'src/register.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['lit', 'lit/decorators.js', '@lit/react', 'react'],
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js',
      },
    },
    minify: 'esbuild',
    target: 'es2022',
  },
});
