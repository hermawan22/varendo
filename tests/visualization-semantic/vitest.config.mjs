import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/visualization-semantic/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
