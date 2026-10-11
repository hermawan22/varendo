import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: {
    alias: { '@varendo/runtime/regions': resolve(import.meta.dirname, '../../packages/runtime/dist/regions/index.js') },
  },
});
