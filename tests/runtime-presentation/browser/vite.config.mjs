import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
export default defineConfig({
  resolve: {
    alias: {
      '@varendo/runtime/presentation': resolve(repositoryRoot, 'packages/runtime/src/presentation/index.ts'),
    },
  },
});
