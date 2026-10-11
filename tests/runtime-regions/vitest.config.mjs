import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/runtime-regions/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
