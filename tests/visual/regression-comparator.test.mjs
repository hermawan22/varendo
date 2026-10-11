import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from '@playwright/test';

test('real pixel comparator fails changed pixels, emits diff, and never updates reviewed image', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aeliqo-pixel-test-'));
  const baseline = join(directory, 'baseline');
  const candidate = join(directory, 'candidate');
  await mkdir(join(baseline, 'nested'), { recursive: true });
  await mkdir(join(candidate, 'nested'), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 40, height: 40 } });
    await page.setContent('<style>body { background: white; }</style>');
    await page.screenshot({ path: join(baseline, 'nested/sample.png') });
    await page.screenshot({ path: join(candidate, 'nested/sample.png') });
    const args = ['exec', 'playwright', 'test', '--config', 'tests/visual/regression.compare.playwright.config.mjs'];
    const env = {
      ...process.env,
      AELIQO_VISUAL_BASELINE: baseline,
      AELIQO_VISUAL_CANDIDATE: candidate,
      AELIQO_VISUAL_DIFF: join(directory, 'diff'),
    };
    const matching = spawnSync('pnpm', args, { env, encoding: 'utf8' });
    assert.equal(matching.status, 0, matching.stdout + matching.stderr);
    const reviewed = await readFile(join(baseline, 'nested/sample.png'));
    await page.setContent('<style>body { background: black; }</style>');
    await page.screenshot({ path: join(candidate, 'nested/sample.png') });
    const changed = spawnSync('pnpm', args, { env, encoding: 'utf8' });
    assert.equal(changed.status, 1, changed.stdout + changed.stderr);
    assert.deepEqual(await readFile(join(baseline, 'nested/sample.png')), reviewed);
    const files = await readdir(join(directory, 'diff'), { recursive: true });
    assert.ok(
      files.some((file) => file.endsWith('-diff.png')),
      changed.stdout + changed.stderr,
    );
  } finally {
    await browser.close();
  }
});
