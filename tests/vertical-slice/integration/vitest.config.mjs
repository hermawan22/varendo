import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/vertical-slice/integration/**/*.test.ts'], environment: 'node' },
});
