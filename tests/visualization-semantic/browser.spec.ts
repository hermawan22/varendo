import { expect, test } from '@playwright/test';

type SemanticWindow = Window & {
  aeliqoVisualizationSemanticReady?: boolean;
  aeliqoVisualizationSemanticEvents?: readonly { nodeId: string; portId: string; payload: Record<string, unknown> }[];
  aeliqoVisualizationSemanticReadOnlyEvents?: readonly {
    nodeId: string;
    portId: string;
    payload: Record<string, unknown>;
  }[];
};

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/visualization-semantic/index.html');
  await expect.poll(() => page.evaluate(() => (window as SemanticWindow).aeliqoVisualizationSemanticReady)).toBe(true);
});

test('renders all twelve views from one core validated region plan', async ({ page }) => {
  const region = page.locator('#editable');
  for (const view of [
    'trend',
    'bar',
    'area',
    'scatter',
    'histogram',
    'heatmap',
    'matrix',
    'timeline',
    'calendar-grid',
    'tree',
    'treemap',
    'relationship',
  ]) {
    await expect(region.locator(`aeliqo-${view}`)).toHaveCount(1);
  }
  await expect(region.locator('aeliqo-matrix').getByRole('columnheader')).toHaveText(['ID', 'Date', 'Select']);
});

test('emits a typed selection and retains the authorized identity', async ({ page }) => {
  const matrix = page.locator('#editable aeliqo-matrix');
  const matrixIdentity = JSON.stringify([JSON.stringify(['text', 'a'])]);
  await matrix.getByRole('button', { name: 'Select a', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as SemanticWindow).aeliqoVisualizationSemanticEvents?.at(-1)))
    .toMatchObject({
      nodeId: 'visualization-matrix',
      portId: 'selection',
      payload: {
        kind: 'selection',
        selection: { mode: 'ids', entity: 'rows', keys: [matrixIdentity], result: { id: 'semantic-temporal' } },
      },
    });

  await page.evaluate(async () => {
    const region = document.querySelector<any>('#editable');
    region.interaction = {
      version: '1',
      values: [
        {
          nodeId: 'visualization-matrix',
          portId: 'selection',
          payload: {
            kind: 'selection',
            selection: {
              mode: 'ids',
              entity: 'rows',
              keys: [JSON.stringify([JSON.stringify(['text', 'a'])])],
              result: (window as any).aeliqoVisualizationSemanticTemporalRef,
            },
          },
        },
      ],
      drafts: [],
    };
    await region.updateComplete;
  });
  await expect(matrix.getByRole('button', { name: 'Select a', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(async () => {
    const region = document.querySelector<any>('#editable');
    region.interaction = {
      ...region.interaction,
      values: region.interaction.values.map((value: any) => ({
        ...value,
        payload: { ...value.payload, selection: { ...value.payload.selection, entity: 'other' } },
      })),
    };
    await region.updateComplete;
  });
  await expect(matrix.getByRole('button', { name: 'Select a', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('suppresses forged selections and disables the read-only path', async ({ page }) => {
  const before = await page.evaluate(() => (window as SemanticWindow).aeliqoVisualizationSemanticEvents?.length ?? 0);
  await page.evaluate(() => {
    const region = document.querySelector<any>('#editable');
    const host = region.shadowRoot?.querySelector('[data-aeliqo-node-id="visualization-matrix"]');
    const matrix = host?.querySelector('aeliqo-matrix');
    matrix?.dispatchEvent(
      new CustomEvent('aeliqo-visualization-select', {
        bubbles: true,
        composed: true,
        cancelable: true,
        detail: {
          source: 'user',
          identity: '["forged"]',
          result: (window as any).aeliqoVisualizationSemanticTemporalRef,
        },
      }),
    );
  });
  await expect
    .poll(() => page.evaluate(() => (window as SemanticWindow).aeliqoVisualizationSemanticEvents?.length ?? 0))
    .toBe(before);

  await page.evaluate(async () => {
    const region = document.querySelector<any>('#readonly');
    region.interaction = {
      version: '1',
      values: [
        {
          nodeId: 'visualization-matrix',
          portId: 'selection',
          payload: {
            kind: 'selection',
            selection: {
              mode: 'ids',
              entity: 'rows',
              keys: [JSON.stringify([JSON.stringify(['text', 'a'])])],
              result: (window as any).aeliqoVisualizationSemanticTemporalRef,
            },
          },
        },
      ],
      drafts: [],
    };
    await region.updateComplete;
  });
  const readOnlyMatrix = page.locator('#readonly aeliqo-matrix');
  await expect(readOnlyMatrix.locator('[aria-pressed="true"]')).toHaveCount(0);
  await expect(readOnlyMatrix.getByRole('button', { name: 'Select a', exact: true })).toBeDisabled();
  const readOnlyBefore = await page.evaluate(
    () => (window as SemanticWindow).aeliqoVisualizationSemanticReadOnlyEvents?.length ?? 0,
  );
  await expect(readOnlyMatrix.getByRole('button', { name: 'Select a', exact: true })).toBeDisabled();
  expect(
    await page.evaluate(() => (window as SemanticWindow).aeliqoVisualizationSemanticReadOnlyEvents?.length ?? 0),
  ).toBe(readOnlyBefore);
});

test('clears all committed visualization content when the region is revoked', async ({ page }) => {
  await page.evaluate(async () => {
    const region = document.querySelector<any>('#editable');
    region.revoke();
    await region.updateComplete;
  });
  await expect(page.locator('#editable aeliqo-trend')).toHaveCount(0);
  await expect(page.locator('#editable aeliqo-matrix')).toHaveCount(0);
  await expect(page.locator('#editable')).not.toContainText('2026-09-08');
});
