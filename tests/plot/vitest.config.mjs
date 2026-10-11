import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/plot/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
