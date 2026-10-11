import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import base from './vite.config.mjs';
export default defineConfig({
  ...base,
  resolve: {
    alias: {
      ...base.resolve.alias,
      '@varendo/runtime/app': resolve(import.meta.dirname, '../../../packages/runtime/src/app/index.ts'),
    },
  },
});
