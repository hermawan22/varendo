import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('functional CI preserves feedback browser failure traces even when checks fail', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/quality.yml', import.meta.url), 'utf8');
  const config = await readFile(new URL('../feedback/playwright.config.mjs', import.meta.url), 'utf8');
  const upload = workflow.split('- name: Upload source-bound functional evidence\n')[1]?.split('\n  visual-shards:')[0];
  assert.ok(upload, 'The functional evidence upload step must exist.');
  assert.match(upload, /if: always\(\)/u);
  assert.match(config, /outputDir: resolve\(repositoryRoot, 'artifacts\/feedback-browser'\)/u);
  assert.match(upload, /^\s+artifacts\/feedback-browser$/mu);
});
