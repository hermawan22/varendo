import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/runtime-actions/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
