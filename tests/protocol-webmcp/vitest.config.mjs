import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/protocol-webmcp/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
