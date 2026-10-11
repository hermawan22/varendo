import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/meaning-authoring/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
