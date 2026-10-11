import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/vertical-slice/web/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
