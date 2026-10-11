import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { REVIEW_VARIANTS, reviewColorScheme, reviewViewport, type ReviewVariant } from './review-variants.js';

const compoundEventTypes = [
  'aeliqo-explorer-filter',
  'aeliqo-explorer-selection',
  'aeliqo-comparison-set',
  'aeliqo-breakdown-group',
  'aeliqo-visualization-select',
  'aeliqo-search-results-selection',
  'aeliqo-record-editor-save',
  'aeliqo-record-editor-cancel',
  'aeliqo-form-flow-step',
  'aeliqo-form-flow-commit',
] as const;

type EventDetail = Record<string, unknown>;
type ReviewEvent = { readonly type: string; readonly detail: EventDetail | null };
type ReviewWindow = Window & { aeliqoReviewReady?: boolean; compoundInteractionEvents?: readonly ReviewEvent[] };

type ReviewSession = {
  readonly errors: string[];
  readonly host: Locator;
  readonly id: string;
  readonly variant: ReviewVariant;
};

async function settleCompound(page: Page, id: string): Promise<void> {
  await page.evaluate(async (componentId) => {
    const host = document.querySelector<HTMLElement>(`#fixture aeliqo-${componentId}`);
    if (host === null) throw new Error(`Missing compound fixture aeliqo-${componentId}`);
    for (let pass = 0; pass < 4; pass += 1) {
      const pending: Promise<unknown>[] = [];
      const roots: (Element | ShadowRoot)[] = [host];
      while (roots.length > 0) {
        const root = roots.shift()!;
        const update = (root as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete;
        if (update !== undefined) pending.push(update);
        for (const element of root.querySelectorAll<HTMLElement>('*')) {
          const childUpdate = (element as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete;
          if (childUpdate !== undefined) pending.push(childUpdate);
          if (element.shadowRoot !== null) roots.push(element.shadowRoot);
        }
      }
      if (pending.length > 0) await Promise.all(pending);
    }
  }, id);
}

async function openCompound(page: Page, id: string, variant: ReviewVariant): Promise<ReviewSession> {
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
  await page.evaluate((types) => {
    const events: ReviewEvent[] = [];
    for (const type of types) {
      document.addEventListener(type, (raw) => {
        const detail = (raw as CustomEvent<unknown>).detail;
        events.push({ type, detail: detail !== null && typeof detail === 'object' ? (detail as EventDetail) : null });
      });
    }
    (window as ReviewWindow).compoundInteractionEvents = events;
  }, compoundEventTypes);
  await settleCompound(page, id);
  return { errors, host, id, variant };
}

async function lastEvent(page: Page, type: string): Promise<EventDetail | null> {
  return page.evaluate((eventType) => {
    const events = (window as ReviewWindow).compoundInteractionEvents ?? [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index]?.type === eventType) return events[index]?.detail ?? null;
    }
    return null;
  }, type);
}

async function eventCount(page: Page, type: string): Promise<number> {
  return page.evaluate(
    (eventType) =>
      ((window as ReviewWindow).compoundInteractionEvents ?? []).filter((event) => event.type === eventType).length,
    type,
  );
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

async function capture(session: ReviewSession, page: Page, info: TestInfo, label: string): Promise<void> {
  const axe = await new AxeBuilder({ page }).analyze();
  await info.attach(`${label}-accessibility.json`, {
    body: JSON.stringify({ violations: axe.violations, incomplete: axe.incomplete }, null, 2),
    contentType: 'application/json',
  });
  await info.attach(`${label}-environment.json`, {
    body: JSON.stringify(
      {
        id: session.id,
        variant: session.variant,
        browser: page.context().browser()?.version(),
        project: info.project.name,
        viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })),
        direction: await page.evaluate(() => document.documentElement.dir),
        events: await page.evaluate(() => (window as ReviewWindow).compoundInteractionEvents ?? []),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath(`${label}.png`), fullPage: true });
  expect(session.errors).toEqual([]);
  expect(
    axe.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
    })),
  ).toEqual([]);
  expect(axe.incomplete.filter(({ id }) => id === 'aria-prohibited-attr')).toEqual([]);
}

for (const variant of REVIEW_VARIANTS) {
  test.describe(variant, () => {
    test('explorer commits an authorized filter and stable identity selection', async ({ page }, info) => {
      const session = await openCompound(page, 'explorer', variant);
      const filter = session.host.locator('aeliqo-filter-builder');
      if ((await filter.locator('[part=clause]').count()) === 0) {
        await filter.getByRole('button', { name: 'Add condition', exact: true }).click();
      }
      const condition = filter.locator('[part=clause]').first();
      await condition.locator('[part=field]').selectOption('name');
      await condition.locator('[part=value]').fill('Ada');
      await filter.locator('[part=apply]').click();
      await expect
        .poll(() => lastEvent(page, 'aeliqo-explorer-filter'))
        .toMatchObject({
          predicate: { op: 'compare', entity: 'person', field: 'name', comparison: 'eq', value: 'Ada' },
          applied: true,
        });

      await session.host.getByRole('button', { name: 'Select person lin', exact: true }).click();
      await expect
        .poll(() => lastEvent(page, 'aeliqo-explorer-selection'))
        .toMatchObject({
          mode: 'ids',
          entity: 'person',
          keys: ['string:3:lin'],
          result: { id: 'aeliqo-catalog-example', outputId: 'people' },
          scope: { populationDigest: 'catalog-scope' },
        });
      await capture(session, page, info, 'explorer-interaction');
    });

    test('comparison emits a bounded set and exposes incompatible metrics', async ({ page }, info) => {
      const session = await openCompound(page, 'comparison', variant);
      await session.host.getByRole('button', { name: 'Ada', exact: true }).click();
      await expect
        .poll(() => lastEvent(page, 'aeliqo-comparison-set'))
        .toMatchObject({
          source: 'user',
          entity: 'person',
          keys: ['grace'],
          result: { id: 'aeliqo-catalog-example' },
          scope: { label: 'Authorized people' },
        });

      await setHostProperty(session.host, 'compatible', false);
      await expect(session.host.locator('[part="status"][role="alert"]')).toContainText('cannot be compared');
      await expect(session.host.locator('[part="compare-button"]')).toHaveCount(0);
      await capture(session, page, info, 'comparison-incompatible');

      await setHostProperty(session.host, 'compatible', true);
      await session.host.getByRole('button', { name: 'Grace', exact: true }).click();
      await expect.poll(() => lastEvent(page, 'aeliqo-comparison-set')).toMatchObject({ keys: ['ada'] });
      await capture(session, page, info, 'comparison-interaction');
    });

    test('breakdown emits the selected group identity without deriving a metric', async ({ page }, info) => {
      const session = await openCompound(page, 'breakdown', variant);
      const table = session.host.locator('aeliqo-table');
      await table.locator('input[type="radio"]').first().check();
      await expect
        .poll(() => lastEvent(page, 'aeliqo-breakdown-group'))
        .toMatchObject({
          source: 'user',
          entity: 'person',
          key: 'research',
          result: { id: 'aeliqo-catalog-example' },
          scope: { label: 'Authorized people' },
        });

      await setHostProperty(session.host, 'selectedGroup', 'research');
      await expect(session.host.locator('[part="detail"]')).toContainText('Ada Lovelace');
      await capture(session, page, info, 'breakdown-interaction');
    });

    test('investigation forwards evidence selection with result lineage', async ({ page }, info) => {
      const session = await openCompound(page, 'investigation', variant);
      const trend = session.host.locator('aeliqo-trend');
      await trend.getByText('View data table', { exact: true }).click();
      await expect(trend.locator('[part="data"] button').first()).toBeVisible();
      const select = trend.locator('[part="data"] button').first();
      await select.click();
      await expect
        .poll(() => lastEvent(page, 'aeliqo-visualization-select'))
        .toMatchObject({
          source: 'user',
          identity: JSON.stringify([JSON.stringify(['text', 'ada'])]),
          result: { id: 'aeliqo-catalog-example', outputId: 'people' },
        });
      await expect(select).toHaveAttribute('aria-pressed', 'true');
      await select.focus();
      await select.press('Enter');
      await expect(select).toBeFocused();
      expect(await eventCount(page, 'aeliqo-visualization-select')).toBe(2);
      await expect(session.host.locator('[part="caution"]')).toContainText('do not establish causal claims');
      await capture(session, page, info, 'investigation-selection');
    });

    test('search results restore a matching revision before emitting selection', async ({ page }, info) => {
      const session = await openCompound(page, 'search-results', variant);
      await expect(session.host.locator('[part="status"][role="status"]')).toContainText('out of date');
      await session.host.evaluate(async (element) => {
        const host = element as HTMLElement & {
          queryRevision: string;
          resultRevision: string;
          updateComplete: Promise<unknown>;
        };
        host.resultRevision = host.queryRevision;
        await host.updateComplete;
      });
      await expect(session.host.locator('aeliqo-card-collection')).toBeAttached();
      const selected = session.host.locator('aeliqo-card-collection [part="card-button"]').first();
      await selected.click();
      await expect
        .poll(() => lastEvent(page, 'aeliqo-search-results-selection'))
        .toMatchObject({
          mode: 'ids',
          entity: 'person',
          keys: ['string:3:ada'],
          result: { id: 'aeliqo-catalog-example' },
          scope: { label: 'Authorized people' },
        });
      // Capture selection independently of the pointer left by the click.
      await page.mouse.move(0, 0);
      await expect(selected).toHaveAttribute('aria-pressed', 'true');
      await expect(selected).toHaveText('Selected');
      expect(await selected.evaluate((element) => element.matches(':hover'))).toBe(false);
      await capture(session, page, info, 'search-results-selection');
    });

    test('record editor keeps an IME draft and emits explicit save and cancel receipts', async ({ page }, info) => {
      const session = await openCompound(page, 'record-editor', variant);
      const editor = session.host;
      const field = editor.locator('aeliqo-text-field');
      const input = field.locator('input[part="input"]');
      const save = editor.getByRole('button', { name: 'Save', exact: true });
      const cancel = editor.getByRole('button', { name: 'Cancel', exact: true });

      await field.evaluate(async (element) => {
        const control = element as HTMLElement & { validationState: string; updateComplete: Promise<unknown> };
        control.validationState = 'pending';
        await control.updateComplete;
      });
      await expect(field.locator('[part="pending"][role="status"]')).toHaveText('Checking…');

      await setHostProperty(editor, 'disabled', true);
      await expect(save).toBeDisabled();
      await expect(cancel).toBeDisabled();
      await setHostProperty(editor, 'disabled', false);
      await setHostProperty(editor, 'invalid', true);
      await expect(save).toBeDisabled();
      await setHostProperty(editor, 'invalid', false);
      await setHostProperty(editor, 'status', 'loading');
      await expect(editor.locator('[part="status"][role="status"]')).toContainText('Loading authorized data');
      await setHostProperty(editor, 'status', 'ready');
      await field.evaluate(async (element) => {
        const control = element as HTMLElement & { validationState: string; updateComplete: Promise<unknown> };
        control.validationState = 'idle';
        await control.updateComplete;
      });

      await input.focus();
      await input.evaluate((element) => {
        const native = element as HTMLInputElement;
        native.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        native.value = 'Ada IME draft';
        native.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            isComposing: true,
            inputType: 'insertCompositionText',
            data: 'Ada IME draft',
          }),
        );
      });
      await expect(input).toHaveValue('Ada IME draft');
      await field.evaluate(async (element) => {
        const control = element as HTMLElement & { label: string; updateComplete: Promise<unknown> };
        control.label = 'Updated name';
        await control.updateComplete;
      });
      await expect(input).toBeFocused();
      await input.evaluate((element) =>
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'Ada IME draft' })),
      );
      await expect.poll(() => input.inputValue()).toBe('Ada IME draft');

      await save.click();
      await expect
        .poll(() => lastEvent(page, 'aeliqo-record-editor-save'))
        .toMatchObject({
          source: 'user',
          entity: 'person',
          key: 'string:3:ada',
          entityRevision: 'person-revision-1',
          values: { name: 'Ada IME draft', 'period[start]': '2026-09-01', 'period[end]': '2026-09-30' },
        });
      await cancel.click();
      await expect
        .poll(() => lastEvent(page, 'aeliqo-record-editor-cancel'))
        .toMatchObject({
          source: 'user',
          key: 'string:3:ada',
          entityRevision: 'person-revision-1',
          values: { name: 'Ada IME draft' },
        });
      await capture(session, page, info, 'record-editor-interaction');
    });

    test('form flow validates before moving, preserves draft and focus, then commits', async ({ page }, info) => {
      const session = await openCompound(page, 'form-flow', variant);
      const flow = session.host;
      const input = flow.locator('aeliqo-text-field').locator('input[part="input"]');
      await flow.evaluate((element) => {
        const host = element as HTMLElement & { activeStep: string; addEventListener: HTMLElement['addEventListener'] };
        host.addEventListener('aeliqo-form-flow-step', (raw) => {
          host.activeStep = (raw as CustomEvent<{ to: string }>).detail.to;
        });
      });

      await setHostProperty(flow, 'validation', { identity: 'Name is required.' });
      await expect(flow.locator('[part="status"][role="alert"]')).toHaveText('Name is required.');
      const blockedSteps = await eventCount(page, 'aeliqo-form-flow-step');
      const next = flow.getByRole('button', { name: 'Next', exact: true });
      await expect(next).toBeEnabled();
      await next.click();
      expect(await eventCount(page, 'aeliqo-form-flow-step')).toBe(blockedSteps);
      await setHostProperty(flow, 'validation', {});
      await setHostProperty(flow, 'status', 'loading');
      await expect(flow.locator('[part="status"][role="status"]')).toContainText('Loading authorized data');
      await setHostProperty(flow, 'status', 'ready');

      await input.fill('Ada flow draft');
      await next.focus();
      await next.press('Enter');
      await expect(flow.locator('[part="step-panel"]')).toHaveAttribute('data-step', 'review');
      await expect(flow.locator('[part="step-panel"]')).toBeFocused();
      await expect
        .poll(() => lastEvent(page, 'aeliqo-form-flow-step'))
        .toMatchObject({
          source: 'user',
          from: 'identity',
          to: 'review',
          direction: 'next',
          draft: { name: 'Ada flow draft' },
        });

      await flow.getByRole('button', { name: 'Commit', exact: true }).click();
      await expect
        .poll(() => lastEvent(page, 'aeliqo-form-flow-commit'))
        .toMatchObject({
          source: 'user',
          step: 'review',
          draft: { name: 'Ada flow draft' },
        });
      const back = flow.getByRole('button', { name: 'Back', exact: true });
      await back.focus();
      await back.press('Enter');
      await expect(flow.locator('[part="step-panel"]')).toHaveAttribute('data-step', 'identity');
      await expect(input).toBeFocused();
      await capture(session, page, info, 'form-flow-interaction');
    });

    test('quality panel stays a read-only evidence surface without interaction events', async ({ page }, info) => {
      const session = await openCompound(page, 'quality-panel', variant);
      await expect(session.host.locator('[part="root"]')).toHaveAttribute('data-status', 'ready');
      await expect(session.host).toContainText('People registry');
      await expect(session.host.locator('[part="unsupported"]')).toContainText(
        'This view does not establish causation.',
      );
      await expect(session.host.locator('button, a, input, select, textarea')).toHaveCount(0);
      expect(await page.evaluate(() => (window as ReviewWindow).compoundInteractionEvents ?? [])).toEqual([]);
      await capture(session, page, info, 'quality-panel-read-only');
    });
  });
}
