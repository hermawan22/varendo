import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/navigation-feedback-semantic/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
  },
});
