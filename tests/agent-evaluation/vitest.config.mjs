import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/agent-evaluation/**/*.test.ts'], environment: 'node', testTimeout: 30_000 },
});
