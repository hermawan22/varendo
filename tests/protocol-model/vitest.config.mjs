import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/protocol-model/**/*.test.ts'], environment: 'node', passWithNoTests: false },
});
