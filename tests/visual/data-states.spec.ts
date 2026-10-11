import { expect, test, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { REVIEW_VARIANTS, reviewColorScheme, reviewViewport, type ReviewVariant } from './review-variants.js';

type StatePage = Page;
type StateInfo = TestInfo;

const DATA_COMPONENTS = [
  'metric',
  'delta',
  'key-value',
  'detail',
  'record-list',
  'card-collection',
  'table',
  'filter-builder',
  'selection-summary',
] as const;
const COMPOUND_COMPONENTS = [
  'explorer',
  'comparison',
  'breakdown',
  'investigation',
  'search-results',
  'record-editor',
  'form-flow',
  'quality-panel',
] as const;
const VISUALIZATION_COMPONENTS = [
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
] as const;

const DATA_MESSAGE: Record<string, string> = {
  loading: 'The host is loading this authorized state.',
  partial: 'Only the currently loaded portion is available.',
  stale: 'This state is stale and needs refresh.',
  error: 'The host could not provide this authorized state.',
};
const COMPOUND_MESSAGE: Record<string, string> = {
  loading: 'The host is loading this authorized state.',
  empty: 'No matching records are available.',
  partial: 'Only the currently loaded portion is available.',
  stale: 'This state is stale and needs refresh.',
  error: 'The host could not provide this authorized state.',
  unavailable: 'This state is unavailable to the host.',
};

async function settleElement(page: StatePage, id: string): Promise<void> {
  await page.evaluate(async (componentId) => {
    const host = document.querySelector<HTMLElement>(`#fixture aeliqo-${componentId}`) as
      (HTMLElement & { updateComplete?: Promise<unknown> }) | null;
    if (host === null) throw new Error(`Missing fixture element aeliqo-${componentId}`);
    for (let pass = 0; pass < 4; pass += 1) {
      const roots: (Element | ShadowRoot)[] = [host];
      const pending: Promise<unknown>[] = [];
      while (roots.length > 0) {
        const root = roots.shift()!;
        for (const element of root.querySelectorAll<HTMLElement>('*')) {
          const update = (element as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete;
          if (update !== undefined) pending.push(update);
          if (element.shadowRoot !== null) roots.push(element.shadowRoot);
        }
        const update = (root as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete;
        if (update !== undefined) pending.push(update);
      }
      if (pending.length > 0) await Promise.all(pending);
    }
  }, id);
}

async function openFixture(page: StatePage, id: string, variant: ReviewVariant): Promise<void> {
  await page.goto(`/tests/visual/index.html?component=${id}&variant=${variant}`);
  await page.waitForFunction(() =>
    Boolean((window as typeof window & { aeliqoReviewReady?: boolean }).aeliqoReviewReady),
  );
  await expect(page.locator(`#fixture aeliqo-${id}`)).toBeAttached();
  await settleElement(page, id);
}

async function mutateDataState(page: StatePage, id: string, state: string): Promise<void> {
  await page.evaluate(
    ({ componentId, nextState, message }) => {
      const host = document.querySelector<HTMLElement>(`#fixture aeliqo-${componentId}`) as
        (HTMLElement & Record<string, any>) | null;
      if (host === null) throw new Error(`Missing fixture element aeliqo-${componentId}`);
      const original = ((host as any).__aeliqoDataStateOriginal ??= {
        value: host.value,
        current: host.current,
        baseline: host.baseline,
        items: host.items,
        record: host.record,
        rows: host.rows,
      });
      host.value = original.value;
      host.current = original.current;
      host.baseline = original.baseline;
      host.items = original.items;
      host.record = original.record;
      host.rows = original.rows;
      host.status = nextState;
      host.message = nextState === 'unavailable' ? '' : nextState === 'empty' ? '' : message;
      if (nextState === 'empty') {
        if (componentId === 'metric') host.value = undefined;
        if (componentId === 'delta') {
          host.current = undefined;
          host.baseline = undefined;
        }
        if (componentId === 'key-value') host.items = [];
        if (componentId === 'detail') host.record = undefined;
        if (['record-list', 'card-collection', 'table'].includes(componentId)) host.rows = [];
      }
    },
    { componentId: id, nextState: state, message: DATA_MESSAGE[state] ?? '' },
  );
  await settleElement(page, id);
}

async function assertDataState(page: StatePage, id: string, state: string): Promise<void> {
  const host = page.locator(`#fixture aeliqo-${id}`);
  if (state === 'empty') {
    if (id === 'table') {
      await expect(host.locator('[part=table] tbody td')).toContainText('No rows to display.');
    } else {
      await expect(host.locator('[part=status]')).toContainText('No data to display.');
    }
    return;
  }
  if (id === 'filter-builder' && ['loading', 'error', 'unavailable'].includes(state)) {
    await expect(host.locator('fieldset[disabled]')).toHaveCount(1);
    return;
  }
  if ((id === 'metric' || id === 'delta') && ['error', 'unavailable'].includes(state)) {
    await expect(host.locator('[part=number]')).toContainText(
      state === 'unavailable' ? 'Value unavailable.' : DATA_MESSAGE[state]!,
    );
    return;
  }
  await expect(host.locator('[part=status]')).toContainText(
    state === 'unavailable' ? 'Value unavailable.' : DATA_MESSAGE[state]!,
  );
  if (['partial', 'stale'].includes(state)) {
    if (id === 'metric') await expect(host.locator('[part=number]')).toContainText('3');
    if (['record-list', 'card-collection', 'table'].includes(id)) await expect(host).toContainText('Ada Lovelace');
  }
}

async function auditAndCapture(page: StatePage, info: StateInfo, id: string, state: string): Promise<void> {
  const axe = await new AxeBuilder({ page }).analyze();
  await info.attach(`${id}-${state}-accessibility.json`, {
    body: JSON.stringify({ violations: axe.violations, incomplete: axe.incomplete }, null, 2),
    contentType: 'application/json',
  });
  await info.attach(`${id}-${state}-environment.json`, {
    body: JSON.stringify(
      {
        browser: page.context().browser()?.version(),
        project: info.project.name,
        viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })),
        state,
        component: id,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath(`${id}-${state}.png`), fullPage: true });
  expect(
    axe.violations.map(({ id: rule, impact, nodes }) => ({
      id: rule,
      impact,
      nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
    })),
  ).toEqual([]);
}

for (const id of DATA_COMPONENTS) {
  const states =
    id === 'filter-builder' || id === 'selection-summary'
      ? ['loading', 'partial', 'stale', 'error', 'unavailable']
      : ['empty', 'loading', 'partial', 'stale', 'error', 'unavailable'];
  for (const variant of REVIEW_VARIANTS)
    test(`${id} renders its supported alternate data states at ${variant}`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.setViewportSize(reviewViewport(variant));
      await page.emulateMedia({ colorScheme: reviewColorScheme(variant), reducedMotion: 'reduce' });
      await openFixture(page, id, variant);
      for (const state of states) {
        await mutateDataState(page, id, state);
        await assertDataState(page, id, state);
        if (id === 'card-collection' && state === 'stale' && variant === 'narrow-dark-rtl') {
          const banner = page.locator(`#fixture aeliqo-${id} [part=status]`);
          await expect(banner).toHaveAttribute('dir', 'auto');
          expect(await banner.evaluate((element) => getComputedStyle(element).direction)).toBe('ltr');
        }
        await auditAndCapture(page, info, id, state);
      }
      expect(errors).toEqual([]);
    });
}

async function mutateCompoundState(page: StatePage, id: string, state: string): Promise<void> {
  await page.evaluate(
    ({ componentId, nextState, message }) => {
      const host = document.querySelector<HTMLElement>(`#fixture aeliqo-${componentId}`) as
        (HTMLElement & Record<string, any>) | null;
      if (host === null) throw new Error(`Missing fixture element aeliqo-${componentId}`);
      const original = ((host as any).__aeliqoCompoundStateOriginal ??= {
        rows: host.rows,
        groups: host.groups,
        detailRecord: host.detailRecord,
        queryRevision: host.queryRevision,
        resultRevision: host.resultRevision,
        selectedKey: host.selectedKey,
        count: host.count,
      });
      if (componentId === 'explorer') {
        host.rows = original.rows;
        host.detailRecord = original.detailRecord;
      }
      if (componentId === 'breakdown') host.groups = original.groups;
      if (componentId === 'investigation') host.detailRecord = original.detailRecord;
      if (componentId === 'search-results') {
        host.rows = original.rows;
        host.detailRecord = original.detailRecord;
        host.queryRevision = original.queryRevision;
        host.resultRevision = original.resultRevision;
        host.selectedKey = original.selectedKey;
        host.count = original.count;
      }
      host.status = nextState;
      host.message = message;
      if (componentId === 'search-results')
        host.resultRevision = nextState === 'stale' ? 'different-result-revision' : host.queryRevision;
      if (componentId === 'explorer' && nextState === 'empty') {
        host.rows = [];
        host.detailRecord = undefined;
      }
      if (componentId === 'breakdown' && nextState === 'empty') host.groups = [];
      if (componentId === 'investigation' && nextState === 'empty') host.detailRecord = undefined;
      if (componentId === 'search-results' && nextState === 'empty') {
        host.rows = [];
        host.detailRecord = undefined;
        host.count = 0;
      }
      if (componentId === 'record-editor') {
        host.invalid = false;
        host.disabled = false;
      }
      if (componentId === 'form-flow') host.validation = {};
    },
    { componentId: id, nextState: state, message: COMPOUND_MESSAGE[state] ?? '' },
  );
  await settleElement(page, id);
}

async function assertCompoundState(page: StatePage, id: string, state: string): Promise<void> {
  const host = page.locator(`#fixture aeliqo-${id}`);
  await expect(host.locator('[part=root]')).toHaveAttribute('data-status', state);
  if (id === 'search-results' && state === 'stale') {
    const status = host.locator('[part=root] > [part=status]');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toContainText('Results are out of date for this query.');
  } else {
    const status = host.locator('[part=root] > [part=status]');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toContainText(COMPOUND_MESSAGE[state]!);
  }
  if (id === 'search-results') {
    await expect(host).toHaveJSProperty('queryRevision', 'query-2');
    await expect(host).toHaveJSProperty('selectedKey', 'string:3:ada');
    await expect(host.locator('[part=query]')).toContainText('Results for');
    if (state === 'empty') {
      await expect(host.locator('[part=root] > [part=scope]')).toContainText('0 matching results');
      await expect(host.locator('aeliqo-card-collection [part=card]')).toHaveCount(0);
    }
    if (state === 'partial') {
      await expect(host.locator('aeliqo-card-collection')).toContainText('Ada Lovelace');
      await expect(host.locator('aeliqo-card-collection [part=card][data-selected]')).toHaveCount(1);
    }
  }
  if (state === 'partial' && ['explorer', 'investigation'].includes(id)) {
    await expect(host).toContainText('Ada Lovelace');
  }
}

async function assertCompoundSpecialState(page: StatePage, id: string, state: string): Promise<void> {
  const host = page.locator(`#fixture aeliqo-${id}`);
  await expect(host.locator('[part=root]')).toHaveAttribute('data-status', 'ready');
  if (id === 'comparison') {
    await expect(host.locator('[part=root] > [part=status]')).toContainText('cannot be compared');
  } else if (id === 'record-editor' && state === 'invalid') {
    await expect(host.locator('[part=actions] button').nth(1)).toBeDisabled();
  } else if (id === 'record-editor' && state === 'disabled') {
    await expect(host.locator('[part=actions] button')).toHaveCount(2);
    await expect(host.locator('[part=actions] button').nth(0)).toBeDisabled();
    await expect(host.locator('[part=actions] button').nth(1)).toBeDisabled();
  } else if (id === 'form-flow') {
    await expect(host.locator('[part=root] > [part=status]')).toHaveAttribute('role', 'alert');
    await expect(host.locator('[part=root] > [part=status]')).toContainText('Name is required.');
    await expect(host.locator('aeliqo-text-field input')).toHaveValue('');
    await expect(host.locator('aeliqo-text-field input')).toHaveAttribute('required', '');
  }
}

async function mutateCompoundSpecialState(page: StatePage, id: string, state: string): Promise<void> {
  await page.evaluate(
    ({ componentId, nextState }) => {
      const host = document.querySelector<HTMLElement>(`#fixture aeliqo-${componentId}`) as
        (HTMLElement & Record<string, any>) | null;
      if (host === null) throw new Error(`Missing fixture element aeliqo-${componentId}`);
      host.status = 'ready';
      host.message = '';
      if (componentId === 'comparison') host.compatible = false;
      if (componentId === 'record-editor') {
        host.invalid = nextState === 'invalid';
        host.disabled = nextState === 'disabled';
      }
      if (componentId === 'form-flow') {
        host.draft = { ...host.draft, name: '' };
        const field = host.querySelector('aeliqo-text-field') as (HTMLElement & Record<string, any>) | null;
        if (field === null) throw new Error('Missing form-flow name field');
        field.value = '';
        field.required = true;
        host.validation = { identity: 'Name is required.' };
      }
    },
    { componentId: id, nextState: state },
  );
  await settleElement(page, id);
}

for (const id of COMPOUND_COMPONENTS) {
  for (const variant of REVIEW_VARIANTS)
    test(`${id} renders its supported alternate compound states at ${variant}`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.setViewportSize(reviewViewport(variant));
      await page.emulateMedia({ colorScheme: reviewColorScheme(variant), reducedMotion: 'reduce' });
      await openFixture(page, id, variant);
      const states =
        id === 'search-results'
          ? ['loading', 'empty', 'partial', 'error', 'unavailable', 'stale']
          : ['loading', 'empty', 'partial', 'stale', 'error', 'unavailable'];
      for (const state of states) {
        await mutateCompoundState(page, id, state);
        await assertCompoundState(page, id, state);
        await auditAndCapture(page, info, id, state);
      }
      const specialStates =
        id === 'comparison'
          ? ['incompatible']
          : id === 'record-editor'
            ? ['invalid', 'disabled']
            : id === 'form-flow'
              ? ['invalid']
              : [];
      for (const state of specialStates) {
        await mutateCompoundSpecialState(page, id, state);
        await assertCompoundSpecialState(page, id, state);
        await auditAndCapture(page, info, id, state);
      }
      expect(errors).toEqual([]);
    });
}

async function resetVisualizationFixture(page: StatePage, id: string, state: string): Promise<void> {
  await page.evaluate(
    ({ componentId, nextState }) => {
      const host = document.querySelector<HTMLElement>(`#fixture aeliqo-${componentId}`) as
        (HTMLElement & Record<string, any>) | null;
      if (host === null) throw new Error(`Missing fixture element aeliqo-${componentId}`);
      const original = ((host as any).__aeliqoDataStateOriginal ??= {
        visualization: host.visualization,
        context: host.context,
        datasets: host.datasets,
        maxMarks: host.maxMarks,
      });
      host.visualization = original.visualization;
      host.context = original.context;
      host.datasets = original.datasets;
      host.maxMarks = original.maxMarks;
      if (nextState === 'empty') host.visualization = undefined;
      if (nextState === 'missing-dataset') host.datasets = [];
      if (nextState === 'partial') {
        host.context = {
          ...original.context,
          results: original.context.results.map((result: any) => ({
            ...result,
            coverage: {
              kind: 'partial',
              populationDigest: result.coverage.populationDigest ?? result.ref.scopeDigest,
              reason: 'bounded loaded window',
            },
          })),
        };
      }
      if (nextState === 'data-only') host.maxMarks = 1;
    },
    { componentId: id, nextState: state },
  );
  await settleElement(page, id);
}

async function assertVisualizationState(page: StatePage, id: string, state: string): Promise<void> {
  const host = page.locator(`#fixture aeliqo-${id}`);
  if (state === 'partial') {
    await expect(host.locator('[part=scope]')).toContainText('Partial');
    return;
  }
  const status = host.locator('[role="status"]').first();
  await expect(status).toBeVisible();
  if (state === 'empty') {
    if (['matrix', 'timeline', 'calendar-grid'].includes(id))
      await expect(status).toContainText('No matching visualization is available.');
    else if (['tree', 'treemap', 'relationship'].includes(id))
      await expect(status).toContainText(`This surface requires a ${id} specification.`);
    else await expect(status).toContainText(`No ${id} visualization is available.`);
  } else if (state === 'data-only') {
    await expect(status).toContainText(/configured mark budget|readable graphic density|bounded graphic/i);
  } else {
    await expect(status).toContainText(/authorized|visualization|rows|materialization|dataset/i);
  }
}

for (const id of VISUALIZATION_COMPONENTS) {
  const states = [
    'empty',
    'missing-dataset',
    'partial',
    ...(id === 'tree' || id === 'treemap' || id === 'relationship' ? ['data-only'] : []),
  ];
  for (const variant of REVIEW_VARIANTS)
    test(`${id} renders its supported alternate visualization states at ${variant}`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.setViewportSize(reviewViewport(variant));
      await page.emulateMedia({ colorScheme: reviewColorScheme(variant), reducedMotion: 'reduce' });
      await openFixture(page, id, variant);
      for (const state of states) {
        await resetVisualizationFixture(page, id, state);
        await assertVisualizationState(page, id, state);
        await auditAndCapture(page, info, id, state);
      }
      expect(errors).toEqual([]);
    });
}

// Deliberately documented coverage gaps: visual components have no status prop,
// filter/selection primitives do not expose an empty state, and editor/form
// compounds use their own invalid/disabled/pending controls rather than a data
// status. These paths belong to their focused interaction suites.
test.describe('unsupported state coverage is explicit', () => {
  test('records the public state gaps in the test report', async ({}, info) => {
    await info.attach('state-coverage-gaps.txt', {
      body: [
        'Visualization elements expose empty/error/partial/data-only outcomes through their typed visualization, context, datasets, and maxMarks inputs; they do not expose a generic loading/stale/error status prop.',
        'filter-builder and selection-summary have loading/partial/stale/error/unavailable inputs but no independent empty rendering path.',
        'record-editor invalid/disabled and form-flow validation are exercised here through their real controlled properties; pending remains the documented loading status path.',
        'search-results renders loading/partial/error/unavailable status text while preserving its separate stale revision state.',
        'No visual baseline is auto-accepted. Every state asserts rendered semantics, runs Axe, and captures an unapproved review image.',
      ].join('\n'),
      contentType: 'text/plain',
    });
  });
});
