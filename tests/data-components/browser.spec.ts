import { expect, test } from '@playwright/test';

test('native table preserves exact values, stable identity and scope', async ({ page }) => {
  await page.goto('/tests/data-components/index.html');
  const table = page.locator('#table');
  await expect(table.locator('table')).toHaveCount(1);
  await expect(table.locator('td').filter({ hasText: '100000000000000000.01' })).toHaveCount(1);
  await expect(table.locator('[part=scope]')).toHaveText('Showing 2 of 100 matching records');
  await table.locator('input[type=checkbox]').first().check();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { dataFixture: { events: { type: string; detail: { keys?: string[] } }[] } }
          ).dataFixture.events.findLast((event) => event.type === 'aeliqo-table-selection')?.detail.keys,
      ),
    )
    .toEqual(['string:1:a']);
  const selection = await table
    .locator('input[type=checkbox]')
    .first()
    .evaluate((input) => (input as HTMLInputElement).getAttribute('aria-label'));
  expect(selection).toBe('Select row a');
});

test('grid mode is explicit and virtualization remains bounded', async ({ page }) => {
  await page.goto('/tests/data-components/index.html');
  const grid = page.locator('#grid');
  await expect(grid.locator('[role=grid]')).toHaveCount(1);
  await expect(grid.locator('[role=grid]')).toHaveAttribute('aria-rowcount', '101');
  await expect(grid.locator("[role=row][aria-rowindex='1']")).toHaveCount(1);
  await expect(grid.locator("[role=gridcell][data-col-index='0']").first()).toHaveAttribute('aria-colindex', '1');
  await expect(grid.locator('[role=row][data-row-index]')).toHaveCount(1);
  await expect(grid.locator('[part=scope]')).toHaveText('1 of 2 rows on screen; Showing 2 of 100 matching records.');
  const firstCell = grid.locator("[role=gridcell][data-row-index='0'][data-col-index='0']");
  await firstCell.focus();
  await page.keyboard.press('ArrowRight');
  await expect(grid.locator("[role=gridcell][data-row-index='0'][data-col-index='1']")).toBeFocused();
  await page.evaluate(async () => {
    const table = document.querySelector('#grid') as any;
    table.virtualized = false;
    await table.updateComplete;
  });
  await grid.locator("[role=gridcell][data-row-index='0'][data-col-index='0']").focus();
  await page.keyboard.press('ArrowDown');
  await expect(grid.locator("[role=gridcell][data-row-index='1'][data-col-index='0']")).toBeFocused();
});

test('malformed virtual windows remain bounded and keyboard requests reach the host', async ({ page }) => {
  await page.goto('/tests/data-components/index.html');
  const grid = page.locator('#grid');
  await page.evaluate(async () => {
    const table = document.querySelector('#grid') as any;
    table.rows = Array.from({ length: 250 }, (_, index) => ({
      id: `row-${index}`,
      name: `Row ${index}`,
      amount: { decimal: String(index) },
    }));
    table.virtualized = true;
    table.virtualStart = Number.POSITIVE_INFINITY;
    table.virtualCount = Number.POSITIVE_INFINITY;
    table.overscan = Number.NaN;
    await table.updateComplete;
  });
  const mountedRows = grid.locator('[role=row][data-row-index]');
  await expect(mountedRows).toHaveCount(44);
  await expect(grid.locator("[role=gridcell][tabindex='0']")).toHaveCount(1);
  await grid.locator("[role=gridcell][data-row-index='43'][data-col-index='0']").focus();
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).dataFixture.events.findLast((event: any) => event.type === 'aeliqo-table-window')?.detail,
      ),
    )
    .toEqual({
      start: 44,
      count: 40,
      overscan: 4,
      row: 44,
      column: 0,
      reason: 'keyboard',
    });
  await page.evaluate(async () => {
    const table = document.querySelector('#grid') as any;
    table.virtualStart = 44;
    await table.updateComplete;
  });
  await expect(grid.locator("[role=gridcell][data-row-index='44'][data-col-index='0']")).toBeFocused();
});

test('grid focus follows stable identity across reorder and falls back after removal', async ({ page }) => {
  await page.goto('/tests/data-components/index.html');
  const grid = page.locator('#grid');
  await page.evaluate(async () => {
    const table = document.querySelector('#grid') as any;
    table.virtualized = false;
    await table.updateComplete;
  });
  await grid.locator("[role=gridcell][data-row-index='1'][data-col-index='0']").focus();
  await page.evaluate(async () => {
    const table = document.querySelector('#grid') as any;
    table.rows = [table.rows[1], table.rows[0], { id: 'row-c', name: 'Row C', amount: { decimal: '3' } }];
    await table.updateComplete;
  });
  await expect(grid.locator("[role=gridcell][data-row-index='0'][data-col-index='0']")).toHaveAttribute(
    'tabindex',
    '0',
  );
  await page.evaluate(async () => {
    const table = document.querySelector('#grid') as any;
    table.rows = table.rows.slice(1);
    await table.updateComplete;
  });
  await expect(grid.locator("[role=gridcell][tabindex='0']")).toHaveCount(1);
  await expect(grid.locator("[role=gridcell][data-row-index='0'][data-col-index='0']")).toHaveAttribute(
    'tabindex',
    '0',
  );
});

test('filter typing is draft-only and Apply emits the typed predicate', async ({ page }) => {
  await page.goto('/tests/data-components/index.html');
  const filter = page.locator('#filter');
  const input = filter.locator('input[part=value]');
  await input.fill('Ada');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { dataFixture: { events: { type: string }[] } }).dataFixture.events.filter(
          (event) => event.type === 'aeliqo-filter-change',
        ).length,
    ),
  ).toBe(0);
  await filter.locator('button[part=apply]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              dataFixture: {
                events: { type: string; detail: { predicate?: { op: string; field: string; value: string } } }[];
              };
            }
          ).dataFixture.events.findLast((event) => event.type === 'aeliqo-filter-change')?.detail.predicate,
      ),
    )
    .toEqual({ op: 'compare', field: 'name', value: 'Ada', comparison: 'eq' });
});

test('filter conditions can be added and removed without committing a draft', async ({ page }) => {
  await page.goto('/tests/data-components/index.html');
  const filter = page.locator('#filter');
  await filter.locator('select[part=field]').first().selectOption('name');
  await filter.locator('input[part=value]').first().fill('Ada');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { dataFixture: { events: { type: string }[] } }).dataFixture.events.filter(
          (event) => event.type === 'aeliqo-filter-change',
        ).length,
    ),
  ).toBe(0);

  await filter.getByRole('button', { name: 'Add condition', exact: true }).click();
  await expect(filter.locator('[part=clause]')).toHaveCount(2);
  await filter.locator('select[part=field]').nth(1).selectOption('name');
  await filter.locator('input[part=value]').nth(1).fill('Lin');
  const removeSecond = filter.locator('button[part=remove-condition]').nth(1);
  await removeSecond.focus();
  await removeSecond.press('Enter');
  await expect(filter.locator('[part=clause]')).toHaveCount(1);
  await expect(filter.locator('select[part=field]').first()).toBeFocused();
  await expect(filter.locator('button[part=remove-condition]').first()).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { dataFixture: { events: { type: string }[] } }).dataFixture.events.filter(
          (event) => event.type === 'aeliqo-filter-change',
        ).length,
    ),
  ).toBe(0);

  await filter.locator('button[part=apply]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).dataFixture.events.findLast((event: any) => event.type === 'aeliqo-filter-change')?.detail
            .predicate,
      ),
    )
    .toEqual({ op: 'compare', field: 'name', value: 'Ada', comparison: 'eq' });
  const beforeAutoApply = await page.evaluate(
    () => (window as any).dataFixture.events.filter((event: any) => event.type === 'aeliqo-filter-change').length,
  );

  await page.evaluate(async () => {
    const filter = document.querySelector('#filter') as any;
    filter.autoApply = true;
    filter.clauses = [
      { field: 'name', operator: 'eq', value: 'Ada' },
      { field: 'name', operator: 'eq', value: 'Lin' },
    ];
    await filter.updateComplete;
  });
  const autoApplyRemove = filter.locator('button[part=remove-condition]').nth(1);
  await autoApplyRemove.focus();
  await autoApplyRemove.press('Enter');
  await expect(filter.locator('select[part=field]').first()).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).dataFixture.events.filter((event: any) => event.type === 'aeliqo-filter-change').length,
      ),
    )
    .toBe(beforeAutoApply + 1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).dataFixture.events.findLast((event: any) => event.type === 'aeliqo-filter-change')?.detail
            .predicate,
      ),
    )
    .toEqual({ op: 'compare', field: 'name', value: 'Ada', comparison: 'eq' });
});

test('filter condition editing stays bounded and locked while loading', async ({ page }) => {
  await page.goto('/tests/data-components/index.html');
  const filter = page.locator('#filter');
  await page.evaluate(async () => {
    const filter = document.querySelector('#filter') as any;
    filter.clauses = Array.from({ length: 127 }, () => ({ field: 'name', operator: 'eq', value: 'Ada' }));
    await filter.updateComplete;
  });
  await expect(filter.locator('[part=clause]')).toHaveCount(127);
  const add = filter.locator('button[part=add-condition]');
  await expect(add).toBeDisabled();
  await add.dispatchEvent('click');
  await expect(filter.locator('[part=clause]')).toHaveCount(127);

  await page.evaluate(async () => {
    const filter = document.querySelector('#filter') as any;
    filter.clauses = [
      { field: 'name', operator: 'eq', value: 'Ada' },
      { field: 'name', operator: 'eq', value: 'Lin' },
    ];
    filter.status = 'loading';
    await filter.updateComplete;
  });
  await filter.locator('button[part=remove-condition]').nth(1).dispatchEvent('click');
  await expect(filter.locator('[part=clause]')).toHaveCount(2);
});

test('compound predicates and multiple clauses remain visible and intact on Apply', async ({ page }) => {
  await page.goto('/tests/data-components/index.html');
  await page.evaluate(async () => {
    const filter = document.querySelector('#filter') as any;
    filter.fields = [
      { id: 'name', label: 'Name', type: 'text' },
      { id: 'amount', label: 'Amount', type: 'decimal' },
    ];
    filter.predicate = {
      op: 'and',
      predicates: [
        { op: 'compare', field: 'name', comparison: 'eq', value: 'Ada' },
        { op: 'compare', field: 'amount', comparison: 'gt', value: { decimal: '2.50' } },
      ],
    };
    filter.clauses = [];
    await filter.updateComplete;
  });
  const filter = page.locator('#filter');
  await expect(filter.locator('[part=clause]')).toHaveCount(2);
  await expect(filter.locator('select[part=field]').nth(0)).toHaveValue('name');
  await expect(filter.locator('select[part=field]').nth(1)).toHaveValue('amount');
  await expect(filter.locator('input[part=value]').nth(1)).toHaveValue('2.50');
  await filter.locator('button[part=apply]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).dataFixture.events.findLast((event: any) => event.type === 'aeliqo-filter-change')?.detail
            .predicate,
      ),
    )
    .toEqual({
      op: 'and',
      predicates: [
        { op: 'compare', field: 'name', comparison: 'eq', value: 'Ada' },
        { op: 'compare', field: 'amount', comparison: 'gt', value: { decimal: '2.50' } },
      ],
    });
});

test('explicit clauses stay visible and unsupported nested predicates stay read-only', async ({ page }) => {
  await page.goto('/tests/data-components/index.html');
  await page.evaluate(async () => {
    const filter = document.querySelector('#filter') as any;
    filter.fields = [
      { id: 'name', label: 'Name', type: 'text' },
      { id: 'amount', label: 'Amount', type: 'decimal' },
    ];
    filter.predicate = undefined;
    filter.logical = 'or';
    filter.clauses = [
      { field: 'name', operator: 'eq', value: 'Ada' },
      { field: 'amount', operator: 'gt', value: '2.50' },
    ];
    await filter.updateComplete;
  });
  const filter = page.locator('#filter');
  await expect(filter.locator('[part=clause]')).toHaveCount(2);
  await expect(filter.locator('select[part=field]').nth(0)).toHaveValue('name');
  await expect(filter.locator('select[part=field]').nth(1)).toHaveValue('amount');

  await page.evaluate(async () => {
    const filter = document.querySelector('#filter') as any;
    filter.clauses = [];
    filter.predicate = { op: 'not', predicate: { op: 'compare', field: 'name', comparison: 'eq', value: 'Ada' } };
    await filter.updateComplete;
  });
  await expect(filter.locator('[part=unsupported-predicate]')).toBeVisible();
  await expect(filter.locator('button[part=apply]')).toBeDisabled();

  await page.evaluate(async () => {
    const filter = document.querySelector('#filter') as any;
    filter.predicate = { op: 'compare', field: 'name', comparison: 'eq', value: null };
    await filter.updateComplete;
  });
  await expect(filter.locator('[part=unsupported-predicate]')).toBeVisible();
  await expect(filter.locator('button[part=apply]')).toBeDisabled();
});

test('membership values preserve commas and inherited predicates are visibly read-only', async ({ page }) => {
  await page.goto('/tests/data-components/index.html');
  await page.evaluate(async () => {
    const filter = document.querySelector('#filter') as any;
    filter.fields = [{ id: 'name', label: 'Name', type: 'text' }];
    filter.predicate = { op: 'in', field: 'name', values: ['ACME, Inc', 'Other'] };
    filter.inherited = {
      op: 'and',
      predicates: [
        { op: 'compare', field: 'name', comparison: 'ne', value: 'Blocked' },
        {
          op: 'or',
          predicates: [
            { op: 'compare', field: 'name', comparison: 'eq', value: 'Ada' },
            { op: 'compare', field: 'name', comparison: 'eq', value: 'Lin' },
          ],
        },
      ],
    };
    await filter.updateComplete;
  });
  const filter = page.locator('#filter');
  await expect(filter.locator('input[part=value]')).toHaveValue('["ACME, Inc","Other"]');
  await expect(filter.locator('[part=inherited-predicate]')).toContainText(
    'Inherited filter (read-only): name ne Blocked AND (name eq Ada OR name eq Lin)',
  );
  await filter.locator('button[part=apply]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).dataFixture.events.findLast((event: any) => event.type === 'aeliqo-filter-change')?.detail
            .predicate,
      ),
    )
    .toEqual({
      op: 'and',
      predicates: [
        {
          op: 'and',
          predicates: [
            { op: 'compare', field: 'name', comparison: 'ne', value: 'Blocked' },
            {
              op: 'or',
              predicates: [
                { op: 'compare', field: 'name', comparison: 'eq', value: 'Ada' },
                { op: 'compare', field: 'name', comparison: 'eq', value: 'Lin' },
              ],
            },
          ],
        },
        { op: 'in', field: 'name', values: ['ACME, Inc', 'Other'] },
      ],
    });
});

test('text compare and membership values preserve whitespace and empty strings', async ({ page }) => {
  await page.goto('/tests/data-components/index.html');
  await page.evaluate(async () => {
    const filter = document.querySelector('#filter') as any;
    filter.fields = [{ id: 'name', label: 'Name', type: 'text' }];
    filter.inherited = undefined;
    filter.predicate = { op: 'compare', field: 'name', comparison: 'eq', value: ' ACME ' };
    await filter.updateComplete;
  });
  const filter = page.locator('#filter');
  await expect(filter.locator('input[part=value]')).toHaveValue(' ACME ');
  await filter.locator('button[part=apply]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).dataFixture.events.findLast((event: any) => event.type === 'aeliqo-filter-change')?.detail
            .predicate,
      ),
    )
    .toEqual({
      op: 'compare',
      field: 'name',
      comparison: 'eq',
      value: ' ACME ',
    });

  await page.evaluate(async () => {
    const filter = document.querySelector('#filter') as any;
    filter.predicate = { op: 'in', field: 'name', values: [' ACME ', ''] };
    await filter.updateComplete;
  });
  await expect(filter.locator('input[part=value]')).toHaveValue('[" ACME ",""]');
  await filter.locator('button[part=apply]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).dataFixture.events.findLast((event: any) => event.type === 'aeliqo-filter-change')?.detail
            .predicate,
      ),
    )
    .toEqual({
      op: 'in',
      field: 'name',
      values: [' ACME ', ''],
    });
});

test('nullable text membership preserves null separately from an empty string', async ({ page }) => {
  await page.goto('/tests/data-components/index.html');
  await page.evaluate(async () => {
    const filter = document.querySelector('#filter') as any;
    filter.fields = [{ id: 'name', label: 'Name', type: 'text', nullable: true }];
    filter.predicate = { op: 'in', field: 'name', values: [null, ''] };
    await filter.updateComplete;
  });
  const filter = page.locator('#filter');
  await expect(filter.locator('input[part=value]')).toHaveValue('[null,""]');
  await filter.locator('button[part=apply]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).dataFixture.events.findLast((event: any) => event.type === 'aeliqo-filter-change')?.detail
            .predicate,
      ),
    )
    .toEqual({
      op: 'in',
      field: 'name',
      values: [null, ''],
    });
});

test('equivalent predicate refreshes preserve the active filter draft', async ({ page }) => {
  await page.goto('/tests/data-components/index.html');
  await page.evaluate(async () => {
    const filter = document.querySelector('#filter') as any;
    filter.fields = [{ id: 'name', label: 'Name', type: 'text' }];
    filter.entity = 'customers';
    filter.predicate = { op: 'compare', entity: 'customers', field: 'name', comparison: 'eq', value: 'Initial' };
    await filter.updateComplete;
  });
  const filter = page.locator('#filter');
  await filter.locator('input[part=value]').fill('Draft');
  await page.evaluate(async () => {
    const filter = document.querySelector('#filter') as any;
    filter.predicate = structuredClone(filter.predicate);
    filter.scopeLabel = 'Updated scope';
    await filter.updateComplete;
  });
  await expect(filter.locator('input[part=value]')).toHaveValue('Draft');
  await page.evaluate(async () => {
    const element = document.querySelector('#filter') as any;
    element.entity = 'orders';
    await element.updateComplete;
  });
  await expect(filter.locator('[part=unsupported-predicate]')).toBeVisible();
  await expect(filter.locator('button[part=apply]')).toBeDisabled();
});

test('qualified predicates never apply under a different builder entity', async ({ page }) => {
  await page.goto('/tests/data-components/index.html');
  await page.evaluate(async () => {
    const filter = document.querySelector('#filter') as any;
    filter.fields = [{ id: 'status', label: 'Status', type: 'text' }];
    filter.entity = 'customers';
    filter.predicate = { op: 'compare', entity: 'orders', field: 'status', comparison: 'eq', value: 'open' };
    await filter.updateComplete;
  });
  const filter = page.locator('#filter');
  await expect(filter.locator('[part=unsupported-predicate]')).toBeVisible();
  await expect(filter.locator('button[part=apply]')).toBeDisabled();

  await page.evaluate(async () => {
    const element = document.querySelector('#filter') as any;
    element.predicate = { op: 'compare', entity: 'customers', field: 'status', comparison: 'eq', value: 'open' };
    await element.updateComplete;
  });
  await filter.locator('button[part=apply]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).dataFixture.events.findLast((event: any) => event.type === 'aeliqo-filter-change')?.detail
            .predicate,
      ),
    )
    .toEqual({
      op: 'compare',
      entity: 'customers',
      field: 'status',
      comparison: 'eq',
      value: 'open',
    });

  await page.evaluate(async () => {
    const element = document.querySelector('#filter') as any;
    element.predicate = undefined;
    element.clauses = [{ field: 'status', operator: 'eq', value: 'draft' }];
    await element.updateComplete;
  });
  await filter.locator('button[part=apply]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).dataFixture.events.findLast((event: any) => event.type === 'aeliqo-filter-change')?.detail
            .predicate,
      ),
    )
    .toEqual({
      op: 'compare',
      entity: 'customers',
      field: 'status',
      comparison: 'eq',
      value: 'draft',
    });
});

test('RTL scope prose and long metric numbers keep their reading order', async ({ page }) => {
  await page.goto('/tests/data-components/index.html');
  await page.evaluate(async () => {
    document.documentElement.dir = 'rtl';
    const table = document.querySelector('#table') as any;
    table.scope = { loaded: 2, filteredTotal: 100, kind: 'filtered' };
    table.totalRows = 100;
    const metric = document.querySelector('#metric') as any;
    metric.style.inlineSize = '8rem';
    metric.value = { decimal: '100000000000000000.01' };
    await Promise.all([table.updateComplete, metric.updateComplete]);
  });
  const tableScope = page.locator('#table [part=scope]');
  await expect(tableScope).toContainText('Showing 2 of 100 matching records');
  await expect.poll(() => tableScope.evaluate((element) => getComputedStyle(element).unicodeBidi)).toBe('plaintext');
  const metricNumber = page.locator('#metric [part=number]');
  await expect(metricNumber).toHaveAttribute('dir', 'ltr');
  await expect(metricNumber).toHaveText('100000000000000000.01');
  await expect
    .poll(() =>
      metricNumber.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          direction: style.direction,
          whiteSpace: style.whiteSpace,
          overflowX: style.overflowX,
          clipped: element.scrollWidth > element.clientWidth,
        };
      }),
    )
    .toEqual({ direction: 'ltr', whiteSpace: 'nowrap', overflowX: 'auto', clipped: true });
  await metricNumber.focus();
  await expect(metricNumber).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => metricNumber.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.emulateMedia({ forcedColors: 'active' });
  await expect
    .poll(() =>
      metricNumber.evaluate((element) => {
        const style = getComputedStyle(element);
        return { width: style.outlineWidth, style: style.outlineStyle };
      }),
    )
    .toEqual({ width: '2px', style: 'solid' });
  await page.locator('#metric').evaluate(async (element: any) => {
    element.displayValue = 'غير متاح';
    await element.updateComplete;
  });
  await expect(metricNumber).toHaveAttribute('dir', 'auto');
  await expect(metricNumber).not.toHaveAttribute('tabindex');
  await expect(metricNumber).toHaveText('غير متاح');
});
