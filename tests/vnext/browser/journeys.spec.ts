import { expect, test } from '@playwright/test';
import type { AeliqoRegionElement } from '../../../packages/web/src/region/aeliqo-region.js';
import {
  resetJourneyThroughHostControl,
  runFixtureAgentCompareJourney,
  runManualCompareJourney,
} from './journey-helpers.js';

test('public content is useful without JavaScript and its optional detail hydrates', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('Journey fixture requires baseURL.');
  const staticContext = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await staticContext.newPage();
    await page.goto('/journeys/');
    await expect(page.getByRole('heading', { name: 'Public content and an optional island' })).toBeVisible();
    await expect(page.getByText('Release notes: stable HTML remains useful before hydration.')).toBeVisible();
  } finally {
    await staticContext.close();
  }

  const liveContext = await browser.newContext({ baseURL });
  try {
    const page = await liveContext.newPage();
    await page.goto('/journeys/');
    await expect(page.locator('#journey-status')).toContainText('hydrated with synthetic data');
    await page.getByRole('button', { name: 'Filter public detail' }).click();
    await expect(page.locator('#public-status')).toContainText('without a model request');
  } finally {
    await liveContext.close();
  }
});

test('manual comparison and fixture-agent comparison commit the same intent', async ({ page }) => {
  await page.goto('/journeys/');
  const manual = await runManualCompareJourney(page);
  const region = page.locator('#catalog-view aeliqo-region');
  const previous = await region.evaluate((element: AeliqoRegionElement) => element.presentation?.plan);
  const children = await page.locator('#catalog-view aeliqo-detail').elementHandles();
  expect(children).toHaveLength(2);
  await resetJourneyThroughHostControl(page);
  const assisted = await runFixtureAgentCompareJourney(page);
  expect(assisted.normalizedIntent).toEqual(manual.normalizedIntent);
  expect(assisted.selectedIds).toEqual(manual.selectedIds);
  const next = await region.evaluate((element: AeliqoRegionElement) => element.presentation?.plan);
  expect(next?.nodes.map((node) => node.id)).toEqual(previous?.nodes.map((node) => node.id));
  expect(next?.preconditions.results).toHaveLength(1);
  expect(next?.preconditions.results[0]?.id).not.toBe(previous?.preconditions.results[0]?.id);
  expect(next?.nodes.flatMap((node) => (node.result === undefined ? [] : [node.result]))).toEqual([
    next?.preconditions.results[0],
    next?.preconditions.results[0],
  ]);
  for (const child of children) expect(await child.evaluate((element) => element.isConnected)).toBe(true);
});

test('enterprise windows stay independent and host approval plus revocation are explicit', async ({ page }) => {
  await page.goto('/journeys/');
  await page.getByRole('button', { name: 'Load left partial page' }).click();
  await expect(page.locator('#enterprise-status')).toContainText('left remote window renderer-ready');
  await expect(page.locator('#enterprise-left-view aeliqo-table')).toHaveCount(1);
  await expect(page.locator('#enterprise-right-view aeliqo-table')).toHaveCount(0);

  await page.getByRole('button', { name: 'Request host approval' }).click();
  await expect(page.getByRole('button', { name: 'Approve reviewed action' })).toBeEnabled();
  await page.getByRole('button', { name: 'Approve reviewed action' }).click();
  await expect(page.locator('#enterprise-audit')).toContainText('host approved synthetic product review');

  await page.getByRole('button', { name: 'Revoke right-surface access' }).click();
  await expect(page.locator('#enterprise-status')).toContainText('denied:journey.access-denied');
  await expect(page.locator('#enterprise-left-view aeliqo-table')).toHaveCount(1);
});

test('non-data job keeps the draft local and exposes only host-owned progress and output refs', async ({ page }) => {
  await page.goto('/journeys/');
  const draft = page.getByLabel('Document title');
  await draft.fill('Quarterly analysis');
  await page.getByRole('button', { name: 'Start document job' }).click();
  await expect(page.locator('#job-status')).toContainText('Job running; progress 0%');
  await expect(draft).toHaveValue('Quarterly analysis');
  await page.getByRole('button', { name: 'Advance progress' }).click();
  await page.getByRole('button', { name: 'Advance progress' }).click();
  await expect(page.locator('#job-status')).toContainText('Job complete; progress 100%');
  await expect(page.locator('#job-output')).toHaveText(/^output:\/\/job-1$/u);
  await expect(page.locator('#job-output')).not.toContainText('Quarterly analysis');
});
