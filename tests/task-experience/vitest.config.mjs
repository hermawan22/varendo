import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/task-experience/**/*.test.ts'], environment: 'node', pool: 'forks', passWithNoTests: false },
});
