import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.goto('/tests/plot/index.html');
  await page.locator('aeliqo-plot table').waitFor();
});
test('SVG and Canvas use the same coordinates and retain the missing interval', async ({ page }) => {
  const coordinates = await page
    .locator('aeliqo-plot circle')
    .evaluateAll((nodes) => nodes.map((n) => ({ x: Number(n.getAttribute('cx')), y: Number(n.getAttribute('cy')) })));
  expect(coordinates).toHaveLength(2);
  await expect(page.getByRole('cell', { name: '1.123456789012345678', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Missing', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const p = (window as any).plot;
    p.renderer = 'canvas';
    await p.updateComplete;
  });
  const samples = await page.locator('canvas').evaluate(
    (node, positions) => {
      const canvas = node as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const ratio = canvas.width / 640;
      return positions.map(({ x, y }) => ctx.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data[3]);
    },
    [...coordinates, { x: 340, y: 148 }],
  );
  expect(samples[0]).toBeGreaterThan(0);
  expect(samples[1]).toBeGreaterThan(0);
  expect(samples[2]).toBe(0);
  await expect(page.getByRole('cell', { name: '3.123456789012345678', exact: true })).toBeVisible();
});
test('geometry budget keeps the data alternative and selection emits exact result identity', async ({ page }) => {
  await page.evaluate(async () => {
    const p = (window as any).plot;
    p.maxMarks = 1;
    p.addEventListener('aeliqo-plot-select', (event: any) => {
      (window as any).selection = event.detail;
    });
    await p.updateComplete;
  });
  await expect(page.getByRole('status')).toContainText('exceeds the mark budget');
  await expect(page.locator('aeliqo-plot svg')).toHaveCount(0);
  await page.getByRole('button', { name: 'Select a', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Select a', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(async () => {
    const p = (window as any).plot;
    p.selectedIdentity = (window as any).selection.identity;
    await p.updateComplete;
  });
  await expect(page.getByRole('button', { name: 'Select a', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const selected = await page.evaluate(() => (window as any).selection);
  expect(selected.source).toBe('user');
  expect(selected.result.scopeDigest).toBe('scope-1');
  expect(selected.identity).toContain('a');
});

test('facet and layer compose real marks, data partitions and Canvas, then clear stale scope', async ({ page }) => {
  await page.evaluate(async () => {
    const p = (window as any).plot;
    p.results = [p.result];
    p.datasets = [{ result: p.result.ref, rows: p.rows }];
    p.spec = {
      version: '1',
      root: {
        kind: 'facet',
        field: 'id',
        scales: 'shared-compatible',
        child: { kind: 'layer', scales: 'shared-compatible', children: [p.unit, { ...p.unit, mark: 'point' }] },
      },
    };
    await p.updateComplete;
  });
  await expect(page.locator('aeliqo-plot [part=facet]')).toHaveCount(1);
  await expect(page.locator('aeliqo-plot [part=layer]')).toHaveCount(3);
  await expect(page.locator('aeliqo-plot table')).toHaveCount(6);
  await expect(page.locator('aeliqo-plot tbody tr')).toHaveCount(6);
  await expect(page.locator('aeliqo-plot circle')).toHaveCount(4);
  await page.evaluate(async () => {
    const p = (window as any).plot;
    p.renderer = 'canvas';
    await p.updateComplete;
  });
  await expect(page.locator('canvas')).toHaveCount(4);
  for (const id of ['a', 'b', 'c']) {
    const facet = page.locator(`aeliqo-plot [part=facet] > section[aria-label="id: ${id}"]`);
    await expect(facet.locator('canvas')).toHaveCount(id === 'b' ? 0 : 2);
    await expect(facet.locator('table')).toHaveCount(2);
    await expect(facet.getByRole('button', { name: `Select ${id}`, exact: true })).toHaveCount(2);
    if (id === 'b') {
      await expect(facet.getByRole('cell', { name: 'Missing', exact: true })).toHaveCount(2);
      await expect(facet.getByRole('status').first()).toContainText('No plottable observations');
    }
  }
  const nonEmpty = await page.locator('canvas').evaluateAll(
    (nodes) =>
      nodes.filter((n) => {
        const c = n as HTMLCanvasElement;
        return c
          .getContext('2d')!
          .getImageData(0, 0, c.width, c.height)
          .data.some((v, i) => i % 4 === 3 && v > 0);
      }).length,
  );
  expect(nonEmpty).toBe(4);
  await page.evaluate(async () => {
    const p = (window as any).plot;
    p.results = [];
    await p.updateComplete;
  });
  await expect(page.locator('aeliqo-plot table')).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('composition selection cannot resurrect under a replaced or revoked result scope', async ({ page }) => {
  await page.evaluate(async () => {
    const p = (window as any).plot;
    p.results = [p.result];
    p.datasets = [{ result: p.result.ref, rows: p.rows }];
    p.spec = { version: '1', root: p.unit };
    await p.updateComplete;
    p.addEventListener('aeliqo-plot-select', (e: any) => {
      p.selectedIdentity = e.detail.identity;
    });
  });
  await page.getByRole('button', { name: 'Select a', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select a', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(async () => {
    const p = (window as any).plot;
    const result = { ...p.result, ref: { ...p.result.ref, scopeDigest: 'new-scope' } };
    p.results = [result];
    p.datasets = [{ result: result.ref, rows: p.rows }];
    p.spec = { version: '1', root: { ...p.unit, result: result.ref } };
    await p.updateComplete;
  });
  await expect(page.getByRole('button', { name: 'Select a', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Select a', exact: true }).click();
  await page.evaluate(async () => {
    const p = (window as any).plot;
    p.results = [];
    await p.updateComplete;
  });
  await expect(page.locator('aeliqo-plot table')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).plot.selectedIdentity)).toBe('');
});
