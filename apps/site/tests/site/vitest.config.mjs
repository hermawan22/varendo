import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/site/**/*.test.ts'], environment: 'node' } });
