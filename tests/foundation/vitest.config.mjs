import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/foundation/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
