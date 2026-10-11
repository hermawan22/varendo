import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/protocol-mcp/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
    testTimeout: 30_000,
  },
});
