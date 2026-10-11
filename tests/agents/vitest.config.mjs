import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/agents/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
