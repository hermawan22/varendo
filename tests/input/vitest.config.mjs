import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/input/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
