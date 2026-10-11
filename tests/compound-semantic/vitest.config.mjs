import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['tests/compound-semantic/**/*.test.ts'], environment: 'node' } });
