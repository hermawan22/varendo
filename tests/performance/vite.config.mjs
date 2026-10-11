import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');

/**
 * Production fixture used by the performance browser gate. The preview server
 * serves the exact Vite production output; it must not fall back to Vite's
 * development transform path.
 */
export default defineConfig({
  root: repositoryRoot,
  base: '/',
  build: {
    outDir: resolve(repositoryRoot, 'artifacts/performance-browser-dist'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(repositoryRoot, 'tests/performance/browser.html'),
    },
  },
  preview: { host: '127.0.0.1' },
});
