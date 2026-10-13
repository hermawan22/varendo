import { expect, test } from '@playwright/test';

type SemanticWindow = Window & {
  varendoDataSemanticReady?: boolean;
  varendoDataSemanticEvents?: readonly { nodeId: string; portId: string; payload: Record<string, unknown> }[];
  varendoDataSemanticRequests?: readonly { kind: string; nodeId: string; portId: string }[];
};

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/data-semantic/index.html');
  await expect.poll(() => page.evaluate(() => (window as SemanticWindow).varendoDataSemanticReady)).toBe(true);
});

test('renders metric, delta and detail from one validated semantic region', async ({ page }) => {
  const region = page.locator('#region');
  await expect(region.locator('varendo-metric [part=number]')).toHaveText('12.50');
  await expect(region.locator('varendo-delta [part=number]')).toHaveText('+2.5');
  await expect(region.locator('varendo-detail [part=fact][data-field=name] dd')).toHaveText('Ada');
  await expect(region.locator('varendo-key-value')).toHaveCount(1);
  await expect(region.locator('varendo-selection-summary')).toHaveCount(1);
  await expect(region.locator('varendo-record-list [part=scope]')).toContainText('Showing 2 of 3 records');
});

test('filter typing stays draft-only and Apply emits a typed semantic payload', async ({ page }) => {
  const region = page.locator('#region');
  const filter = region.locator('varendo-filter-builder');
  const value = filter.locator('input[part=value]');
  await value.fill('Ada');
  expect(await page.evaluate(() => (window as SemanticWindow).varendoDataSemanticEvents?.length ?? 0)).toBe(0);
  await filter.locator('button[part=apply]').click();
  await expect
    .poll(() => page.evaluate(() => (window as SemanticWindow).varendoDataSemanticEvents?.at(-1)))
    .toMatchObject({
      nodeId: 'filter-builder',
      portId: 'filter',
      payload: {
        kind: 'filter',
        outputId: 'people',
        predicates: [{ op: 'compare', field: 'name', comparison: 'eq', value: 'Ada' }],
      },
    });
});

test('selection uses stable row identity when the host reorders authorized rows', async ({ page }) => {
  const region = page.locator('#region');
  const list = region.locator('varendo-record-list');
  await list.locator('button[part=record-button]').first().click();
  await expect
    .poll(() => page.evaluate(() => (window as SemanticWindow).varendoDataSemanticEvents?.at(-1)))
    .toMatchObject({
      nodeId: 'record-list',
      portId: 'selection',
      payload: { kind: 'selection', selection: { mode: 'ids', entity: 'person', keys: ['string:1:a'] } },
    });
  await page.evaluate(async () => {
    const region = document.querySelector('#region') as any;
    const current = region.results[0];
    region.interaction = {
      version: '1',
      values: [
        {
          nodeId: 'record-list',
          portId: 'selection',
          payload: {
            kind: 'selection',
            selection: { mode: 'ids', entity: 'person', keys: ['string:1:a'], result: current.ref },
          },
        },
      ],
      drafts: [],
    };
    region.results = [{ ...current, rows: [...current.rows].reverse() }];
    await region.updateComplete;
  });
  await expect(list.locator("[part=record][data-key='string:1:a']")).toHaveAttribute('data-selected');
});

test('load-more stays a host callback and clearing results revokes rendered data', async ({ page }) => {
  const region = page.locator('#region');
  await region.locator('varendo-card-collection button[part=load-more]').click();
  await expect
    .poll(() => page.evaluate(() => (window as SemanticWindow).varendoDataSemanticRequests?.at(-1)))
    .toEqual({ kind: 'load-more', nodeId: 'card-collection', portId: 'load-more' });
  await page.evaluate(async () => {
    const region = document.querySelector('#region') as any;
    region.clear();
    await region.updateComplete;
  });
  await expect(region.locator('varendo-metric')).toHaveCount(0);
  await expect(region.locator('varendo-card-collection')).toHaveCount(0);
});
