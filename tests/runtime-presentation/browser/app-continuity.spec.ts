import { expect, test } from '@playwright/test';
type Fixture = {
  refreshSource(): { ok: boolean };
  render(layout: string): Promise<{ status: string; diagnostics: readonly unknown[] }>;
  snapshot(): {
    taskId: string | undefined;
    resultId: string | undefined;
    selectedResultId: string | undefined;
    selectedKeys: readonly string[];
    sameTable: boolean;
    sameFilter: boolean;
    filter: string;
  };
};
type Host = typeof window & { continuityFixture: Fixture };

test('registered workspace to page retains stable children, focused filter, and rebased selected row', async ({
  page,
}) => {
  await page.goto('/tests/runtime-presentation/browser/app-continuity.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  await page.getByRole('checkbox', { name: 'Select people ada', exact: true }).check();
  const filter = page.getByRole('textbox', { name: 'Filter people' });
  await filter.fill('Ada');
  await filter.focus();
  const before = await page.evaluate(() => (window as Host).continuityFixture.snapshot());
  const receipt = await page.evaluate(() => (window as Host).continuityFixture.render('page'));
  expect(receipt.status, JSON.stringify(receipt)).toBe('renderer-ready');
  await expect(page.getByRole('heading', { name: 'People overview' })).toBeVisible();
  await expect(page.getByText('Host sidebar', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Deselect people ada', exact: true })).toBeChecked();
  await expect(filter).toHaveValue('Ada');
  await expect(filter).toBeFocused();
  const after = await page.evaluate(() => (window as Host).continuityFixture.snapshot());
  expect(after.taskId).toBe('page');
  expect(after.resultId).not.toBe(before.resultId);
  expect(after.selectedResultId).toBe(after.resultId);
  expect(after.selectedKeys).toEqual(before.selectedKeys);
  expect(after.sameTable).toBe(true);
  expect(after.sameFilter).toBe(true);
  const reordered = await page.evaluate(() => (window as Host).continuityFixture.render('reordered-page'));
  expect(reordered.status, JSON.stringify(reordered)).toBe('renderer-ready');
  await expect(filter).toHaveValue('Ada');
  await expect(filter).toBeFocused();
  expect((await page.evaluate(() => (window as Host).continuityFixture.snapshot())).sameTable).toBe(true);
});

test('incompatible layout state owner fails without losing visible state or advancing task', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/app-continuity.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  const filter = page.getByRole('textbox', { name: 'Filter people' });
  await filter.fill('Ada');
  await filter.focus();
  const before = await page.evaluate(() => (window as Host).continuityFixture.snapshot());
  const receipt = await page.evaluate(() => (window as Host).continuityFixture.render('missing-filter'));
  expect(receipt.status).not.toBe('renderer-ready');
  expect(await page.evaluate(() => (window as Host).continuityFixture.snapshot())).toEqual(before);
  await expect(filter).toHaveValue('Ada');
  await expect(filter).toBeFocused();
});

test('a different query starts a new task without carrying previous selection or filter', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/app-continuity.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  await page.getByRole('checkbox', { name: 'Select people ada', exact: true }).check();
  const filter = page.getByRole('textbox', { name: 'Filter people' });
  await filter.fill('Ada');
  const receipt = await page.evaluate(() => (window as Host).continuityFixture.render('new-goal'));
  expect(receipt.status, JSON.stringify(receipt)).toBe('renderer-ready');
  await expect(filter).toHaveValue('');
  await expect(page.getByRole('checkbox', { name: 'Select people grace', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /ada/ })).toHaveCount(0);
  expect((await page.evaluate(() => (window as Host).continuityFixture.snapshot())).selectedKeys).toEqual([]);
});

test('ordinary same-query source refresh succeeds when no interaction state needs retention', async ({ page }) => {
  await page.goto('/tests/runtime-presentation/browser/app-continuity.html');
  await expect(page.locator('#status')).toHaveText('renderer-ready');
  const before = await page.evaluate(() => (window as Host).continuityFixture.snapshot());
  expect(await page.evaluate(() => (window as Host).continuityFixture.refreshSource())).toMatchObject({ ok: true });
  const receipt = await page.evaluate(() => (window as Host).continuityFixture.render('workspace'));
  expect(receipt.status, JSON.stringify(receipt)).toBe('renderer-ready');
  await expect(page.getByText('Ada refreshed', { exact: true })).toBeVisible();
  await expect(page.getByText('Lin', { exact: true })).toBeVisible();
  await expect(page.getByText('Grace', { exact: true })).toHaveCount(0);
  const after = await page.evaluate(() => (window as Host).continuityFixture.snapshot());
  expect(after.resultId).not.toBe(before.resultId);
  expect(after.selectedKeys).toEqual([]);
  await expect(page.getByRole('textbox', { name: 'Filter people' })).toHaveValue('');
});
