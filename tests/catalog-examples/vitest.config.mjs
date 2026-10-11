import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/catalog-examples/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
