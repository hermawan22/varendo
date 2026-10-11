import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/query/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
