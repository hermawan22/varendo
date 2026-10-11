import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/runtime-audit/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
