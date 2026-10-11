import { test, expect, type Page, type Route } from '@playwright/test';
type Fixture = {
  snapshot(): { runtime: unknown; plan: unknown; renders: number; sameInput: boolean };
  render(mode: string): Promise<{ status: string; diagnostics: readonly { code: string }[] }>;
  dispose(): void;
};
type Host = typeof window & { transactionFixture: Fixture; transactionReady: Promise<unknown> };

async function openTransaction(page: Page): Promise<void> {
  await page.goto('/tests/runtime-presentation/browser/app-transaction.html');
  // Page load precedes deferred module loading; begin the behavior check after initial render settles.
  await page.evaluate(() => (window as Host).transactionReady);
}

for (const mode of ['unsupported', 'throw'])
  test(`${mode} replacement retains canonical task, DOM and focused input`, async ({ page }) => {
    await openTransaction(page);
    await expect(page.locator('#status')).toHaveText('renderer-ready');
    const input = page.getByRole('textbox', { name: 'Host draft' });
    await input.fill('Unsaved');
    await input.focus();
    const before = await page.evaluate(() => (window as Host).transactionFixture.snapshot());
    const result = await page.evaluate((mode) => (window as Host).transactionFixture.render(mode), mode);
    expect(result.status, JSON.stringify(result)).not.toBe('renderer-ready');
    if (mode === 'throw')
      expect(
        result.diagnostics.some((item) => item.code === 'web.app.renderer'),
        JSON.stringify(result),
      ).toBe(true);
    const after = await page.evaluate(() => (window as Host).transactionFixture.snapshot());
    if (mode === 'throw') expect(after.renders).toBeGreaterThan(before.renders);
    expect(after.runtime).toEqual(before.runtime);
    expect(after.plan).toEqual(before.plan);
    expect(after.sameInput).toBe(true);
    await expect(input).toHaveValue('Unsaved');
    await expect(input).toBeFocused();
    await expect(page.locator('aeliqo-region')).toContainText('Ada');
  });

test('host revocation during renderer apply cannot publish or restore private DOM', async ({ page }) => {
  await openTransaction(page);
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  const result = await page.evaluate(() => (window as Host).transactionFixture.render('revoke'));
  expect(result.status, JSON.stringify(result)).not.toBe('renderer-ready');
  await expect(page.locator('aeliqo-region'), JSON.stringify(result)).not.toContainText('Ada');
  await expect(page.getByRole('textbox', { name: 'Host draft' })).toHaveCount(0);
});

type RegistrationHost = typeof window & {
  registrationFixture: {
    render(kind: string): Promise<{ status: string; diagnostics: readonly { code: string }[] }>;
    start(kind: string): void;
    finish(): Promise<{ status: string }>;
    snapshot(): { runtime: unknown; plan: unknown };
    revoke(): void;
    dispose(): void;
    resize(width: number): void;
  };
};
const registrationUrl = '/tests/runtime-presentation/browser/app-registration.html';

test('app loads validated table, cards, trend and bar families as needed', async ({ page }) => {
  await page.goto(registrationUrl);
  await expect(page.locator('#status')).toHaveText('mounted');
  expect(
    await page.evaluate(() =>
      ['aeliqo-region', 'aeliqo-table', 'aeliqo-chart'].every((name) => customElements.get(name)),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        customElements.get('aeliqo-comparison') === undefined &&
        customElements.get('aeliqo-card-collection') === undefined &&
        customElements.get('aeliqo-bar') === undefined,
    ),
  ).toBe(true);
  for (const [kind, tag] of [
    ['table', 'aeliqo-table'],
    ['cards', 'aeliqo-card-collection'],
    ['trend', 'aeliqo-chart'],
    ['bar', 'aeliqo-bar'],
  ]) {
    const result = await page.evaluate((kind) => (window as RegistrationHost).registrationFixture.render(kind), kind);
    expect(result.status, JSON.stringify(result)).toBe('renderer-ready');
    await expect(page.locator(`aeliqo-region ${tag}`)).toBeVisible();
  }
  expect(
    await page.evaluate(
      () => customElements.get('aeliqo-comparison') === undefined && customElements.get('aeliqo-tree') === undefined,
    ),
  ).toBe(true);
});

test('custom views retain registration of compound elements and their children', async ({ page }) => {
  await page.goto(registrationUrl);
  const result = await page.evaluate(() => (window as RegistrationHost).registrationFixture.render('custom'));
  expect(result.status, JSON.stringify(result)).toBe('renderer-ready');
  await expect(page.locator('aeliqo-region aeliqo-comparison aeliqo-table')).toContainText('Ada');
  expect(await page.evaluate(() => customElements.get('aeliqo-tree') !== undefined)).toBe(true);
});

test('failed family loading leaves the previous valid task and DOM intact', async ({ page }) => {
  await page.goto(registrationUrl);
  await page.evaluate(() => (window as RegistrationHost).registrationFixture.render('table'));
  await page.route('**/register-data.ts*', (route) => route.abort());
  const result = await page.evaluate(async () => {
    const fixture = (window as RegistrationHost).registrationFixture;
    const before = fixture.snapshot();
    const receipt = await fixture.render('cards');
    return { before, receipt, after: fixture.snapshot() };
  });
  expect(result.receipt.status, JSON.stringify(result)).toBe('failed');
  expect(result.receipt.diagnostics.some((item) => item.code === 'web.app.registration')).toBe(true);
  expect(result.after).toEqual(result.before);
  await expect(page.locator('aeliqo-region aeliqo-table')).toContainText('Ada');
  await expect(page.locator('aeliqo-card-collection')).toHaveCount(0);
});

for (const action of ['revoke', 'dispose'] as const)
  test(`pending family loading cannot publish after ${action}`, async ({ page }) => {
    await page.goto(registrationUrl);
    await page.evaluate(() => (window as RegistrationHost).registrationFixture.render('table'));
    let release!: (route: Route) => void;
    const intercepted = new Promise<Route>((resolve) => {
      release = resolve;
    });
    await page.route('**/register-data.ts*', (route) => release(route));
    await page.evaluate(() => (window as RegistrationHost).registrationFixture.start('cards'));
    const route = await intercepted;
    await page.evaluate((action) => (window as RegistrationHost).registrationFixture[action](), action);
    await route.continue();
    const receipt = await page.evaluate(() => (window as RegistrationHost).registrationFixture.finish());
    expect(receipt.status).not.toBe('renderer-ready');
    if (action === 'dispose') await expect(page.locator('aeliqo-region')).toHaveCount(0);
    else await expect(page.locator('aeliqo-region')).not.toContainText('Ada');
    await expect(page.locator('aeliqo-card-collection')).toHaveCount(0);
  });

test('incompatible lazy family registration rejects replacement', async ({ page }) => {
  await page.goto(registrationUrl);
  await page.evaluate(() => (window as RegistrationHost).registrationFixture.render('table'));
  await page.evaluate(() =>
    customElements.define(
      'aeliqo-bar',
      class extends HTMLElement {
        static aeliqoVersion = 'incompatible';
      },
    ),
  );
  const result = await page.evaluate(() => (window as RegistrationHost).registrationFixture.render('bar'));
  expect(result.status).toBe('failed');
  expect(result.diagnostics.some((item) => item.code === 'web.app.registration')).toBe(true);
  await expect(page.locator('aeliqo-region aeliqo-table')).toContainText('Ada');
});

test('container adaptation awaits registration before publishing cards', async ({ page }) => {
  await page.goto(registrationUrl);
  await page.evaluate(() => (window as RegistrationHost).registrationFixture.render('auto'));
  await expect(page.locator('aeliqo-region aeliqo-table')).toContainText('Ada');
  let release!: (route: Route) => void;
  const intercepted = new Promise<Route>((resolve) => {
    release = resolve;
  });
  await page.route('**/register-data.ts*', (route) => release(route));
  await page.evaluate(() => (window as RegistrationHost).registrationFixture.resize(360));
  const route = await intercepted;
  await expect(page.locator('aeliqo-region aeliqo-table')).toContainText('Ada');
  await expect(page.locator('aeliqo-card-collection')).toHaveCount(0);
  await route.continue();
  await expect(page.locator('aeliqo-region aeliqo-card-collection')).toContainText('Ada');
});

for (const action of ['failure', 'revoke'] as const)
  test(`container adaptation preserves publication rules after loading ${action}`, async ({ page }) => {
    await page.goto(registrationUrl);
    await page.evaluate(() => (window as RegistrationHost).registrationFixture.render('auto'));
    let release!: (route: Route) => void;
    const intercepted = new Promise<Route>((resolve) => {
      release = resolve;
    });
    await page.route('**/register-data.ts*', (route) => release(route));
    await page.evaluate(() => (window as RegistrationHost).registrationFixture.resize(360));
    const route = await intercepted;
    const before = await page.evaluate(() => (window as RegistrationHost).registrationFixture.snapshot());
    if (action === 'revoke') {
      await page.evaluate(() => (window as RegistrationHost).registrationFixture.revoke());
      await route.continue();
      await expect(page.locator('aeliqo-region')).not.toContainText('Ada');
    } else {
      const failed = page.waitForEvent('requestfailed', (request) => request.url().includes('register-data.ts'));
      await route.abort();
      await failed;
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      );
      const after = await page.evaluate(() => (window as RegistrationHost).registrationFixture.snapshot());
      expect(after).toEqual(before);
      await expect(page.locator('aeliqo-region aeliqo-table')).toContainText('Ada');
    }
    await expect(page.locator('aeliqo-card-collection')).toHaveCount(0);
  });
