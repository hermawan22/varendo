import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/runtime-evaluation/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
  },
});
