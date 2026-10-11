import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

type FixtureWindow = Window & { compoundFixture: { events: { type: string; detail: any }[] } };

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/compound/index.html');
  await expect(page.locator('#explorer').getByRole('heading', { name: 'Explore', exact: true })).toHaveText('Explore');
});

test('explorer forwards filter and stable identity selection to the host', async ({ page }) => {
  const explorer = page.locator('#explorer');
  const filter = explorer.locator('aeliqo-filter-builder');
  await filter.locator('input[part=value]').fill('Ada');
  await filter.locator('button[part=apply]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as FixtureWindow).compoundFixture.events.findLast(
            (event) => event.type === 'aeliqo-explorer-filter',
          )?.detail.predicate,
      ),
    )
    .toEqual({ op: 'compare', entity: 'person', field: 'name', value: 'Ada', comparison: 'eq' });

  const record = explorer.locator('aeliqo-record-list').locator('button[part=record-button]').first();
  await record.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as FixtureWindow).compoundFixture.events.findLast(
            (event) => event.type === 'aeliqo-explorer-selection',
          )?.detail.keys,
      ),
    )
    .toEqual(['string:1:a']);
  await expect(explorer.locator('aeliqo-detail').locator('[part=identity]')).toHaveCount(0);
  await expect(explorer.locator('aeliqo-detail').locator('[part=detail]')).toHaveAttribute(
    'data-identity',
    'string:1:a',
  );
  await expect(explorer.locator('aeliqo-detail')).toContainText('Authorized people');
});

test('comparison and breakdown use shared bounded tables and host evaluated values', async ({ page }) => {
  const comparison = page.locator('#comparison');
  await expect(comparison.locator('aeliqo-table')).toHaveCount(1);
  await expect(comparison.locator('aeliqo-table').getByRole('columnheader')).toHaveCount(4);
  await expect(comparison.locator('aeliqo-table').locator('[part=heading]').first()).toHaveText('Metric');
  await expect
    .poll(() =>
      page.locator('#comparison').evaluate((element) => {
        const table = (element as any).renderRoot.querySelector('aeliqo-table') as any;
        return {
          identity: table.identity,
          columns: table.columns.map((column: { key: string }) => column.key),
          firstMetric: table.rows[0]?.metric,
        };
      }),
    )
    .toEqual({
      identity: ['metricId'],
      columns: ['metric', 'comparison:a', 'comparison:b', 'comparison:metric'],
      firstMetric: 'Amount (USD)',
    });
  await comparison.getByRole('button', { name: 'Alpha', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as FixtureWindow).compoundFixture.events.findLast(
            (event) => event.type === 'aeliqo-comparison-set',
          )?.detail,
      ),
    )
    .toMatchObject({ keys: ['b', 'metric'], scope: { label: 'Authorized people' } });

  const breakdown = page.locator('#breakdown');
  await expect(breakdown.locator('aeliqo-table')).toHaveCount(1);
  await expect(breakdown.locator('aeliqo-table')).toContainText('25%');
  await expect
    .poll(() =>
      breakdown.locator('aeliqo-table').evaluate((element) =>
        (element as any).rows.map((row: Record<string, unknown>) => ({
          group: row.group,
          metric: row.metric,
        })),
      ),
    )
    .toEqual([{ group: 'North', metric: '25%' }]);
  await breakdown.locator('aeliqo-table input[type=radio]').first().check();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as FixtureWindow).compoundFixture.events.findLast(
            (event) => event.type === 'aeliqo-breakdown-group',
          )?.detail,
      ),
    )
    .toMatchObject({ key: 'north', scope: { label: 'Authorized people' } });
});

test('comparison interactions reject overflow and normalize duplicate keys', async ({ page }) => {
  const comparison = page.locator('#comparison');
  await comparison.evaluate((element) => {
    Object.assign(element, { compareKeys: Array.from({ length: 34 }, (_, index) => `k${index}`) });
  });
  await expect(comparison.locator('[part="compare-button"]')).toHaveCount(32);
  await expect(comparison.locator('[part="compare-button"]').first()).toBeDisabled();
  await comparison.evaluate((element) => {
    Object.assign(element, { compareKeys: ['a', 'a', 'b'] });
  });
  await expect(comparison.locator('[part="compare-button"]')).toHaveCount(2);
  await comparison.getByRole('button', { name: 'Alpha', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as FixtureWindow).compoundFixture.events.findLast(
            (event) => event.type === 'aeliqo-comparison-set',
          )?.detail.keys,
      ),
    )
    .toEqual(['b']);
});

test('search results hide stale materialization and restore the matching revision', async ({ page }) => {
  const search = page.locator('#search');
  await expect(search).toContainText('out of date');
  await expect(search.locator('aeliqo-card-collection')).toHaveCount(0);
  await page.evaluate(async () => {
    const element = document.querySelector('#search') as any;
    element.resultRevision = element.queryRevision;
    await element.updateComplete;
  });
  await expect(search.locator('aeliqo-card-collection')).toHaveCount(1);
  await expect(search.locator('[part=scope]').first()).toContainText('2 matching results');
});

test('current search detail retains its authorized scope', async ({ page }) => {
  const search = page.locator('#search');
  await search.evaluate((element) => {
    const host = element as any;
    host.resultRevision = host.queryRevision;
    host.detailRecord = host.rows[0];
  });
  await expect(search.locator('aeliqo-detail')).toContainText('Authorized people');
});

test('record editor validates slotted fields and includes the explicit draft receipt', async ({ page }) => {
  const editor = page.locator('#editor');
  await page.evaluate(async () => {
    const element = document.querySelector('#editor') as any;
    const field = element.querySelector('aeliqo-text-field') as any;
    field.value = '';
    await field.updateComplete;
    await element.updateComplete;
  });
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as FixtureWindow).compoundFixture.events.filter(
          (event) => event.type === 'aeliqo-record-editor-save',
        ).length,
    ),
  ).toBe(0);
  await editor.locator('aeliqo-text-field').locator('input').fill('Ada Lovelace');
  await page.evaluate(async () => await (document.querySelector('#editor aeliqo-date-range') as any).updateComplete);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as FixtureWindow).compoundFixture.events.findLast(
            (event) => event.type === 'aeliqo-record-editor-save',
          )?.detail,
      ),
    )
    .toMatchObject({
      key: 'a',
      entityRevision: 'rev-1',
      values: {
        name: 'Ada Lovelace',
        tags: ['first', 'second'],
        'period[start]': '2026-09-01',
        'period[end]': '2026-09-08',
        __proto__: 'safe',
        constructor: 'safe-constructor',
      },
    });
  expect(
    await page.evaluate(() => {
      const detail = (window as unknown as FixtureWindow).compoundFixture.events.findLast(
        (event) => event.type === 'aeliqo-record-editor-save',
      )?.detail as { values: Record<string, unknown> };
      return {
        keys: Object.keys(detail.values),
        ignored: detail.values.ignored,
        proto: detail.values['__proto__'],
        constructor: detail.values.constructor,
      };
    }),
  ).toEqual({
    keys: ['tags', '__proto__', 'constructor', 'name', 'period[start]', 'period[end]'],
    ignored: undefined,
    proto: 'safe',
    constructor: 'safe-constructor',
  });
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as FixtureWindow).compoundFixture.events.findLast(
            (event) => event.type === 'aeliqo-record-editor-cancel',
          )?.detail,
      ),
    )
    .toMatchObject({
      key: 'a',
      entityRevision: 'rev-1',
      values: {
        name: 'Ada Lovelace',
        tags: ['first', 'second'],
        'period[start]': '2026-09-01',
        'period[end]': '2026-09-08',
        __proto__: 'safe',
        constructor: 'safe-constructor',
      },
    });
});

test('form flow keeps step scoped controls mounted, blocks invalid progression, and commits all steps', async ({
  page,
}) => {
  const flow = page.locator('#flow');
  await flow.getByRole('button', { name: 'Next', exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as FixtureWindow).compoundFixture.events.filter(
          (event) => event.type === 'aeliqo-form-flow-step',
        ).length,
    ),
  ).toBe(0);
  await expect(flow.locator('[part=step-panel]')).toHaveAttribute('data-step', 'one');
  await flow.locator('aeliqo-text-field').locator('input').fill('Ada Lovelace');
  await flow.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(flow.locator('[part=step-panel]')).toHaveAttribute('data-step', 'two');
  await page.evaluate(async () => {
    const element = document.querySelector('#flow') as any;
    element.draft = { draftOnly: 'new' };
    await (element.querySelector('aeliqo-date-range') as any).updateComplete;
    await element.updateComplete;
  });
  await flow.getByRole('button', { name: 'Commit', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as FixtureWindow).compoundFixture.events.findLast(
            (event) => event.type === 'aeliqo-form-flow-commit',
          )?.detail.draft,
      ),
    )
    .toMatchObject({
      draftOnly: 'new',
      displayName: 'Ada Lovelace',
      plan: 'standard',
      consent: 'yes',
      tags: ['one', 'two'],
      choices: ['red', 'blue'],
      'window[start]': '2026-09-02',
      'window[end]': '2026-09-09',
      __proto__: 'draft-proto',
      constructor: 'draft-constructor',
    });
  expect(
    await page.evaluate(() => {
      const draft = (window as unknown as FixtureWindow).compoundFixture.events.findLast(
        (event) => event.type === 'aeliqo-form-flow-commit',
      )?.detail.draft as Record<string, unknown>;
      return {
        keys: Object.keys(draft),
        ignored: draft.ignoredFlow,
        proto: draft['__proto__'],
        constructor: draft.constructor,
      };
    }),
  ).toEqual({
    keys: [
      'draftOnly',
      'displayName',
      'tags',
      '__proto__',
      'constructor',
      'plan',
      'consent',
      'choices',
      'window[start]',
      'window[end]',
    ],
    ignored: undefined,
    proto: 'draft-proto',
    constructor: 'draft-constructor',
  });
});

test('form flow preserves keyboard focus through forward and back navigation', async ({ page }) => {
  const flow = page.locator('#flow');
  await flow.locator('aeliqo-text-field').locator('input').fill('Ada');
  await flow.getByRole('button', { name: 'Next', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(flow.locator('[part="step-panel"]')).toHaveAttribute('data-step', 'two');
  await expect(flow.getByRole('radio', { name: 'Standard plan', exact: true })).toBeFocused();
  await flow.getByRole('button', { name: 'Back', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(flow.locator('aeliqo-text-field').locator('input')).toBeFocused();
  await flow.evaluate((element) => {
    element.querySelector('[slot="step-two"]')?.replaceChildren(document.createTextNode('Review draft'));
  });
  await flow.getByRole('button', { name: 'Next', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(flow.locator('[part="step-panel"]')).toBeFocused();
});

test('compound states keep caution copy and remain accessible under RTL, zoom and forced colors', async ({ page }) => {
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
    document.documentElement.style.fontSize = '200%';
  });
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator('#investigation')).toContainText('do not establish causal claims');
  await expect(page.locator('#investigation aeliqo-trend [part=data] table')).toHaveCount(1);
  await expect(page.locator('#quality')).toContainText('Unsupported claims are shown explicitly');
  await expect(page.locator('#investigation aeliqo-detail')).toContainText('Authorized people');
  const results = await new AxeBuilder({ page }).include('#fixture').analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: 'artifacts/compound-browser/rtl-forced-colors.png', fullPage: true });
});
