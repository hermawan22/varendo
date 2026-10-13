import { expect, test } from '@playwright/test';

function captureBrowserErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('server output contains useful request-scoped DOM with JavaScript disabled', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('SSR fixture requires baseURL');
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    extraHTTPHeaders: { 'x-varendo-principal': 'alpha' },
  });
  try {
    const page = await context.newPage();
    const response = await page.goto('/vnext/ssr/people');
    expect(response?.ok()).toBe(true);
    expect(response?.headers()['cache-control']).toBe('private, no-store');
    await expect(page.getByRole('cell', { name: 'Ada Chen', exact: true })).toBeVisible();
    const source = await response!.text();
    expect(source).toContain('people-alpha-v1');
    expect(source).not.toContain('Bela Rossi');
    expect(source).not.toContain('TEST_PRIVATE_CREDENTIAL');
  } finally {
    await context.close();
  }
});

test('concurrent principals receive isolated markup and public snapshots', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('SSR fixture requires baseURL');
  const alpha = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-varendo-principal': 'alpha' } });
  const beta = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-varendo-principal': 'beta' } });
  try {
    const [alphaPage, betaPage] = await Promise.all([alpha.newPage(), beta.newPage()]);
    const [alphaResponse, betaResponse] = await Promise.all([
      alphaPage.goto('/vnext/ssr/people'),
      betaPage.goto('/vnext/ssr/people'),
    ]);
    const [alphaHtml, betaHtml] = await Promise.all([alphaResponse!.text(), betaResponse!.text()]);

    await expect(alphaPage.getByRole('cell', { name: 'Ada Chen', exact: true })).toBeVisible();
    await expect(betaPage.getByRole('cell', { name: 'Bela Rossi', exact: true })).toBeVisible();
    expect(alphaHtml).toContain('people-alpha-v1');
    expect(alphaHtml).not.toContain('Bela Rossi');
    expect(alphaHtml).not.toContain('people-beta-v1');
    expect(betaHtml).toContain('people-beta-v1');
    expect(betaHtml).not.toContain('Ada Chen');
    expect(betaHtml).not.toContain('people-alpha-v1');
  } finally {
    await Promise.all([alpha.close(), beta.close()]);
  }
});

test('slow hydration preserves the server DOM and reports no browser errors', async ({ page }) => {
  const errors = captureBrowserErrors(page);
  await page.setExtraHTTPHeaders({ 'x-varendo-principal': 'alpha' });
  // Keep a deterministic window in which the browser can observe the
  // server-rendered status before the intentionally delayed hydration runs.
  // The fixture caps this delay at 1s; the shorter delay raced on slower CI
  // runners after navigation had already yielded to the hydration timer.
  await page.goto('/vnext/ssr/people?hydrationDelay=1000');
  await expect(page.getByRole('cell', { name: 'Ada Chen', exact: true })).toBeVisible();
  await expect(page.locator('#ssr-status')).toHaveText('Server-rendered people table');
  await expect(page.locator('#ssr-status')).toHaveText('Hydrated people table');
  await expect(page.locator('html')).toHaveAttribute('data-varendo-hydrated', 'true');
  await expect(page.locator('html')).not.toHaveAttribute('data-varendo-hydration-error', /.+/);
  await expect(page.getByRole('cell', { name: 'Ada Chen', exact: true })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('rapid navigation fences an unfinished hydration to its original document', async ({ page }) => {
  const errors = captureBrowserErrors(page);
  await page.setExtraHTTPHeaders({ 'x-varendo-principal': 'alpha' });
  await page.goto('/vnext/ssr/people?hydrationDelay=400');
  await expect(page.getByRole('cell', { name: 'Ada Chen', exact: true })).toBeVisible();
  await page.setExtraHTTPHeaders({ 'x-varendo-principal': 'beta' });
  await page.goto('/vnext/ssr/people?hydrationDelay=0');
  await expect(page.getByRole('cell', { name: 'Bela Rossi', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Ada Chen', exact: true })).toHaveCount(0);
  await expect(page.locator('#ssr-status')).toHaveText('Hydrated people table');
  expect(errors).toEqual([]);
});

test('server-selected RTL and theme bootstrap survive hydration', async ({ page }) => {
  const errors = captureBrowserErrors(page);
  await page.setExtraHTTPHeaders({
    'x-varendo-principal': 'beta',
    'x-varendo-direction': 'rtl',
    'x-varendo-theme': 'dark',
  });
  await page.goto('/vnext/ssr/people');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('cell', { name: 'Bela Rossi', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-varendo-hydrated', 'true');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
});

test('a static page can hydrate one optional Varendo island', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('Islands fixture requires baseURL');
  const noJavaScript = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const staticPage = await noJavaScript.newPage();
    await staticPage.goto('/islands/');
    await expect(staticPage.getByText('This page stays useful when JavaScript is unavailable.')).toBeVisible();
  } finally {
    await noJavaScript.close();
  }

  const hydrated = await browser.newContext({ baseURL });
  try {
    const page = await hydrated.newPage();
    const errors = captureBrowserErrors(page);
    await page.goto('/islands/');
    await expect(page.locator('#island-status')).toHaveText('Island hydrated.');
    await page.getByLabel('Island person').fill('Lin');
    await expect(page.getByLabel('Island person')).toHaveValue('Lin');
    expect(errors).toEqual([]);
  } finally {
    await hydrated.close();
  }
});
