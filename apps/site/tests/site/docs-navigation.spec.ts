import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { componentCatalog } from '../shared/catalog.js';
import { RELEASE_VERSION } from '../../../../scripts/release/metadata.mjs';

const COMPONENT_ROUTES = componentCatalog.map(({ id }) => `/components/${id}/`);

test('quickstart question labels wrap only between words on a narrow screen', async ({ browser }, testInfo) => {
  for (const javaScriptEnabled of [true, false]) {
    const context = await browser.newContext({ javaScriptEnabled, viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    try {
      await page.goto('/start/');
      const table = page.getByRole('region', { name: 'Questions, intents, and expected views' });
      await expect(table).toBeVisible();
      for (const [width, fontFamily] of [
        [360, ''],
        [320, 'Verdana, sans-serif'],
      ] as const) {
        await page.setViewportSize({ width, height: 800 });
        await table.locator('table').evaluate((element, font) => {
          element.style.fontFamily = font;
        }, fontFamily);
        const splitWords = await table.locator('th[scope="row"]').evaluateAll((cells) =>
          cells.flatMap((cell) => {
            const text = cell.firstChild!;
            return [...(text.textContent ?? '').matchAll(/\S+/gu)].flatMap((match) => {
              const range = document.createRange();
              range.setStart(text, match.index);
              range.setEnd(text, match.index + match[0].length);
              return range.getClientRects().length > 1 ? [match[0]] : [];
            });
          }),
        );
        expect(splitWords).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const geometry = await table.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          columns: [...element.querySelectorAll('tbody tr:first-child > *')].map((cell) => ({
            width: cell.getBoundingClientRect().width,
            padding: getComputedStyle(cell).paddingInline,
          })),
        }));
        await testInfo.attach(`table-${width}-js-${javaScriptEnabled}`, {
          body: JSON.stringify(geometry),
          contentType: 'application/json',
        });
        expect(geometry.scrollWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.clientWidth);
        await expect(table).toHaveAttribute('tabindex', '0');
        await table.focus();
        await expect(table).toBeFocused();
      }
    } finally {
      await context.close();
    }
  }
});

test('each component page exposes the complete component menu and identifies its current entry', async ({ page }) => {
  for (const route of [
    '/components/foundation.button/',
    '/components/data.table/',
    '/components/compound.quality-panel/',
  ]) {
    await page.goto(route);
    const menu = page.getByRole('navigation', { name: 'Documentation' });
    const componentMenu = menu.locator('.docs-component-menu');
    await expect(componentMenu.locator('a')).toHaveCount(COMPONENT_ROUTES.length);
    for (const componentRoute of COMPONENT_ROUTES)
      await expect(componentMenu.locator(`a[href="${componentRoute}"]`)).toHaveCount(1);
    await expect(componentMenu.locator('a[aria-current="page"]')).toHaveAttribute('href', route);
    await expect(componentMenu.locator('details[open]')).toHaveCount(1);
    await expect(componentMenu.locator('details[open] a[aria-current="page"]')).toHaveAttribute('href', route);
  }
  await page.goto('/components/');
  await expect(page.locator('.docs-component-menu a')).toHaveCount(COMPONENT_ROUTES.length);
  await page.goto('/components/data.table/');
  const foundation = page.locator('.docs-component-menu details').filter({
    has: page.locator('a[href="/components/foundation.button/"]'),
  });
  await foundation.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(foundation).toHaveAttribute('open');
  await foundation.locator('a[href="/components/foundation.button/"]').click();
  await expect(page).toHaveURL(/\/components\/foundation\.button\/$/);
  await page.goto('/concepts/');
  const conceptsMenu = page.locator('.docs-component-menu');
  await expect(conceptsMenu.locator('a')).toHaveCount(COMPONENT_ROUTES.length);
  await expect(conceptsMenu.locator('details[open]')).toHaveCount(0);
});

const ADOPTION_ROUTES = [
  '/start/',
  '/start/registered-app/',
  '/start/existing-app/',
  '/start/frameworks/',
  '/guides/resources/',
  '/agents/',
  '/concepts/',
  '/components/',
  '/reference/',
  '/ship/',
  '/examples/',
  '/advanced/',
  '/contribute/',
] as const;

test('documentation information architecture exposes distinct adoption routes', async ({ page }) => {
  for (const route of ['/docs/', ...ADOPTION_ROUTES]) {
    await page.goto(route);
    await expect(page.locator('.reading h1')).toBeVisible();
    await expect(page.locator('.docs-sidebar')).toBeVisible();
  }

  await page.goto('/docs/');
  await expect(page.locator('.docs-nav-group > summary')).toHaveText(['Get started', 'Components', 'Advanced']);
  await expect(page.locator('header .brand')).toHaveAttribute('href', '/');
  await expect(page.locator('.footer-brand')).toHaveAttribute('href', '/');
  await expect(page.locator('#site-nav').getByRole('link', { name: 'Docs', exact: true })).toHaveAttribute(
    'href',
    '/docs/',
  );
  for (const route of ADOPTION_ROUTES) await expect(page.locator(`.docs-sidebar a[href="${route}"]`)).toHaveCount(1);
  for (const route of [
    '/start/',
    '/start/registered-app/',
    '/start/existing-app/',
    '/start/what-is-aeliqo/',
    '/playground/',
  ]) {
    await expect(page.locator(`.reading a[href="${route}"]`).first()).toBeVisible();
  }
});

test('documentation search keeps keyboard, query, no-result, and fallback paths', async ({ browser, page }) => {
  await page.goto('/concepts/');
  await expect(page.locator('.docs-sidebar .docs-search-fallback')).toHaveCount(0);
  const searchTrigger = page.locator('.docs-sidebar .search-trigger');
  await expect(searchTrigger).toBeVisible();
  await expect(searchTrigger).toHaveAttribute('href', '/search/');
  const searchDialog = page.locator('#docs-search-dialog');
  // The trigger is static HTML; the shortcut listener attaches when the docs module runs.
  await expect(async () => {
    await page.keyboard.press('Control+K');
    await expect(searchDialog.getByRole('dialog')).toBeVisible({ timeout: 1_000 });
  }).toPass();
  const field = page.locator('#docs-search-dialog input.docs-search-field');
  await field.fill('table');
  const rankedLinks = page.locator('#docs-search-dialog .search-results a');
  await expect(rankedLinks.first()).toHaveAttribute('href', '/components/data.table/');
  await expect(rankedLinks.first().locator('strong')).toHaveText('Table');
  await expect(page.locator("#docs-search-dialog .search-results a[href='/legal/privacy/']")).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ['landmark-no-duplicate-banner', 'landmark-unique', 'region'].includes(violation.id),
    ),
  ).toEqual([]);
  await field.fill('meaning');
  await expect(page).toHaveURL(/\?q=meaning$/);
  await expect(page.locator('#docs-search-dialog').getByRole('link').first()).toBeVisible();
  await field.fill('no-such-aeliqo-zxqw');
  await expect(page.locator('#docs-search-dialog')).toContainText('No pages found');

  const noScriptContext = await browser.newContext({ javaScriptEnabled: false });
  const noScriptPage = await noScriptContext.newPage();
  try {
    await noScriptPage.goto('/search/?q=meaning');
    await expect(noScriptPage.getByRole('heading', { level: 1, name: 'Search documentation' })).toBeVisible();
    await expect(noScriptPage.locator('form.docs-search-fallback').first()).toHaveAttribute('action', '/search/');
    await expect(noScriptPage.locator('.search-fallback-links a').first()).toBeVisible();
    await noScriptPage.goto('/components/data.table/');
    const noScriptTrigger = noScriptPage.locator('.docs-sidebar .search-trigger');
    await expect(noScriptTrigger).toBeVisible();
    await expect(noScriptTrigger).toHaveAttribute('href', '/search/');
  } finally {
    await noScriptContext.close();
  }
});

test('component pages combine authored guidance with generated API facts and the executable example', async ({
  page,
}) => {
  await page.goto('/components/data.table/');
  for (const heading of [
    'Import and live example',
    'Purpose',
    'When to use it',
    'When to use a different component',
    'Properties and defaults',
    'Events',
    'States and failure handling',
    'Keyboard, focus, and accessibility',
    'Responsive behavior',
    'Style hooks',
    'Performance limits',
    'Related components',
    'Generated TypeScript declaration',
    'Version',
  ]) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  const preview = await page.locator('[data-preview-mount]').boundingBox();
  const purpose = await page.getByRole('heading', { name: 'Purpose', exact: true }).boundingBox();
  expect(preview).not.toBeNull();
  expect(purpose).not.toBeNull();
  expect(preview!.y).toBeLessThan(purpose!.y);
  await expect(page.getByText(/Expected result:/)).toBeVisible();
  await expect(page.locator('.component-adoption')).not.toContainText('{{aeliqo:');
  await expect(page.locator('[data-example-code=table]')).toContainText('import');
  await page.locator('.component-declaration summary').click();
  await expect(page.locator('.component-declaration')).toContainText('AeliqoTableElement');
  await expect(page.locator('.reading')).not.toContainText('not declared');

  await page.goto('/components/compound.form-flow/');
  await expect(page.getByRole('heading', { name: 'Performance limits', exact: true })).toHaveCount(0);
  await page.goto('/components/compound.comparison/');
  await expect(page.getByRole('heading', { name: 'Performance limits', exact: true })).toBeVisible();
  await expect(page.locator('.reading')).toContainText('MAX_COMPARISON_KEYS');
});

test('all 71 component previews load without page or console errors', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  for (const route of COMPONENT_ROUTES) {
    await page.goto(route);
    await expect(page.locator('[data-preview-status]'), route).toHaveText('Interactive preview loaded.');
  }
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('dialog preview can close and reopen from its documented trigger', async ({ page }) => {
  await page.goto('/components/feedback.dialog/');
  await expect(page.locator('[data-preview-status]')).toHaveText('Interactive preview loaded.');
  const trigger = page.getByRole('button', { name: 'Open confirmation' });
  const dialog = page.getByRole('dialog', { name: 'Confirm archive' });
  await expect(dialog).toBeHidden();
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Archive report' }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('narrow documentation exposes compact navigation before the requested article', async ({ browser, page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/components/data.table/');
  const heading = await page.getByRole('heading', { level: 1, name: 'Table', exact: true }).boundingBox();
  const sidebar = await page.locator('.docs-sidebar').boundingBox();
  expect(heading).not.toBeNull();
  expect(sidebar).not.toBeNull();
  expect(heading!.y).toBeLessThan(800);
  expect(sidebar!.y).toBeLessThan(heading!.y);
  const toggle = page.locator('.docs-nav-toggle');
  await expect(toggle).not.toBeChecked();
  for (
    let index = 0;
    index < 20 && !(await toggle.evaluate((element) => element === document.activeElement));
    index += 1
  )
    await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();
  await expect(page.locator('label.docs-nav-summary')).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Space');
  await expect(toggle).toBeChecked();
  await expect(page.locator('.docs-sidebar nav')).toBeVisible();
  await expect(page.locator('.docs-component-menu a[aria-current="page"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  const noScriptContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 800 } });
  const noScriptPage = await noScriptContext.newPage();
  try {
    await noScriptPage.goto('/components/data.table/');
    const noScriptHeading = await noScriptPage
      .getByRole('heading', { level: 1, name: 'Table', exact: true })
      .boundingBox();
    const noScriptSidebar = await noScriptPage.locator('.docs-sidebar').boundingBox();
    expect(noScriptHeading).not.toBeNull();
    expect(noScriptSidebar).not.toBeNull();
    expect(noScriptHeading!.y).toBeLessThan(800);
    expect(noScriptSidebar!.y).toBeLessThan(noScriptHeading!.y);
    await expect(noScriptPage.locator('.docs-nav-toggle')).not.toBeChecked();
    await noScriptPage.locator('label.docs-nav-summary').click();
    await expect(noScriptPage.locator('.docs-component-menu a[aria-current="page"]')).toBeVisible();
    expect(await noScriptPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await noScriptContext.close();
  }
});

test('all generated component routes fit 320px and 360px without page overflow', async ({ browser }) => {
  test.setTimeout(180_000);
  for (const width of [320, 360]) {
    const hydratedContext = await browser.newContext({ viewport: { width, height: 800 } });
    const hydratedPage = await hydratedContext.newPage();
    try {
      for (const route of COMPONENT_ROUTES) {
        await hydratedPage.goto(route);
        await expect(hydratedPage.locator('.reading h1')).toBeVisible();
        await expect
          .poll(() => hydratedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {
            message: `component route must fit ${width}px: ${route}`,
          })
          .toBe(true);
      }
    } finally {
      await hydratedContext.close();
    }

    const noScriptContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 800 } });
    const noScriptPage = await noScriptContext.newPage();
    try {
      for (const route of COMPONENT_ROUTES) {
        await noScriptPage.goto(route);
        await expect(noScriptPage.locator('.reading h1')).toBeVisible();
        expect(await noScriptPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    } finally {
      await noScriptContext.close();
    }
  }
});

test('scrollable code remains focusable and named across static, hydrated, and opened states', async ({
  browser,
  page,
}) => {
  await page.goto('/start/');
  const packageManifest = page.locator('.reading .doc-code pre').first();
  await expect(packageManifest).toContainText('npm create vite@latest people');
  await expect(packageManifest).toHaveAttribute('tabindex', '0');
  await packageManifest.focus();
  await expect(packageManifest).toBeFocused();
  const typescriptConfig = page.locator('.reading .doc-code pre').nth(1);
  await expect(typescriptConfig).toContainText(`@varendo/react@${RELEASE_VERSION}`);
  await expect(typescriptConfig).toHaveAttribute('tabindex', '0');
  await typescriptConfig.focus();
  await expect(typescriptConfig).toBeFocused();
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);

  const noScriptContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 800 } });
  const noScriptPage = await noScriptContext.newPage();
  try {
    await noScriptPage.goto('/start/');
    const staticPackageManifest = noScriptPage.locator('.reading .doc-code pre').first();
    await expect(staticPackageManifest).toContainText('npm create vite@latest people');
    await expect(staticPackageManifest).toHaveAttribute('tabindex', '0');
    await staticPackageManifest.focus();
    await expect(staticPackageManifest).toBeFocused();

    await noScriptPage.goto('/components/data.table/');
    const noScriptDetails = noScriptPage.locator('details.component-example');
    await noScriptDetails.evaluate((element) => {
      (element as HTMLDetailsElement).open = true;
    });
    const noScriptExample = noScriptDetails.locator('pre');
    await expect(noScriptExample).toHaveAttribute('tabindex', '0');
    await noScriptExample.focus();
    await expect(noScriptExample).toBeFocused();
  } finally {
    await noScriptContext.close();
  }

  await page.goto('/components/data.table/');
  const details = page.locator('details.component-example');
  await details.locator('summary').click();
  const example = details.locator('pre');
  await expect(example).toHaveAttribute('tabindex', '0');
  await example.focus();
  await expect(example).toBeFocused();
  const apiPre = page.locator('.code-scroll > pre');
  await expect(apiPre).toHaveAttribute('tabindex', '0');
  await expect(apiPre).not.toHaveAttribute('aria-label');
  await expect(page.locator('.code-scroll')).toHaveAttribute('role', 'region');
  await expect(page.locator('.code-scroll')).toHaveAttribute('aria-label', 'Table TypeScript declaration');
  const openedA11y = await new AxeBuilder({ page }).include('main').analyze();
  expect(openedA11y.violations).toEqual([]);
});

test('every generated component example keeps its code focusable when opened', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 360, height: 800 });
  for (const route of COMPONENT_ROUTES) {
    try {
      await page.goto(route);
    } catch (error) {
      // Chromium can abort one navigation while rapidly replacing 71 documents.
      // Retry only that transport-level abort; all HTTP and assertion failures remain fatal.
      if (!(error instanceof Error) || !error.message.includes('net::ERR_ABORTED')) throw error;
      await page.goto(route);
    }
    const details = page.locator('details.component-example');
    await details.evaluate((element) => {
      (element as HTMLDetailsElement).open = true;
    });
    const pre = details.locator('pre');
    await expect(pre).toHaveAttribute('tabindex', '0');
  }
});

test('homepage code disclosures remain focusable at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/');
  await page.locator('#demo-tab-code').click();
  const pre = page.locator('#demo-panel-code pre.demo-code').first();
  await expect(pre).toHaveAttribute('tabindex', '0');
  await pre.focus();
  await expect(pre).toBeFocused();
  const accessibility = await new AxeBuilder({ page }).include('main').analyze();
  expect(accessibility.violations).toEqual([]);
});

test('homepage adaptive result remains a named accessible section after evaluation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#demo-status')).toContainText('4 of 4 synthetic people matched');
  await page.locator('#team').selectOption('Engineering');
  await expect(page.locator('#demo-status')).toContainText('2 of 4 synthetic people matched');
  const result = page.getByRole('region', { name: 'Synthetic people adaptive result', exact: true });
  await expect(result).toBeVisible();
  await expect(result).toContainText('Sam Rivera');
  const accessibility = await new AxeBuilder({ page }).include('main').analyze();
  expect(accessibility.violations).toEqual([]);
});

test('enabled analytics consent is announced in flow before documentation', async ({ page }) => {
  await page.goto('/docs/');
  const consent = page.locator('#analytics-consent');
  const prepared = await page.evaluate(async () => {
    const analyticsModule = '/src/analytics.ts';
    const { prepareGoogleAnalytics } = await import(analyticsModule);
    const values = new Map<string, string>();
    const browser = {
      location: {
        hostname: 'hermawan22.github.io',
        protocol: 'https:',
        origin: 'https://hermawan22.github.io/varendo',
        pathname: '/docs/',
      },
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
      dispatchEvent: () => true,
    } as unknown as Window;
    return prepareGoogleAnalytics({ enabled: true, measurementId: 'G-ABCDEF' }, browser, document);
  });
  expect(prepared).toBe(true);
  await expect(consent).toHaveAttribute('role', 'region');
  await expect(consent).toHaveAttribute('aria-live', 'polite');
  await expect(consent).toBeVisible();
  await expect(consent.getByRole('button', { name: 'Allow analytics', exact: true })).toBeVisible();
  const consentBox = await consent.boundingBox();
  const headingBox = await page
    .getByRole('heading', { level: 1, name: 'Build interfaces that adapt to the task', exact: true })
    .boundingBox();
  expect(consentBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(consentBox!.y).toBeLessThan(page.viewportSize()!.height);
  expect(consentBox!.y).toBeLessThan(headingBox!.y);
  const accessibility = await new AxeBuilder({ page }).include('#analytics-consent').analyze();
  expect(accessibility.violations).toEqual([]);
});
