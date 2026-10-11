import { expect, test } from '@playwright/test';

type SemanticWindow = Window & {
  aeliqoCompoundSemanticReady?: boolean;
  aeliqoCompoundSemanticEvents?: readonly { nodeId: string; portId: string; payload: unknown }[];
};

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/compound-semantic/index.html');
  await expect.poll(() => page.evaluate(() => (window as SemanticWindow).aeliqoCompoundSemanticReady)).toBe(true);
});

test('renders the validated compound tree and materialized rows in Chromium', async ({ page }) => {
  const region = page.locator('#region');
  await expect(region.locator('aeliqo-filter-builder')).toHaveCount(1);
  await expect(region.locator('aeliqo-record-list')).toHaveCount(1);
  await expect(region.locator('aeliqo-detail')).toHaveCount(1);
  await expect(region.locator('aeliqo-table')).toHaveCount(1);
  await expect(region.locator('aeliqo-record-list')).toContainText('Ada');
  await expect(region.locator('aeliqo-detail')).toContainText('Details');
});

test('preserves typed filter and selection interactions from the expanded plan', async ({ page }) => {
  const region = page.locator('#region');
  const filter = region.locator('aeliqo-filter-builder');
  await filter.locator('input[part=value]').fill('Ada');
  await filter.locator('button[part=apply]').click();
  await expect
    .poll(() => page.evaluate(() => (window as SemanticWindow).aeliqoCompoundSemanticEvents?.at(-1)))
    .toMatchObject({
      nodeId: 'filter',
      portId: 'filter',
      payload: { kind: 'filter', outputId: 'people' },
    });
  await region.locator('aeliqo-record-list button[part=record-button]').first().click();
  await expect
    .poll(() => page.evaluate(() => (window as SemanticWindow).aeliqoCompoundSemanticEvents?.at(-1)))
    .toMatchObject({
      nodeId: 'record-list',
      portId: 'selection',
      payload: { kind: 'selection', selection: { mode: 'ids', entity: 'person' } },
    });
});
