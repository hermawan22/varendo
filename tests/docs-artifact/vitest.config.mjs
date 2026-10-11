import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['tests/docs-artifact/**/*.test.ts'], environment: 'node' } });
