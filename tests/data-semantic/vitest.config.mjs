import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/data-semantic/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
  },
});
