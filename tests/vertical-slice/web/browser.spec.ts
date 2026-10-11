import { expect, test } from '@playwright/test';

test('keyed region children retain focus and controlled draft state across reorder', async ({ page }) => {
  await page.goto('/tests/vertical-slice/web/browser.html');
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { aeliqoReady?: boolean }).aeliqoReady))
    .toBe(true);
  const filter = page.locator('aeliqo-text-field[data-aeliqo-node-id="filter-a"]');
  await filter.evaluate(async (element) => {
    const input = element as HTMLElement & { value: string; updateComplete: Promise<unknown> };
    input.value = 'draft';
    await input.updateComplete;
    input.focus();
  });
  await page.evaluate(async () => {
    const app = window as typeof window & { reorderFilters: () => void };
    app.reorderFilters();
    await (document.querySelector('aeliqo-region') as HTMLElement & { updateComplete: Promise<unknown> })
      .updateComplete;
  });
  await expect(filter.locator('input')).toHaveValue('draft');
  const focus = await page.evaluate(() => {
    const region = document.querySelector('aeliqo-region') as HTMLElement;
    const child = region.shadowRoot?.querySelector(
      'aeliqo-text-field[data-aeliqo-node-id="filter-a"]',
    ) as HTMLElement | null;
    return (
      document.activeElement === region &&
      region.shadowRoot?.activeElement === child &&
      child?.shadowRoot?.activeElement?.tagName === 'INPUT'
    );
  });
  expect(focus).toBe(true);
});

test('region emits trusted table selection, clears explicitly, and keeps long form series separate', async ({
  page,
}) => {
  await page.goto('/tests/vertical-slice/web/browser.html');
  await page.evaluate(async () => {
    const app = window as typeof window & { mountSelection: () => void };
    app.mountSelection();
    await (document.querySelector('aeliqo-region') as HTMLElement & { updateComplete: Promise<unknown> })
      .updateComplete;
  });
  const checkbox = page.locator('aeliqo-table[data-aeliqo-node-id="table"] input[type="checkbox"]').first();
  await checkbox.check();
  const selected = await page.evaluate(() => (window as typeof window & { aeliqoEvents: any[] }).aeliqoEvents.at(-1));
  expect(selected.payload.selection).toMatchObject({
    mode: 'ids',
    entity: 'employees',
    keys: ['string:2:e1'],
    result: { outputId: 'rows' },
  });
  const eventCount = await page.evaluate(() => (window as typeof window & { aeliqoEvents: any[] }).aeliqoEvents.length);
  await page.locator('aeliqo-table[data-aeliqo-node-id="table"]').evaluate((element) => {
    element.dispatchEvent(
      new CustomEvent('aeliqo-table-selection', {
        bubbles: true,
        composed: true,
        detail: {
          mode: 'ids',
          entity: 'other',
          keys: ['e1'],
          result: { id: 'forged', revision: '1', outputId: 'rows', queryDigest: 'query', scopeDigest: 'scope' },
        },
      }),
    );
  });
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { aeliqoEvents: any[] }).aeliqoEvents.length))
    .toBe(eventCount);
  await checkbox.uncheck();
  const cleared = await page.evaluate(() => (window as typeof window & { aeliqoEvents: any[] }).aeliqoEvents.at(-1));
  expect(cleared.payload.selection).toEqual({ mode: 'clear' });

  const beforeMalformed = await page.evaluate(
    () => (window as typeof window & { aeliqoEvents: any[] }).aeliqoEvents.length,
  );
  await page.evaluate(async () => {
    const region = document.querySelector('aeliqo-region') as HTMLElement & { updateComplete: Promise<unknown> };
    const table = region.shadowRoot?.querySelector('aeliqo-table[data-aeliqo-node-id="table"]');
    if (table === null || table === undefined) throw new Error('table did not mount');
    for (const detail of [
      null,
      { mode: 'clear', entity: 'other', keys: [] },
      { mode: 'ids', entity: 42, keys: ['e1'] },
      { mode: 'ids', entity: 'employees', keys: ['e1'], result: {} },
    ]) {
      table.dispatchEvent(new CustomEvent('aeliqo-table-selection', { bubbles: true, composed: true, detail }));
    }
  });
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { aeliqoEvents: any[] }).aeliqoEvents.length))
    .toBe(beforeMalformed);

  await page.evaluate(async () => {
    const region = document.querySelector('aeliqo-region') as HTMLElement;
    const table = region.shadowRoot?.querySelector('aeliqo-table[data-aeliqo-node-id="table"]') as
      (HTMLElement & { selection: string; updateComplete: Promise<unknown> }) | null;
    if (table === null || table === undefined) throw new Error('table did not mount');
    table.selection = 'single';
    await table.updateComplete;
  });
  const radioNames = await page
    .locator('aeliqo-table[data-aeliqo-node-id="table"] input[type="radio"]')
    .evaluateAll((inputs) => inputs.map((input) => input.getAttribute('name')));
  expect(radioNames.length).toBe(2);
  expect(new Set(radioNames).size).toBe(1);
  await page.evaluate(async () => {
    const region = document.querySelector('aeliqo-region') as HTMLElement;
    const table = region.shadowRoot?.querySelector('aeliqo-table[data-aeliqo-node-id="table"]') as
      (HTMLElement & { selectedKeys: readonly string[]; updateComplete: Promise<unknown> }) | null;
    if (table === null || table === undefined) throw new Error('table did not mount');
    table.selectedKeys = ['string:2:e2'];
    await table.updateComplete;
  });
  await expect(page.locator('aeliqo-table[data-aeliqo-node-id="table"] input[type="radio"]').nth(1)).toHaveAttribute(
    'aria-label',
    'Select employees e2',
  );

  await page.evaluate(async () => {
    const app = window as typeof window & { mountFilters: () => void };
    const region = document.querySelector('aeliqo-region') as HTMLElement & { updateComplete: Promise<unknown> };
    app.mountFilters();
    await region.updateComplete;
    const filter = region.shadowRoot?.querySelector('aeliqo-text-field[data-aeliqo-node-id="filter-a"]');
    if (filter === null || filter === undefined) throw new Error('filter did not mount');
    for (const detail of [undefined, { value: 'forged', source: 'program' }, { value: 42, source: 'user' }]) {
      filter.dispatchEvent(new CustomEvent('aeliqo-input-change', { bubbles: true, composed: true, detail }));
    }
    await region.updateComplete;
  });
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { aeliqoEvents: any[] }).aeliqoEvents.length))
    .toBe(beforeMalformed);

  await page.evaluate(async () => {
    const app = window as typeof window & { mountTrend: () => void };
    app.mountTrend();
    await (document.querySelector('aeliqo-region') as HTMLElement & { updateComplete: Promise<unknown> })
      .updateComplete;
  });
  const chart = page.locator('aeliqo-chart[data-aeliqo-node-id="trend"]');
  await expect(chart.locator('svg [part="line"]')).toHaveCount(8);
  const svgGeometry = await chart.evaluate((element) =>
    [...(element.shadowRoot?.querySelectorAll('polyline') ?? [])].map((line) => {
      const svgLine = line as SVGPolylineElement;
      const box = svgLine.getBBox();
      return {
        namespace: line.namespaceURI,
        width: box.width,
        height: box.height,
        points: line.getAttribute('points'),
      };
    }),
  );
  expect(svgGeometry).toHaveLength(8);
  expect(svgGeometry.every((line) => line.namespace === 'http://www.w3.org/2000/svg' && line.points !== null)).toBe(
    true,
  );
  expect(svgGeometry.some((line) => line.width > 0 && line.height > 0)).toBe(true);
  await page.emulateMedia({ forcedColors: 'active' });
  const forcedColorDashArrays = await chart.evaluate((element) =>
    Array.from({ length: 5 }, (_, index) => {
      const line = element.shadowRoot?.querySelector(`polyline.series-${index}`);
      return line === null || line === undefined ? 'missing' : getComputedStyle(line).strokeDasharray;
    }),
  );
  expect(new Set(forcedColorDashArrays).size).toBe(5);
  await page.emulateMedia({ forcedColors: null });
  await expect(chart.locator('[part="legend"] li')).toHaveCount(5);
  await expect(chart.locator('[part="legend"] [part="legend-marker"].style-1')).toHaveCount(1);
  await chart.locator('details summary').click();
  await expect(chart.locator('thead th')).toHaveCount(6);
  await expect(chart.locator('tbody tr')).toHaveCount(4);
  await expect(chart.locator('tbody td').filter({ hasText: '—' })).toHaveCount(7);
  await expect(chart.locator('tbody tr').nth(3).locator('td').nth(4)).toHaveText('6');

  await page.evaluate(async () => {
    const app = window as typeof window & { mountSubMillisecondTrend: () => void };
    app.mountSubMillisecondTrend();
    await (document.querySelector('aeliqo-region') as HTMLElement & { updateComplete: Promise<unknown> })
      .updateComplete;
  });
  const subChart = page.locator('aeliqo-chart[data-aeliqo-node-id="trend"]');
  await subChart.locator('details summary').click();
  await expect(subChart.locator('tbody tr')).toHaveCount(2);
  await expect(subChart.locator('svg [part="point"]')).toHaveCount(2);
});

test('unmount during resize adaptation prevents a detached Region from restoring presentation', async ({ page }) => {
  await page.goto('/tests/vertical-slice/web/app-lifecycle.html');
  const result = await page.evaluate(async () => {
    const start = (
      window as typeof window & {
        startResizeUnmount?: () => Promise<{
          unmountResult: boolean;
          detached: boolean;
          presentationCleared: boolean;
          resultsCleared: boolean;
        }>;
      }
    ).startResizeUnmount;
    if (start === undefined) throw new Error('resize lifecycle fixture did not mount');
    return start();
  });
  expect(result).toEqual({
    unmountResult: true,
    detached: true,
    presentationCleared: true,
    resultsCleared: true,
  });
});
