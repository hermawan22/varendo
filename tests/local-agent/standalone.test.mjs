import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const example = new URL('../../examples/local-agent/', import.meta.url);
test('local agent is a standalone pinned public-package application', () => {
  assert(existsSync(new URL('package.json', example)), 'standalone local-agent package must exist');
  const manifest = JSON.parse(readFileSync(new URL('package.json', example)));
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.private, true);
  for (const name of ['core', 'runtime', 'web', 'agent'])
    assert.equal(manifest.dependencies[`@varendo/${name}`], '0.1.0');
  assert.equal(manifest.scripts.dev, 'pnpm build && pnpm start');
  assert(existsSync(new URL('pnpm-workspace.yaml', example)), 'independent install boundary');
});
