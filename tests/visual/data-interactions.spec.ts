import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { REVIEW_VARIANTS, reviewColorScheme, reviewViewport, type ReviewVariant } from './review-variants.js';

type ReviewEvent = { readonly type: string; readonly detail: Record<string, unknown> };
type ReviewWindow = Window & {
  aeliqoReviewReady?: boolean;
  dataInteractionEvents?: readonly ReviewEvent[];
};

type ReviewSession = {
  readonly errors: string[];
  readonly host: Locator;
  readonly id: string;
  readonly variant: ReviewVariant;
};

async function openCatalog(page: Page, id: string, variant: ReviewVariant): Promise<ReviewSession> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize(reviewViewport(variant));
  await page.emulateMedia({ colorScheme: reviewColorScheme(variant), reducedMotion: 'reduce' });
  await page.goto(`/tests/visual/index.html?component=${id}&variant=${variant}`);
  await page.waitForFunction(() => Boolean((window as ReviewWindow).aeliqoReviewReady));
  const host = page.locator(`#fixture aeliqo-${id}`).first();
  await expect(host).toBeAttached();
  await page.evaluate(() => {
    const events: ReviewEvent[] = [];
    for (const type of [
      'aeliqo-record-list-selection',
      'aeliqo-card-selection',
      'aeliqo-data-load-more',
      'aeliqo-table-selection',
      'aeliqo-table-sort',
      'aeliqo-table-page',
      'aeliqo-table-window',
      'aeliqo-filter-change',
      'aeliqo-selection-clear',
    ]) {
      document.addEventListener(type, (event) => {
        events.push({ type, detail: (event as CustomEvent).detail as Record<string, unknown> });
      });
    }
    (window as ReviewWindow).dataInteractionEvents = events;
  });
  return { errors, host, id, variant };
}

async function events(page: Page): Promise<readonly ReviewEvent[]> {
  return page.evaluate(() => (window as ReviewWindow).dataInteractionEvents ?? []);
}

function lastEvent(all: readonly ReviewEvent[], type: string): ReviewEvent | undefined {
  return all.filter((event) => event.type === type).at(-1);
}

async function setHostProperty(host: Locator, property: string, value: unknown): Promise<void> {
  await host.evaluate(
    async (element, change) => {
      (element as HTMLElement & Record<string, unknown>)[change.property] = change.value;
      await (element as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete;
    },
    { property, value },
  );
}

async function rotateRows(host: Locator): Promise<void> {
  await host.evaluate(async (element) => {
    const component = element as HTMLElement & { rows: readonly unknown[]; updateComplete?: Promise<unknown> };
    const rows = [...component.rows];
    component.rows = rows.length > 2 ? [...rows.slice(2), ...rows.slice(0, 2)] : rows.reverse();
    await component.updateComplete;
  });
}

async function capture(session: ReviewSession, page: Page, info: TestInfo, label: string): Promise<void> {
  const axe = await new AxeBuilder({ page }).analyze();
  await info.attach('accessibility.json', {
    body: JSON.stringify({ violations: axe.violations, incomplete: axe.incomplete }, null, 2),
    contentType: 'application/json',
  });
  await info.attach('interaction.json', {
    body: JSON.stringify(
      {
        id: session.id,
        variant: session.variant,
        browser: page.context().browser()?.version(),
        project: info.project.name,
        label,
        events: await events(page),
        semantics: await session.host.ariaSnapshot(),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath(`${label}.png`), fullPage: true });
  expect(session.errors).toEqual([]);
  expect(axe.violations).toEqual([]);
  expect(axe.incomplete.filter(({ id }) => id === 'aria-prohibited-attr')).toEqual([]);
}

for (const id of ['record-list', 'card-collection', 'table']) {
  test(`${id} selected state remains visible in forced colors`, async ({ page }, info) => {
    const session = await openCatalog(page, id, 'desktop-light');
    await setHostProperty(session.host, 'selectedKeys', ['string:3:lin']);
    await page.emulateMedia({ forcedColors: 'active' });
    if (id === 'table') {
      const selected = session.host.locator('tr[aria-selected="true"]');
      await expect(selected).toHaveCSS('outline-style', 'solid');
      await expect(selected).toHaveCSS('outline-width', '2px');
    } else {
      const selected = session.host.locator(
        id === 'record-list' ? '[data-selected] [part="record-button"]' : '[data-selected]',
      );
      if (id === 'record-list') await expect(selected).toHaveCSS('border-top-width', '3px');
      else {
        await expect(selected).toHaveCSS('outline-style', 'solid');
        await expect(selected).toHaveCSS('outline-width', '2px');
      }
    }
    await capture(session, page, info, 'forced-colors-selection');
  });
}

for (const variant of REVIEW_VARIANTS) {
  test.describe(variant, () => {
    test('record-list keyboard selection keeps a stable identity across reorder', async ({ page }, info) => {
      const session = await openCatalog(page, 'record-list', variant);
      const list = session.host;
      const lin = list.locator('[part="record-button"]').nth(1);
      await lin.focus();
      await lin.press('Enter');
      expect(lastEvent(await events(page), 'aeliqo-record-list-selection')).toEqual(
        expect.objectContaining({
          type: 'aeliqo-record-list-selection',
          detail: expect.objectContaining({
            mode: 'ids',
            entity: 'person',
            keys: ['string:3:lin'],
            result: expect.objectContaining({ id: 'aeliqo-catalog-example', outputId: 'people' }),
          }),
        }),
      );

      await setHostProperty(list, 'selectedKeys', ['string:3:lin']);
      await rotateRows(list);
      await expect(list.locator('[part="record"]').nth(2)).toHaveAttribute('data-key', 'string:3:lin');
      await expect(list.locator('[part="record"]').nth(2)).toHaveAttribute('data-selected', '');
      await expect(list.locator('[part="record"]').nth(2).locator('button')).not.toHaveCSS('box-shadow', 'none');
      await capture(session, page, info, 'record-list-selection');
    });

    test('card selection and load-more stay keyboard reachable and bounded', async ({ page }, info) => {
      const session = await openCatalog(page, 'card-collection', variant);
      const cards = session.host;
      const lin = cards.locator('[part="card-button"]').nth(1);
      await lin.focus();
      await lin.press('Space');
      expect(lastEvent(await events(page), 'aeliqo-card-selection')).toEqual(
        expect.objectContaining({
          type: 'aeliqo-card-selection',
          detail: expect.objectContaining({ mode: 'ids', entity: 'person', keys: ['string:3:lin'] }),
        }),
      );
      await setHostProperty(cards, 'selectedKeys', ['string:3:lin']);
      await rotateRows(cards);
      await expect(cards.locator('[part="card"]').nth(2)).toHaveAttribute('data-key', 'string:3:lin');
      await expect(cards.locator('[part="card"]').nth(2)).toHaveAttribute('data-selected', '');
      await expect(cards.locator('[part="card"]').nth(2)).not.toHaveCSS('box-shadow', 'none');

      const loadMore = cards.locator('[part="load-more"]');
      await setHostProperty(cards, 'loadingMore', true);
      await expect(loadMore).toBeDisabled();
      const blockedCount = (await events(page)).filter((event) => event.type === 'aeliqo-data-load-more').length;
      await loadMore.dispatchEvent('click');
      expect((await events(page)).filter((event) => event.type === 'aeliqo-data-load-more')).toHaveLength(blockedCount);
      await setHostProperty(cards, 'loadingMore', false);
      await loadMore.focus();
      await loadMore.press('Enter');
      expect(lastEvent(await events(page), 'aeliqo-data-load-more')).toEqual(
        expect.objectContaining({
          type: 'aeliqo-data-load-more',
          detail: { requested: true },
        }),
      );
      await capture(session, page, info, 'card-selection-load-more');
    });

    test('table keyboard sorting, selection and paging emit typed stable requests', async ({ page }, info) => {
      const session = await openCatalog(page, 'table', variant);
      const table = session.host;
      await setHostProperty(table, 'pageSize', 2);
      await setHostProperty(table, 'totalRows', 3);

      const nameSort = table.locator('[part="sort"][aria-label="Sort by Name"]');
      await nameSort.focus();
      await nameSort.press('Enter');
      expect(lastEvent(await events(page), 'aeliqo-table-sort')).toEqual(
        expect.objectContaining({
          type: 'aeliqo-table-sort',
          detail: { sort: { field: 'name', direction: 'asc' } },
        }),
      );
      await setHostProperty(table, 'sort', { field: 'name', direction: 'asc' });
      await nameSort.press('Enter');
      expect(lastEvent(await events(page), 'aeliqo-table-sort')).toEqual(
        expect.objectContaining({
          type: 'aeliqo-table-sort',
          detail: { sort: { field: 'name', direction: 'desc' } },
        }),
      );

      const linSelection = table.locator('input[type="checkbox"]').nth(1);
      await linSelection.focus();
      await linSelection.press('Space');
      expect(lastEvent(await events(page), 'aeliqo-table-selection')).toEqual(
        expect.objectContaining({
          type: 'aeliqo-table-selection',
          detail: {
            mode: 'ids',
            entity: 'person',
            keys: ['string:3:ada', 'string:3:lin'],
            result: expect.objectContaining({ id: 'aeliqo-catalog-example' }),
          },
        }),
      );
      await setHostProperty(table, 'selectedKeys', ['string:3:ada', 'string:3:lin']);
      await rotateRows(table);
      await expect(table.locator('tr[data-row-index]')).toHaveCount(3);
      await expect(table.locator('tr[data-row-index="2"]')).toHaveAttribute('aria-selected', 'true');
      await expect(table.locator('tr[data-row-index="2"] td').first()).not.toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
      );
      await expect(table.locator('tr[data-row-index="2"]')).toContainText('Lin Chen');

      const next = table.locator('button[part="next"]');
      await next.focus();
      await next.press('Enter');
      expect(lastEvent(await events(page), 'aeliqo-table-page')).toEqual(
        expect.objectContaining({
          type: 'aeliqo-table-page',
          detail: { page: 2, pageSize: 2, result: expect.objectContaining({ id: 'aeliqo-catalog-example' }) },
        }),
      );
      await setHostProperty(table, 'page', 2);
      await expect(table.locator('[part="page-status"]')).toHaveText('Page 2 of 2');
      await capture(session, page, info, 'table-sort-selection-page');
    });

    test('table grid requests a bounded stable row window at the keyboard boundary', async ({ page }, info) => {
      const session = await openCatalog(page, 'table', variant);
      const table = session.host;
      await setHostProperty(table, 'mode', 'grid');
      await setHostProperty(table, 'virtualized', true);
      await setHostProperty(table, 'virtualCount', 2);
      await setHostProperty(table, 'overscan', 0);
      await setHostProperty(table, 'pageSize', 0);
      await setHostProperty(table, 'totalRows', 100);
      await setHostProperty(table, 'scope', {
        loaded: 3,
        filteredTotal: 100,
        populationDigest: 'catalog-scope',
        kind: 'filtered',
        label: 'Authorized people',
      });

      const lastVisibleCell = table.locator('[part="cell"][data-row-index="1"][data-col-index="1"]');
      await lastVisibleCell.focus();
      await lastVisibleCell.press('ArrowDown');
      expect(lastEvent(await events(page), 'aeliqo-table-window')).toEqual(
        expect.objectContaining({
          type: 'aeliqo-table-window',
          detail: {
            start: 2,
            count: 2,
            overscan: 0,
            row: 2,
            column: 1,
            reason: 'keyboard',
            result: expect.objectContaining({ id: 'aeliqo-catalog-example' }),
          },
        }),
      );
      await setHostProperty(table, 'virtualStart', 2);
      await expect(table.locator('[part="cell"][data-row-index="2"][data-col-index="1"]')).toBeFocused();
      await capture(session, page, info, 'table-grid-window');
    });

    test('filter-builder keeps IME edits draft-only, applies explicitly, and blocks invalid or in-flight requests', async ({
      page,
    }, info) => {
      const session = await openCatalog(page, 'filter-builder', variant);
      const filter = session.host;
      const value = filter.locator('input[part="value"]').first();
      await value.focus();
      await value.dispatchEvent('compositionstart');
      await value.fill('Product');
      await value.dispatchEvent('compositionend');
      await expect(value).toHaveValue('Product');
      expect((await events(page)).filter((event) => event.type === 'aeliqo-filter-change')).toHaveLength(0);

      const apply = filter.locator('button[part="apply"]');
      await apply.focus();
      await apply.press('Enter');
      expect(lastEvent(await events(page), 'aeliqo-filter-change')).toEqual(
        expect.objectContaining({
          type: 'aeliqo-filter-change',
          detail: {
            predicate: { op: 'compare', field: 'team', entity: 'person', comparison: 'eq', value: 'Product' },
            scopeLabel: 'Authorized people',
            applied: true,
          },
        }),
      );

      await setHostProperty(filter, 'clauses', [{ field: 'amount', operator: 'eq', value: 'not-a-number' }]);
      await apply.press('Enter');
      await expect(filter.locator('[part="validation"]')).toHaveText(
        'Choose a field and value before applying the filter.',
      );
      expect((await events(page)).filter((event) => event.type === 'aeliqo-filter-change')).toHaveLength(1);

      await setHostProperty(filter, 'clauses', [{ field: 'team', operator: 'eq', value: 'Research' }]);
      await apply.press('Enter');
      expect((await events(page)).filter((event) => event.type === 'aeliqo-filter-change')).toHaveLength(2);

      // FilterBuilder has no pending status in its actual data API; loading is the supported in-flight state.
      await setHostProperty(filter, 'status', 'loading');
      await expect(filter.locator('fieldset')).toHaveAttribute('disabled', '');
      await expect(apply).toBeDisabled();
      const beforeBlockedApply = (await events(page)).filter((event) => event.type === 'aeliqo-filter-change').length;
      await apply.dispatchEvent('click');
      expect((await events(page)).filter((event) => event.type === 'aeliqo-filter-change')).toHaveLength(
        beforeBlockedApply,
      );
      await setHostProperty(filter, 'status', 'ready');
      await capture(session, page, info, 'filter-apply-invalid-ime');
    });

    test('selection-summary clears controlled stable selection by keyboard', async ({ page }, info) => {
      const session = await openCatalog(page, 'selection-summary', variant);
      const summary = session.host;
      const clear = summary.locator('[part="clear"]');
      await clear.focus();
      await clear.press('Enter');
      expect(lastEvent(await events(page), 'aeliqo-selection-clear')).toEqual(
        expect.objectContaining({
          type: 'aeliqo-selection-clear',
          detail: {
            mode: 'clear',
            entity: 'person',
            keys: [],
            result: expect.objectContaining({ id: 'aeliqo-catalog-example' }),
            scope: expect.objectContaining({ populationDigest: 'catalog-scope' }),
          },
        }),
      );
      await setHostProperty(summary, 'selectedKeys', []);
      await expect(summary.locator('[part="text"]')).toHaveText('No persons selected');
      await capture(session, page, info, 'selection-summary-clear');
    });
  });
}
