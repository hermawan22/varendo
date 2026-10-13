import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { PUBLIC_PACKAGE_NAMES, PUBLIC_PACKAGES, RELEASE_VERSION } from '../../scripts/release/metadata.mjs';

const root = resolve(import.meta.dirname, '../..');

test('release metadata owns the five public source manifest versions', async () => {
  assert.equal(PUBLIC_PACKAGES.length, 5);
  assert.deepEqual(
    PUBLIC_PACKAGE_NAMES,
    PUBLIC_PACKAGES.map((name) => `@varendo/${name}`),
  );
  for (const name of PUBLIC_PACKAGES) {
    const manifest = JSON.parse(await readFile(resolve(root, `packages/${name}/package.json`), 'utf8'));
    assert.equal(manifest.name, `@varendo/${name}`);
    assert.equal(manifest.version, RELEASE_VERSION);
  }
});

test('all internal public peer dependencies pin the current release version', async () => {
  for (const name of PUBLIC_PACKAGES) {
    const manifest = JSON.parse(await readFile(resolve(root, `packages/${name}/package.json`), 'utf8'));
    for (const [peer, version] of Object.entries(manifest.peerDependencies ?? {})) {
      if (!peer.startsWith('@varendo/')) continue;
      assert(PUBLIC_PACKAGE_NAMES.includes(peer), `${manifest.name} declares unknown public peer ${peer}`);
      assert.equal(version, RELEASE_VERSION, `${manifest.name} peer ${peer} must match release metadata`);
    }
  }
});

test('the web custom-element compatibility marker matches release metadata', async () => {
  const source = await readFile(resolve(root, 'packages/web/src/version.ts'), 'utf8');
  const match = /VARENDO_WEB_VERSION\s*=\s*['"]([^'"]+)['"]/u.exec(source);
  assert.equal(match?.[1], RELEASE_VERSION);
});

test('the agent protocol identity matches release metadata', async () => {
  const source = await readFile(resolve(root, 'packages/agent/src/version.ts'), 'utf8');
  const match = /VARENDO_AGENT_VERSION\s*=\s*['"]([^'"]+)['"]/u.exec(source);
  assert.equal(match?.[1], RELEASE_VERSION);
});
