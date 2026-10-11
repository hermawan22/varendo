import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/vertical-slice/**/*.test.ts'], environment: 'node' } });
