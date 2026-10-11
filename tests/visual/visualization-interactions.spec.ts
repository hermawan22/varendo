import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  REVIEW_VARIANTS,
  reviewColorScheme,
  reviewDirection,
  reviewViewport,
  type ReviewVariant,
} from './review-variants.js';

const CARTESIAN = ['trend', 'bar', 'area', 'scatter', 'histogram', 'heatmap'] as const;
const TEMPORAL = ['matrix', 'timeline', 'calendar-grid'] as const;
const HIERARCHY = ['tree', 'treemap', 'relationship'] as const;
const VISUALIZATIONS = [...CARTESIAN, ...TEMPORAL, ...HIERARCHY] as const;
type VisualizationId = (typeof VISUALIZATIONS)[number];

type ResultRef = {
  readonly id: string;
  readonly revision: string;
  readonly outputId: string;
  readonly queryDigest: string;
  readonly scopeDigest: string;
};

type VisualizationHost = HTMLElement & {
  datasets: readonly unknown[];
  context: { readonly results: readonly { readonly ref: ResultRef }[] };
  visualization: unknown;
  maxMarks: number;
  updateComplete?: Promise<unknown>;
};

type ReviewWindow = Window & {
  aeliqoReviewReady?: boolean;
  visualizationSelections?: readonly unknown[];
};

type ExpectedSelection = {
  readonly identity: string;
  readonly result: ResultRef;
  readonly rowText: string;
  readonly reorderedIndex: number;
};

const catalogResult: ResultRef = {
  id: 'aeliqo-catalog-example',
  revision: '1',
  outputId: 'people',
  queryDigest: 'catalog-query',
  scopeDigest: 'catalog-scope',
};
const hierarchyResult: ResultRef = {
  ...catalogResult,
  id: 'aeliqo-catalog-hierarchy',
  outputId: 'nodes',
};
const relationshipResult: ResultRef = {
  ...catalogResult,
  id: 'aeliqo-catalog-relationship',
  outputId: 'edges',
};

// Visualization materialization wraps each scalar identity key in the
// composite identity tuple, so a one-field text identity is encoded as
// JSON.stringify([JSON.stringify(["text", value])]).
const textIdentity = (value: string): string => JSON.stringify([JSON.stringify(['text', value])]);

const expectedSelection: Record<VisualizationId, ExpectedSelection> = {
  trend: { identity: textIdentity('ada'), result: catalogResult, rowText: 'Ada Lovelace', reorderedIndex: 2 },
  bar: { identity: textIdentity('ada'), result: catalogResult, rowText: 'Ada Lovelace', reorderedIndex: 2 },
  area: { identity: textIdentity('ada'), result: catalogResult, rowText: 'Ada Lovelace', reorderedIndex: 2 },
  scatter: { identity: textIdentity('ada'), result: catalogResult, rowText: 'Ada Lovelace', reorderedIndex: 2 },
  histogram: { identity: textIdentity('ada'), result: catalogResult, rowText: 'Ada Lovelace', reorderedIndex: 2 },
  heatmap: { identity: textIdentity('ada'), result: catalogResult, rowText: 'Ada Lovelace', reorderedIndex: 2 },
  matrix: { identity: textIdentity('ada'), result: catalogResult, rowText: 'Ada Lovelace', reorderedIndex: 2 },
  timeline: { identity: textIdentity('ada'), result: catalogResult, rowText: 'Ada Lovelace', reorderedIndex: 2 },
  'calendar-grid': { identity: textIdentity('ada'), result: catalogResult, rowText: 'Ada Lovelace', reorderedIndex: 2 },
  tree: { identity: textIdentity('company'), result: hierarchyResult, rowText: 'Company', reorderedIndex: 2 },
  treemap: { identity: textIdentity('company'), result: hierarchyResult, rowText: 'Company', reorderedIndex: 2 },
  relationship: { identity: textIdentity('e1'), result: relationshipResult, rowText: 'e1', reorderedIndex: 1 },
};

function componentLocator(page: Page, id: VisualizationId): Locator {
  return page.locator(`#fixture aeliqo-${id}`).first();
}

async function openVisualization(
  page: Page,
  id: VisualizationId,
  variant: ReviewVariant,
): Promise<{ readonly host: Locator; readonly errors: string[] }> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize(reviewViewport(variant));
  await page.emulateMedia({ colorScheme: reviewColorScheme(variant), reducedMotion: 'reduce' });
  await page.goto(`/tests/visual/index.html?component=${id}&variant=${variant}`);
  await page.waitForFunction(() => Boolean((window as ReviewWindow).aeliqoReviewReady));
  const host = componentLocator(page, id);
  await expect(host).toBeAttached();
  // Cartesian charts fold their exact-values table; hierarchy and temporal views show it inline.
  const disclosure = host.locator('[part="data-details"] > summary');
  if ((await disclosure.count()) > 0) await disclosure.first().click();
  await expect(host.locator('[part=data]')).toBeVisible();
  await page.evaluate(() => {
    const selections: unknown[] = [];
    document.addEventListener('aeliqo-visualization-select', (event) => {
      selections.push((event as CustomEvent).detail);
    });
    (window as ReviewWindow).visualizationSelections = selections;
  });
  const environment = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    direction: document.documentElement.dir,
  }));
  expect(environment).toEqual({
    theme: reviewColorScheme(variant),
    direction: reviewDirection(variant),
  });
  return { host, errors };
}

async function selections(page: Page): Promise<readonly ExpectedSelection[]> {
  return page.evaluate(() => (window as ReviewWindow).visualizationSelections ?? []) as Promise<
    readonly ExpectedSelection[]
  >;
}

async function refreshDataset(host: Locator): Promise<void> {
  await host.evaluate(async (element) => {
    const view = element as VisualizationHost;
    view.datasets = (view.datasets as readonly { readonly result: ResultRef; readonly rows: readonly unknown[] }[]).map(
      (dataset) => ({
        ...dataset,
        rows: [...dataset.rows].reverse(),
      }),
    );
    await view.updateComplete;
  });
}

async function renderedRowCells(host: Locator): Promise<readonly (readonly string[])[]> {
  return host
    .locator('[part=data] tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) =>
        [...row.querySelectorAll('td')].map((cell) => cell.textContent?.replace(/\\s+/gu, ' ').trim() ?? ''),
      ),
    );
}

async function assertBoundedGeometry(host: Locator): Promise<void> {
  const geometry = await host.locator('svg').evaluateAll((nodes) =>
    nodes.map((node) => ({
      width: Number(node.getAttribute('width') ?? 0),
      height: Number(node.getAttribute('height') ?? 0),
      marks: node.querySelectorAll('circle, line, path, rect').length,
    })),
  );
  expect(geometry.length).toBeLessThanOrEqual(1);
  for (const value of geometry) {
    expect(value.width).toBeGreaterThan(0);
    expect(value.width).toBeLessThanOrEqual(4_000);
    expect(value.height).toBeGreaterThan(0);
    expect(value.height).toBeLessThanOrEqual(4_000);
    expect(value.marks).toBeLessThanOrEqual(50_000);
  }
}

async function setVisualizationState(host: Locator, state: 'partial' | 'empty'): Promise<void> {
  await host.evaluate(async (element, nextState) => {
    const view = element as VisualizationHost & {
      readonly __original?: {
        visualization: unknown;
        context: VisualizationHost['context'];
        datasets: readonly unknown[];
      };
    };
    let original = view.__original;
    if (original === undefined) {
      original = { visualization: view.visualization, context: view.context, datasets: view.datasets };
      Object.defineProperty(view, '__original', { configurable: true, value: original });
    }
    view.visualization = original.visualization;
    view.context = original.context;
    view.datasets = original.datasets;
    if (nextState === 'partial') {
      view.context = {
        ...original.context,
        results: original.context.results.map((result) => ({
          ...result,
          coverage: {
            kind: 'partial',
            populationDigest: result.ref.scopeDigest,
            reason: 'bounded loaded window',
          },
        })),
      };
    } else {
      view.visualization = undefined;
    }
    await view.updateComplete;
  }, state);
}

function rowsFor(
  id: 'cartesian' | 'temporal' | 'hierarchy',
  count: number,
): readonly Record<string, string | number | null>[] {
  if (id === 'hierarchy') {
    return Array.from({ length: count }, (_, index) =>
      index === 0
        ? { id: 'root', parent: null, label: 'Root', amount: count }
        : { id: `node-${index}`, parent: 'root', label: `Node ${index}`, amount: index },
    );
  }
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 8, 1 + index)).toISOString().slice(0, 10);
    return {
      id: `row-${index}`,
      name: `Person ${index}`,
      team: index % 2 === 0 ? 'Research' : 'Product',
      date,
      amount: index + 1,
      low: index,
      high: index + 1,
      zero: 0,
    };
  });
}

async function setBoundedRows(host: Locator, id: 'trend' | 'timeline' | 'tree'): Promise<void> {
  const rows = rowsFor(id === 'tree' ? 'hierarchy' : id === 'timeline' ? 'temporal' : 'cartesian', 30);
  await host.evaluate(async (element, nextRows) => {
    const view = element as VisualizationHost;
    const result = view.context.results[0]!;
    view.context = {
      ...view.context,
      results: view.context.results.map((candidate, index) =>
        index === 0
          ? {
              ...candidate,
              counts: {
                ...(candidate as unknown as { readonly counts: Record<string, unknown> }).counts,
                loaded: nextRows.length,
              },
            }
          : candidate,
      ),
    } as VisualizationHost['context'];
    view.datasets = [{ result: result.ref, rows: nextRows }];
    view.maxMarks = 1;
    await view.updateComplete;
  }, rows);
}

for (const variant of REVIEW_VARIANTS) {
  test.describe(`${variant} visualization interactions`, () => {
    for (const id of VISUALIZATIONS) {
      test(`${id} selects a stable identity with exact result lineage`, async ({ page }, info) => {
        const session = await openVisualization(page, id, variant);
        const { identity, result, rowText, reorderedIndex } = expectedSelection[id];
        const button = session.host.locator('[part=data] tbody button').first();
        await expect(button).toBeVisible();
        await button.focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => selections(page)).toContainEqual({ source: 'user', identity, result });
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await refreshDataset(session.host);
        await expect.poll(() => selections(page)).toHaveLength(1);
        await expect(session.host.locator('[part=data] tbody button[aria-pressed="true"]')).toHaveCount(1);
        const selectedIdentity = await session.host.evaluate(
          (element) => (element as VisualizationHost & { selectedIdentity?: string }).selectedIdentity,
        );
        expect(selectedIdentity).toBe(identity);
        const selectedRow = session.host.locator('[part=data] tbody tr:has(button[aria-pressed="true"])');
        await expect(selectedRow).toContainText(rowText);
        const selectedRowIndex = await selectedRow.evaluate((row) =>
          [...(row.parentElement?.children ?? [])].indexOf(row),
        );
        expect(selectedRowIndex).toBe(reorderedIndex);
        await assertBoundedGeometry(session.host);
        const axe = await new AxeBuilder({ page }).include(`#fixture aeliqo-${id}`).analyze();
        expect(axe.violations).toEqual([]);
        expect(session.errors).toEqual([]);
        await page.screenshot({ path: info.outputPath('selected-reordered.png'), fullPage: true });
      });
    }

    for (const id of VISUALIZATIONS) {
      test(`${id} keeps the existing partial and empty data states honest`, async ({ page }, info) => {
        const session = await openVisualization(page, id, variant);
        await setVisualizationState(session.host, 'partial');
        await expect(session.host.locator('[part=scope]')).toContainText('Partial');
        await setVisualizationState(session.host, 'empty');
        const status = session.host.locator('[role="status"]').first();
        await expect(status).toBeVisible();
        if ((CARTESIAN as readonly string[]).includes(id)) {
          await expect(status).toContainText(`No ${id} visualization is available.`);
        } else if ((TEMPORAL as readonly string[]).includes(id)) {
          await expect(status).toContainText('No matching visualization is available.');
        } else {
          await expect(status).toContainText(`This surface requires a ${id} specification.`);
        }
        // Visualization elements have no generic status/loading/error property.
        // Loading and error remain host/materialization concerns covered by the
        // existing state suite; this matrix does not invent unsupported props.
        expect(session.errors).toEqual([]);
        await page.screenshot({ path: info.outputPath('empty.png'), fullPage: true });
      });
    }
  });
}

for (const id of ['trend', 'timeline', 'tree'] as const) {
  for (const variant of REVIEW_VARIANTS) {
    test(`${id} ${variant} paginates 30 rows while retaining a bounded data-only path`, async ({ page }, info) => {
      const session = await openVisualization(page, id, variant);
      await setBoundedRows(session.host, id);
      await expect(session.host.locator('svg')).toHaveCount(0);
      await expect(session.host.locator('tbody tr')).toHaveCount(25);
      await expect(session.host.locator('[role="status"]')).toContainText(/budget|density/i);
      const next = session.host.getByRole('button', { name: 'Next', exact: true });
      await expect(next).toBeEnabled();
      await next.click();
      await expect(session.host.locator('tbody tr')).toHaveCount(5);
      await expect(session.host).toContainText('Rows 26–30 of 30');
      const pageTwo = await renderedRowCells(session.host);
      expect(pageTwo[0]?.[1]).toBe(id === 'tree' ? 'node-25' : 'row-25');
      expect(pageTwo.at(-1)?.[1]).toBe(id === 'tree' ? 'node-29' : 'row-29');
      const previous = session.host.getByRole('button', { name: 'Previous', exact: true });
      await previous.focus();
      await expect(previous).toBeFocused();
      await previous.press('Enter');
      await expect(session.host.locator('tbody tr')).toHaveCount(25);
      await expect(session.host).toContainText('Rows 1–25 of 30');
      const pageOne = await renderedRowCells(session.host);
      expect(pageOne[0]?.[1]).toBe(id === 'tree' ? 'root' : 'row-0');
      expect(pageOne.at(-1)?.[1]).toBe(id === 'tree' ? 'node-24' : 'row-24');
      await expect(session.host.locator('[role="status"]')).toContainText(/budget|density/i);
      expect(session.errors).toEqual([]);
      // Capture the keyboard pagination result independently of the earlier pointer click, after the
      // element finishes its update so a late render cannot replace the captured focus target.
      await session.host.evaluate(
        (element) => (element as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete,
      );
      const focus = await session.host.evaluateHandle((element) => element.shadowRoot?.activeElement);
      await page.mouse.move(0, 0);
      await expect(session.host.locator('button:hover, tbody tr:hover')).toHaveCount(0);
      expect(
        await session.host.evaluate((element, active) => element.shadowRoot?.activeElement === active, focus),
      ).toBe(true);
      await focus.dispose();
      await page.screenshot({ path: info.outputPath('bounded-page.png'), fullPage: true });
    });
  }
}
