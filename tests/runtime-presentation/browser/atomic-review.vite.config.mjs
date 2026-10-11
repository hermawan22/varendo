import base from './vite.config.mjs';
import { resolve } from 'node:path';
export default {
  ...base,
  resolve: {
    ...base.resolve,
    alias: {
      ...base.resolve.alias,
      '@varendo/runtime/app': resolve(import.meta.dirname, '../../../packages/runtime/src/app/index.ts'),
    },
  },
};
