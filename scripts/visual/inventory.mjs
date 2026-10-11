import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { output } from './process.mjs';
import { imageInventory } from './policy.mjs';
import { testInventory } from './shards.mjs';
export function plannedTests(root, destination, project) {
  const args = [
    'exec',
    'playwright',
    'test',
    '--config',
    'tests/visual/regression.capture.playwright.config.mjs',
    '--list',
    '--reporter=json',
  ];
  if (project) args.push('--project', project);
  return testInventory(JSON.parse(output(root, 'pnpm', args, { AELIQO_VISUAL_CAPTURE: destination })));
}
export async function captureEvidence(directory, planned) {
  const tests = testInventory(JSON.parse(await readFile(join(directory, 'results.json'), 'utf8')), true);
  assert.deepEqual(tests, planned, 'Capture omitted or added planned tests');
  const images = [];
  for (const path of await imageInventory(directory)) {
    const content = await readFile(join(directory, path));
    images.push({ path, sha256: createHash('sha256').update(content).digest('hex') });
  }
  return { tests, images };
}
