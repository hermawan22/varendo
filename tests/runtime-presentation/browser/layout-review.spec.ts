import { test, expect } from '@playwright/test';
type Host = typeof window & {
  layoutFixture: {
    render(kind: 'workspace' | 'page'): Promise<{ status: string; diagnostics: unknown }>;
    initialPartsBeforeCompletion(): { rejected: boolean; preserved: boolean; cleared: boolean }[];
    reversedParts(): { sameInput: boolean; cleared: boolean };
    changeParentShape(fail: boolean): Promise<{ status: string }>;
    focusTable(): void;
    failAfterMove(): Promise<{ status: string }>;
    dispose(): void;
    revoke(): Promise<{ status: string }>;
    interact(): Promise<void>;
    lifecycle(): { created: number; active: number; disconnected: number; reconnected: number };
    snapshot(): { tableFocused: boolean; root: string; pins: number; outputIds: string[]; sameTable: boolean };
  };
};
test('shared registered workspace and page retain bounded result ownership across five round trips', async ({
  page,
}) => {
  await page.goto('/tests/runtime-presentation/browser/layout-review.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  for (let cycle = 0; cycle < 5; cycle++) {
    for (const kind of ['page', 'workspace'] as const) {
      const receipt = await page.evaluate((next) => (window as Host).layoutFixture.render(next), kind);
      expect(receipt.status, JSON.stringify(receipt)).toBe('renderer-ready');
      const snapshot = await page.evaluate(() => (window as Host).layoutFixture.snapshot());
      expect(snapshot.root).toBe(kind === 'page' ? 'page' : 'workspace');
      expect(snapshot.pins).toBe(3);
      expect(snapshot.outputIds).toEqual(['breakdown', 'summary', 'trend']);
      await expect(page.locator('aeliqo-table')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Attendance overview' })).toHaveCount(kind === 'page' ? 1 : 0);
    }
  }
});

test('shared page wrapper preserves focused breakdown child instance', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/layout-review.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  await page.evaluate(() => (window as Host).layoutFixture.focusTable());
  expect((await page.evaluate(() => (window as Host).layoutFixture.snapshot())).tableFocused).toBe(true);
  const receipt = await page.evaluate(() => (window as Host).layoutFixture.render('page'));
  expect(receipt.status, JSON.stringify(receipt)).toBe('renderer-ready');
  const after = await page.evaluate(() => (window as Host).layoutFixture.snapshot());
  expect(after.sameTable, JSON.stringify(after)).toBe(true);
  expect(after.tableFocused).toBe(true);
});

test('shared page wrapper preserves keyboard focus on the metric control', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/layout-review.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  const control = page.locator('aeliqo-metric [part="number"][tabindex="0"]');
  await control.focus();
  await expect(control).toBeFocused();
  const receipt = await page.evaluate(() => (window as Host).layoutFixture.render('page'));
  expect(receipt.status, JSON.stringify(receipt)).toBe('renderer-ready');
  await expect(control).toBeFocused();
});

test('failed directive after subtree movement restores original child and canonical snapshot', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/layout-review.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  await page.evaluate(() => (window as Host).layoutFixture.focusTable());
  const before = await page.evaluate(() => (window as Host).layoutFixture.snapshot());
  const receipt = await page.evaluate(() => (window as Host).layoutFixture.failAfterMove());
  expect(receipt.status).toBe('failed');
  expect(await page.evaluate(() => (window as Host).layoutFixture.snapshot())).toEqual(before);
  expect((await page.evaluate(() => (window as Host).layoutFixture.lifecycle())).active).toBe(0);
});

test('retired node directives release and dispose clears all active owners', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/layout-review.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  for (let cycle = 0; cycle < 3; cycle++) {
    expect((await page.evaluate(() => (window as Host).layoutFixture.render('page'))).status).toBe('renderer-ready');
    expect((await page.evaluate(() => (window as Host).layoutFixture.lifecycle())).active).toBe(1);
    expect((await page.evaluate(() => (window as Host).layoutFixture.render('workspace'))).status).toBe(
      'renderer-ready',
    );
    expect((await page.evaluate(() => (window as Host).layoutFixture.lifecycle())).active).toBe(0);
  }
  const retired = await page.evaluate(() => (window as Host).layoutFixture.lifecycle());
  expect(retired.created).toBe(3);
  expect(retired.disconnected).toBeGreaterThanOrEqual(3);
  await page.evaluate(() => (window as Host).layoutFixture.render('page'));
  await page.evaluate(() => (window as Host).layoutFixture.dispose());
  expect((await page.evaluate(() => (window as Host).layoutFixture.lifecycle())).active).toBe(0);
  await expect(page.locator('aeliqo-table')).toHaveCount(0);
});

test('revocation clears movable parts and active directive ownership', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/layout-review.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  await page.evaluate(() => (window as Host).layoutFixture.render('page'));
  await page.evaluate(() => (window as Host).layoutFixture.revoke());
  expect((await page.evaluate(() => (window as Host).layoutFixture.lifecycle())).active).toBe(0);
  await expect(page.locator('aeliqo-table')).toHaveCount(0);
});

test('same-layout interaction update keeps directive connections and child instances stable', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/layout-review.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  await page.evaluate(() => (window as Host).layoutFixture.render('page'));
  const before = await page.evaluate(() => (window as Host).layoutFixture.lifecycle());
  await page.evaluate(() => (window as Host).layoutFixture.focusTable());
  await page.evaluate(() => (window as Host).layoutFixture.interact());
  expect(await page.evaluate(() => (window as Host).layoutFixture.lifecycle())).toEqual(before);
  const after = await page.evaluate(() => (window as Host).layoutFixture.snapshot());
  expect(after.sameTable).toBe(true);
  expect(after.tableFocused).toBe(true);
});

test('existing node parts survive reversed ancestor order and release on clear', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/layout-review.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  expect(await page.evaluate(() => (window as Host).layoutFixture.reversedParts())).toEqual({
    sameInput: true,
    cleared: true,
  });
});

test('custom parent conditional wrapper preserves children and rolls back from captured configuration changes', async ({
  page,
}) => {
  await page.goto('/tests/runtime-presentation/browser/layout-review.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  const initialPage = await page.evaluate(() => (window as Host).layoutFixture.render('page'));
  expect(initialPage.status, JSON.stringify(initialPage)).toBe('renderer-ready');
  const before = await page.evaluate(() => (window as Host).layoutFixture.snapshot());
  const rejected = await page.evaluate(() => (window as Host).layoutFixture.changeParentShape(true));
  expect(rejected.status, JSON.stringify(rejected)).toBe('failed');
  expect(await page.evaluate(() => (window as Host).layoutFixture.snapshot())).toEqual(before);
  await expect(page.locator('[data-conditional-wrapper]')).toHaveCount(0);
  const applied = await page.evaluate(() => (window as Host).layoutFixture.render('page'));
  expect(applied.status).toBe('renderer-ready');
  await expect(page.locator('[data-conditional-wrapper]')).toBeVisible();
  expect((await page.evaluate(() => (window as Host).layoutFixture.snapshot())).sameTable).toBe(true);
});

test('stale publication completion cannot retire parts needed by a newer rollback', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/layout-review.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  const restored = await page.evaluate(async () => {
    const element = document.querySelector('aeliqo-region') as HTMLElement & {
      presentation: unknown;
      preparePublication(): { apply(): void; rollback(): void; complete(): void };
    };
    const workspace = element.presentation;
    await (window as Host).layoutFixture.render('page');
    const prior = element.presentation;
    const header = element.shadowRoot!.querySelector('.demo-page-header');
    const older = element.preparePublication();
    element.presentation = { ...(prior as object) };
    older.apply();
    const newer = element.preparePublication();
    element.presentation = workspace;
    newer.apply();
    older.complete();
    element.presentation = prior;
    newer.rollback();
    newer.complete();
    return header === element.shadowRoot!.querySelector('.demo-page-header');
  });
  expect(restored).toBe(true);
});

test('first synchronous render and failure retain pending parts before completion', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/layout-review.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  expect(await page.evaluate(() => (window as Host).layoutFixture.initialPartsBeforeCompletion())).toEqual([
    { rejected: false, preserved: true, cleared: true },
    { rejected: true, preserved: true, cleared: true },
  ]);
});
