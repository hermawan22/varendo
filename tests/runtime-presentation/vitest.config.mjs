import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/runtime-presentation/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
