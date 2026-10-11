import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import { chromium, expect } from '@playwright/test';
import { verifyManualLayouts, verifyNativePlayground } from './playground-live.mjs';
import { RELEASE_VERSION } from './metadata.mjs';
const expectedSha = process.argv[2];
if (!/^[a-f0-9]{40}$/u.test(expectedSha ?? '')) throw new Error('Expected full release SHA.');
const apexOrigin = process.env.AELIQO_APEX_ORIGIN ?? 'https://hermawan22.github.io/varendo';
const docsOrigin = process.env.AELIQO_DOCS_ORIGIN ?? 'https://hermawan22.github.io/varendo';
const browser = await chromium.launch({ args: ['--enable-features=WebMCPTesting'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const checks = [];
const evidence = {};

async function visit(url, status = 200) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  assert.equal(response?.status(), status, `${url} returned ${response?.status()}`);
  checks.push({ url, status });
  return response;
}

try {
  for (const origin of [apexOrigin, docsOrigin]) {
    const version = await visit(`${origin}/version`);
    const identity = await version.json();
    assert.equal(identity.sdkRevision, expectedSha);
    assert.equal(identity.siteRevision, expectedSha);
    assert.equal(identity.sdkVersion, RELEASE_VERSION);
  }
  await visit(`${apexOrigin}/healthz`);
  await visit(`${apexOrigin}/readyz`);
  await visit(`${apexOrigin}/`);
  assert((await page.locator('h1').count()) > 0);
  await visit(`${docsOrigin}/`);
  const brand = page.locator('header a').filter({ hasText: 'Varendo' }).first();
  assert.equal(await brand.getAttribute('href'), `${apexOrigin}/`);
  await brand.click();
  await expect(page).toHaveURL(`${apexOrigin}/`);
  await visit(`${docsOrigin}/components/data.table/`);
  evidence.componentSidebarLinks = await page
    .locator('.docs-sidebar nav a[href^="/components/"]:not([href="/components/"])')
    .count();
  assert.equal(evidence.componentSidebarLinks, 71);
  await page.waitForFunction(
    () => document.querySelector('.search-trigger')?.getAttribute('aria-haspopup') === 'dialog',
  );
  await page.keyboard.press('Control+k');
  await page.locator('.docs-search-field').fill('table');
  await page.locator('.search-results a[href="/components/data.table/"]').first().waitFor();
  evidence.search = { query: 'table', resultHref: '/components/data.table/', shortcut: 'Control+k' };
  await page.keyboard.press('Escape');
  await visit(`${docsOrigin}/playground/`);
  await page.waitForFunction(() => document.querySelector('#pg-receipt-state')?.textContent === 'renderer-ready');
  await page.locator('[data-journey="jakarta"]').click();
  await page.waitForFunction(() => document.querySelector('#pg-receipt-state')?.textContent === 'renderer-ready');
  await expect(page.locator('#pg-committed-filter')).toContainText('Jakarta');
  await expect(page.locator('aeliqo-table').getByText('Ada Chen')).toHaveCount(1);
  await expect(page.locator('aeliqo-table').getByText('Sam Rivera')).toHaveCount(0);
  evidence.peopleJakarta = {
    committedFilter: (await page.locator('#pg-committed-filter').textContent()).trim(),
    adaRows: await page.locator('aeliqo-table').getByText('Ada Chen').count(),
    samRows: await page.locator('aeliqo-table').getByText('Sam Rivera').count(),
  };
  evidence.manualLayouts = await verifyManualLayouts(page);
  evidence.webmcp = await verifyNativePlayground(page);
  await page.locator('#pg-scenario').selectOption('products');
  await page.locator('#pg-menu > summary').click();
  assert.equal(await page.locator('#pg-export').isEnabled(), true);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#pg-export').click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.zip$/u);
  const archive = await readFile(await download.path());
  assert.equal(archive.subarray(0, 4).toString('hex'), '504b0304');
  assert(archive.length > 1024);
  const packageJson = JSON.parse(
    execFileSync('unzip', ['-p', await download.path(), 'package.json'], { encoding: 'utf8' }),
  );
  for (const name of ['@varendo/core', '@varendo/runtime', '@varendo/web']) {
    assert.equal(packageJson.dependencies[name], RELEASE_VERSION);
  }
  evidence.exportPackageDependencies = packageJson.dependencies;
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      status: 'passed',
      expectedSha,
      checks,
      evidence,
      manualJourneys: ['people', 'attendance', 'workspace', 'page'],
      browserVersion: browser.version(),
      modelCalls: 0,
      export: { filename: download.suggestedFilename(), bytes: archive.length, pinnedVersion: RELEASE_VERSION },
    }),
  );
} finally {
  await browser.close();
}
