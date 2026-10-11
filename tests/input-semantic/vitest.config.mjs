import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/input-semantic/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
