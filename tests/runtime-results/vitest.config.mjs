import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/runtime-results/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
