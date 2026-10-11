#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const specs = [
  'catalog.spec.ts',
  'field-states.spec.ts',
  'data-states.spec.ts',
  'structure-states.spec.ts',
  'data-interactions.spec.ts',
  'compound-interactions.spec.ts',
  'visualization-interactions.spec.ts',
];

for (const spec of specs) {
  const batch = spec.slice(0, -'.spec.ts'.length);
  const result = spawnSync(
    'pnpm',
    ['exec', 'playwright', 'test', '--config', 'tests/visual/playwright.config.mjs', `tests/visual/${spec}`],
    { stdio: 'inherit', env: { ...process.env, AELIQO_VISUAL_BATCH: batch } },
  );
  if (result.error !== undefined) {
    console.error(result.error.message);
    process.exit(127);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
