import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/visualization/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
