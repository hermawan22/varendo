import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { componentCatalog } from '../shared/catalog.js';

const COMPONENT_ROUTES = componentCatalog.map((component) => ({
  id: component.id.slice(component.id.indexOf('.') + 1),
  route: `/components/${component.id}/`,
  name: component.name,
}));
const REPRESENTATIVE_ROUTE = '/components/data.table/';
const HYDRATION_LAYOUT_SHIFT_BUDGET = 0.1;

type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
type LayoutEvidence = {
  readonly sidebarVersion: Box | null;
  readonly sidebarNavigation: Box | null;
  readonly componentPreview: Box | null;
  readonly propertiesHeading: Box | null;
  readonly apiTable: Box | null;
};
type LayoutShiftEvidence = {
  readonly value: number;
  readonly hadRecentInput: boolean;
  readonly startTime: number;
  readonly sourceSelectors: readonly string[];
};
type LayoutObservation = { readonly route: string; readonly entries: readonly LayoutShiftEvidence[] };
type RouteEvidence = {
  readonly route: string;
  readonly component: string;
  readonly noScript: LayoutEvidence;
  readonly hydrated: LayoutEvidence;
  readonly layoutObservation: LayoutObservation;
  readonly hydrationLayoutShiftValue: number;
};

const boxes = async (page: Page): Promise<LayoutEvidence> =>
  page.evaluate(() => {
    const read = (element: Element | null): Box | null => {
      if (element === null) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      sidebarVersion: read(document.querySelector('.docs-version')),
      sidebarNavigation: read(document.querySelector('.docs-sidebar-content > nav')),
      componentPreview: read(document.querySelector('[data-preview-mount]')),
      propertiesHeading: read(document.querySelector('#properties-and-defaults')),
      apiTable: read(document.querySelector('.api-table')),
    };
  });

const expectStable = (before: Box | null, after: Box | null, name: string): void => {
  expect(before, `${name} must exist without JavaScript`).not.toBeNull();
  expect(after, `${name} must exist with JavaScript`).not.toBeNull();
  expect(Math.abs(after!.x - before!.x), `${name} x changed during hydration`).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.y - before!.y), `${name} y changed during hydration`).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.width - before!.width), `${name} width changed during hydration`).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.height - before!.height), `${name} height changed during hydration`).toBeLessThanOrEqual(1);
};

async function assertNoScriptRoute(page: Page, component: (typeof COMPONENT_ROUTES)[number]): Promise<LayoutEvidence> {
  await page.goto(component.route, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: component.name, exact: true })).toBeVisible();
  await expect(page.locator('.search-trigger')).toHaveAttribute('href', '/search/');
  await expect(page.locator('[data-component-preview] [data-preview-mount]')).toContainText(
    'Interactive preview requires JavaScript.',
  );
  await expect(page.getByText(/Expected result:/)).toBeVisible();
  await expect(page.locator('[data-preview-mount]')).toContainText('Interactive preview requires JavaScript.');
  await expect(page.locator(`[data-example-code='${component.id}']`)).toContainText('import');
  await expect(page.locator(`[data-copy-example='${component.id}']`)).toBeDisabled();
  return boxes(page);
}

async function readLayoutObservation(page: Page): Promise<LayoutObservation> {
  return page.evaluate(() => {
    type RecordedShift = LayoutShiftEvidence;
    type LayoutShiftState = {
      readonly observer: PerformanceObserver;
      readonly records: RecordedShift[];
      readonly record: (entry: PerformanceEntry) => void;
    };
    const state = (window as Window & { __aeliqoLayoutShiftState?: LayoutShiftState }).__aeliqoLayoutShiftState;
    if (state === undefined) throw new Error('Layout-shift PerformanceObserver was not installed before navigation.');
    for (const entry of state.observer.takeRecords()) state.record(entry);
    state.observer.disconnect();
    return { route: location.pathname, entries: state.records };
  });
}

async function assertCopySuccess(page: Page, componentId: string): Promise<void> {
  const code = await page.locator(`[data-example-code='${componentId}']`).textContent();
  if (code === null) throw new Error(`Missing copy source for ${componentId}`);
  await page.locator('details.component-example summary').click();
  await page.locator(`[data-copy-example='${componentId}']`).click();
  await expect(page.locator('[data-copy-status]')).toHaveText('Example copied.');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(code);
}

test('all component documentation routes preserve static content and hydration layout', async ({
  browser,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== 'string' || baseURL.length === 0)
    throw new Error('document-layout probe requires a Playwright baseURL');
  expect(COMPONENT_ROUTES, 'the document-layout probe must enumerate the complete public catalog').toHaveLength(71);

  const noScriptContext = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const noScriptPage = await noScriptContext.newPage();
  const noScriptEvidence = new Map<string, LayoutEvidence>();
  try {
    for (const component of COMPONENT_ROUTES) {
      noScriptEvidence.set(component.route, await assertNoScriptRoute(noScriptPage, component));
    }
  } finally {
    await noScriptContext.close();
  }
  expect(noScriptEvidence.size, 'every component route must have no-JavaScript evidence').toBe(COMPONENT_ROUTES.length);

  const context = await browser.newContext({ baseURL, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.addInitScript(() => {
    type RecordedShift = {
      readonly value: number;
      readonly hadRecentInput: boolean;
      readonly startTime: number;
      readonly sourceSelectors: readonly string[];
    };
    type LayoutShiftEntry = PerformanceEntry & {
      readonly value?: number;
      readonly hadRecentInput?: boolean;
      readonly sources?: readonly { readonly node?: Node | null }[];
    };
    type LayoutShiftState = {
      readonly observer: PerformanceObserver;
      readonly records: RecordedShift[];
      readonly record: (entry: PerformanceEntry) => void;
    };
    const records: RecordedShift[] = [];
    const record = (entry: PerformanceEntry): void => {
      const shift = entry as LayoutShiftEntry;
      const sourceSelectors = (shift.sources ?? []).map(({ node }) => {
        if (!(node instanceof Element)) return node?.nodeName ?? 'unknown';
        const identity = node.id.length > 0 ? `#${node.id}` : '';
        const classes =
          typeof node.className === 'string' && node.className.length > 0
            ? `.${node.className.trim().split(/\s+/).join('.')}`
            : '';
        const preview = node.closest('[data-preview-mount]') !== null ? ' [data-preview-mount]' : '';
        return `${node.localName}${identity}${classes}${preview}`;
      });
      records.push({
        value: shift.value ?? 0,
        hadRecentInput: shift.hadRecentInput ?? false,
        startTime: shift.startTime,
        sourceSelectors,
      });
    };
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) record(entry);
    });
    observer.observe({ type: 'layout-shift', buffered: true });
    (window as Window & { __aeliqoLayoutShiftState?: LayoutShiftState }).__aeliqoLayoutShiftState = {
      observer,
      records,
      record,
    };
  });

  const evidence: RouteEvidence[] = [];
  try {
    for (const component of COMPONENT_ROUTES) {
      browserErrors.length = 0;
      const staticEvidence = noScriptEvidence.get(component.route);
      if (staticEvidence === undefined) throw new Error(`Missing no-JavaScript evidence for ${component.route}`);
      await page.goto(component.route, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1, name: component.name, exact: true })).toBeVisible();
      await expect(page.locator(`[data-component-preview] aeliqo-${component.id}`)).toBeAttached();
      await expect(page.getByText(/Expected result:/)).toBeVisible();
      await expect(page.locator(`[data-copy-example='${component.id}']`)).toBeEnabled();
      await page.evaluate(async (tagName) => {
        await customElements.whenDefined(tagName);
        const element = document.querySelector<HTMLElement>(`[data-preview-mount] ${tagName}`) as
          (HTMLElement & { updateComplete?: Promise<unknown> }) | null;
        await element?.updateComplete;
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }, `aeliqo-${component.id}`);
      expect(browserErrors, `${component.route} must hydrate without production CSP or runtime errors`).toEqual([]);

      const hydrated = await boxes(page);
      expectStable(staticEvidence.sidebarVersion, hydrated.sidebarVersion, `${component.route} sidebar version status`);
      expectStable(
        staticEvidence.sidebarNavigation,
        hydrated.sidebarNavigation,
        `${component.route} sidebar navigation`,
      );
      expectStable(staticEvidence.componentPreview, hydrated.componentPreview, `${component.route} preview shell`);
      expectStable(
        staticEvidence.propertiesHeading,
        hydrated.propertiesHeading,
        `${component.route} properties heading`,
      );
      expectStable(staticEvidence.apiTable, hydrated.apiTable, `${component.route} API table`);

      const layoutObservation = await readLayoutObservation(page);
      expect(
        layoutObservation.route,
        `${component.route} layout observer must be fresh for the current navigation`,
      ).toBe(component.route);
      const hydrationLayoutShiftValue = layoutObservation.entries
        .filter((entry) => !entry.hadRecentInput)
        .reduce((sum, entry) => sum + entry.value, 0);
      expect(
        hydrationLayoutShiftValue,
        `${component.route} controlled hydration layout shift exceeded the ${HYDRATION_LAYOUT_SHIFT_BUDGET} budget`,
      ).toBeLessThanOrEqual(HYDRATION_LAYOUT_SHIFT_BUDGET);
      evidence.push({
        route: component.route,
        component: component.id,
        noScript: staticEvidence,
        hydrated,
        layoutObservation,
        hydrationLayoutShiftValue,
      });

      if (component.route === REPRESENTATIVE_ROUTE) await assertCopySuccess(page, component.id);
    }
  } finally {
    await context.close();
  }

  const output = testInfo.outputPath('document-layout-evidence.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify(
      {
        routeCount: COMPONENT_ROUTES.length,
        routes: evidence,
        layoutShiftBudget: HYDRATION_LAYOUT_SHIFT_BUDGET,
        claims: [
          'All 71 component routes were checked with JavaScript disabled for readable fallback content, disabled search/copy controls, and authored expected-result content beside the executable preview.',
          'Every route compares no-JavaScript and hydrated sentinel boxes for x, y, width, and height, including the preview shell, properties heading, and API table; the comparison is independent of PerformanceObserver entries.',
          'The browser PerformanceObserver records layout-shift entries during each controlled JavaScript hydration navigation, retaining source selectors and summing all entries without recent input against a 0.1 per-route observation budget; this is not a p75 field CLS claim.',
          'The data.table route grants clipboard permissions and verifies successful copy status plus clipboard contents.',
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
});

test('timeline preview reserves normal text and reflows enlarged content', async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== 'string') throw new Error('document-layout probe requires a Playwright baseURL');
  for (const width of [320, 360, 768, 1280, 1440]) {
    for (const textScale of [1, 2]) {
      const contexts = await Promise.all(
        [false, true].map((javaScriptEnabled) =>
          browser.newContext({ baseURL, javaScriptEnabled, viewport: { width, height: 900 } }),
        ),
      );
      try {
        const pages = await Promise.all(contexts.map((context) => context.newPage()));
        for (const page of pages) {
          await page.goto('/components/visualization.timeline/');
          await page.evaluate((scale) => {
            document.documentElement.style.fontSize = `${16 * scale}px`;
          }, textScale);
        }
        const [staticPage, hydratedPage] = pages;
        if (staticPage === undefined || hydratedPage === undefined) throw new Error('Missing timeline pages');
        await hydratedPage.locator('aeliqo-timeline').evaluate(async (element) => {
          await customElements.whenDefined('aeliqo-timeline');
          await (element as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        });
        const before = await boxes(staticPage);
        const after = await boxes(hydratedPage);
        const label = `timeline ${width}px at ${textScale * 100}% text`;
        if (textScale === 1) {
          expectStable(before.componentPreview, after.componentPreview, `${label} preview`);
          expectStable(before.propertiesHeading, after.propertiesHeading, `${label} following content`);
        }
        const content = await hydratedPage.locator('aeliqo-timeline').evaluate((element) => {
          const viewport = element.shadowRoot?.querySelector<HTMLElement>('[part="viewport"]');
          const shell = element.closest<HTMLElement>('[data-preview-mount]');
          if (viewport === undefined || viewport === null || shell === null)
            throw new Error('Missing timeline content');
          const button = element.shadowRoot?.querySelector<HTMLButtonElement>('[part="data"] button');
          if (button === undefined || button === null) throw new Error('Missing selection control');
          const textRange = document.createRange();
          textRange.selectNodeContents(button);
          return {
            selectionTextLines: textRange.getClientRects().length,
            selectionTextWidth: textRange.getBoundingClientRect().width,
            selectionWidth: button.getBoundingClientRect().width,
            pageWidth: document.documentElement.scrollWidth,
            readingWidth: document.querySelector('.reading')?.getBoundingClientRect().width ?? 0,
            shellHeight: shell.clientHeight,
            shellScrollHeight: shell.scrollHeight,
            viewportPadding: Number.parseFloat(getComputedStyle(viewport).paddingBlockStart),
            fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
            rows: element.shadowRoot?.querySelectorAll('tbody tr').length,
          };
        });
        if (textScale === 2) expect(content.readingWidth, `${label} readable column`).toBeGreaterThan(width * 0.75);
        expect(content.pageWidth, `${label} page overflow`).toBeLessThanOrEqual(width);
        expect(
          content.shellScrollHeight,
          `${label} preview must grow without a nested vertical scroll`,
        ).toBeLessThanOrEqual(content.shellHeight + 1);
        expect(content.viewportPadding, `${label} chart label gutter`).toBeGreaterThanOrEqual(content.fontSize);
        expect(content.rows, `${label} complete data table`).toBe(3);
        expect(content.selectionTextLines, `${label} single-line Select control`).toBe(1);
        expect(content.selectionTextWidth, `${label} Select text fits`).toBeLessThanOrEqual(content.selectionWidth);
        if (textScale === 2 && width >= 1280) {
          const navigationToggle = hydratedPage.locator('.docs-nav-toggle');
          await navigationToggle.focus();
          await navigationToggle.press('Space');
          await expect(navigationToggle).toBeChecked();
          await expect(hydratedPage.locator('.docs-sidebar-content')).toBeVisible();
          await navigationToggle.press('Space');
          await expect(navigationToggle).not.toBeChecked();
          await expect(navigationToggle).toBeFocused();
        }
        await hydratedPage.screenshot({
          path: testInfo.outputPath(`timeline-${width}-${textScale}x.png`),
          fullPage: true,
        });
      } finally {
        await Promise.all(contexts.map((context) => context.close()));
      }
    }
  }
});
