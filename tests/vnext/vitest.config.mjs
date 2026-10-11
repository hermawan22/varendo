import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/vnext/**/*.test.ts', 'tests/vnext/**/*.test.tsx', 'tests/vnext/**/*.spec.tsx'],
    passWithNoTests: false,
  },
});
