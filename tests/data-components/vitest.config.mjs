import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/data-components/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
