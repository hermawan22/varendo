import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');

/**
 * Serves the adverse visualization fixture from the built @varendo/web and
 * @varendo/core package exports. This is an observation harness, not a timing
 * qualification gate.
 */
export default defineConfig({
  root: repositoryRoot,
  base: '/',
  build: {
    outDir: resolve(repositoryRoot, 'artifacts/performance-adverse-visualization-dist'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(repositoryRoot, 'tests/performance/adverse-visualization.html'),
    },
  },
  preview: { host: '127.0.0.1' },
});
