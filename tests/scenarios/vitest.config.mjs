import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/scenarios/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
  },
});
