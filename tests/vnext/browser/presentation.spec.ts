import { expect, test } from '@playwright/test';

async function setRegionWidth(page: import('@playwright/test').Page, width: number): Promise<void> {
  await page.locator('#people-host').evaluate((element, value) => {
    (element as HTMLElement).style.width = `${value}px`;
  }, width);
}

test.describe('public app presentation paths', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#page-status')).toHaveText('Ready');
  });

  test('renders the registered table and cards browse views', async ({ page }) => {
    await page.getByRole('button', { name: 'Adaptive' }).click();
    await expect(page.locator('#people-status')).toContainText('renderer-ready:data.table');
    await expect(page.locator('#people-host aeliqo-table')).toHaveCount(1);
    await expect(page.getByText('Ada Chen')).toBeVisible();

    await page.getByRole('button', { name: 'Cards' }).click();
    await expect(page.locator('#people-status')).toContainText('renderer-ready:data.card-collection');
    await expect(page.locator('#people-host aeliqo-card-collection')).toHaveCount(1);
  });

  test('commits the Jakarta people filter through the public browse intent', async ({ page }) => {
    await page.getByRole('button', { name: 'People in Jakarta' }).click();
    await expect(page.locator('#people-status')).toContainText('renderer-ready:data.table');
    await expect(page.locator('#people-filter')).toHaveText('People with location Jakarta · scope vnext-scope');
    await expect(page.locator('#people-host aeliqo-table').getByText('Ada Chen')).toBeVisible();
    await expect(page.locator('#people-host aeliqo-table').getByText('Sam Rivera')).toHaveCount(0);
    await expect(page.locator('#people-host aeliqo-table').getByText('Iman Putra')).toHaveCount(0);
  });

  test('adapts the Jakarta browse to a compact eligible view in a narrow container', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await setRegionWidth(page, 280);
    await page.getByRole('button', { name: 'People in Jakarta' }).click();
    await expect(page.locator('#people-status')).toContainText('renderer-ready:data.card-collection');
    await expect(page.locator('#people-host aeliqo-card-collection').getByText('Ada Chen')).toBeVisible();
    await expect(page.locator('#people-filter')).toHaveText('People with location Jakarta · scope vnext-scope');
  });

  test('a late earlier browse receipt does not replace the latest Jakarta label or status', async ({ page }) => {
    await page.getByRole('button', { name: 'Start cancellable update' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-people-read-held', 'true');
    await page.getByRole('button', { name: 'People in Jakarta' }).click();
    await expect(page.locator('#people-filter')).toHaveText('People with location Jakarta · scope vnext-scope');
    await expect(page.locator('body')).toHaveAttribute('data-people-read-held', 'false');
    await expect(page.locator('#people-status')).toContainText('renderer-ready:data.table');
    await expect(page.locator('#people-filter')).toHaveText('People with location Jakarta · scope vnext-scope');
  });

  test('renders the registered bar analysis view', async ({ page }) => {
    await page.getByRole('button', { name: 'Bar' }).click();
    await expect(page.locator('#analysis-status')).toContainText('renderer-ready:visualization.bar');
    await expect(page.locator('#analysis-host aeliqo-bar')).toHaveCount(1);
  });

  test('renders a bounded comparison split with one identity-scoped detail per child', async ({ page }) => {
    await page.getByRole('button', { name: 'Compare' }).click();
    await expect(page.locator('#compare-status')).toContainText('renderer-ready:foundation.split-pane');
    await expect(page.locator('#compare-host aeliqo-split-pane')).toHaveCount(1);
    const details = page.locator('#compare-host aeliqo-detail');
    await expect(details).toHaveCount(2);
    await expect(details.nth(0).getByText('Ada Chen')).toBeVisible();
    await expect(details.nth(0).getByText('Sam Rivera')).toHaveCount(0);
    await expect(details.nth(1).getByText('Sam Rivera')).toBeVisible();
    await expect(details.nth(1).getByText('Ada Chen')).toHaveCount(0);
  });

  test('preserves the last valid table when a later request is unsupported', async ({ page }) => {
    await page.getByRole('button', { name: 'Table' }).click();
    await expect(page.locator('#people-status')).toContainText('renderer-ready:data.table');
    await expect(page.locator('#people-host aeliqo-table')).toHaveCount(1);
    await page.getByRole('button', { name: 'Unsupported request' }).click();
    await expect(page.locator('#people-status')).toContainText('unsupported:');
    await expect(page.locator('#people-host aeliqo-table')).toHaveCount(1);
    await expect(page.getByText('Ada Chen')).toBeVisible();
  });

  test('keeps a focused dirty draft through a guarded resize and adapts after blur', async ({ page }) => {
    await page.getByRole('button', { name: 'Table' }).click();
    const draft = page.getByLabel('Draft note');
    await draft.fill('keep this draft');
    await draft.focus();

    await setRegionWidth(page, 620);
    await expect(draft).toBeFocused();
    await expect(draft).toHaveValue('keep this draft');

    await page.getByRole('heading', { name: 'People browse' }).click();
    await expect(page.locator('#people-status')).toContainText('renderer-ready:data.table');
    await page.getByRole('button', { name: 'Cards' }).click();
    await expect(page.locator('#people-status')).toContainText('renderer-ready:data.card-collection');
    await expect(draft).toHaveValue('keep this draft');
  });

  test('applies resize hysteresis around the breakpoint without disturbing another region', async ({ page }) => {
    await page.getByRole('button', { name: 'Compare' }).click();
    await expect(page.locator('#compare-host aeliqo-detail')).toHaveCount(2);
    await page.getByRole('button', { name: 'Adaptive' }).click();
    await setRegionWidth(page, 600);
    await expect(page.locator('#people-host aeliqo-card-collection')).toHaveCount(1);
    await setRegionWidth(page, 640);
    await expect(page.locator('#people-host aeliqo-card-collection')).toHaveCount(1);
    await setRegionWidth(page, 664);
    await expect(page.locator('#people-host aeliqo-card-collection')).toHaveCount(1);
    await setRegionWidth(page, 680);
    await expect(page.locator('#people-host aeliqo-table')).toHaveCount(1);
    await setRegionWidth(page, 616);
    await expect(page.locator('#people-host aeliqo-table')).toHaveCount(1);
    await setRegionWidth(page, 600);
    await expect(page.locator('#people-host aeliqo-card-collection')).toHaveCount(1);
    await expect(page.locator('#compare-host aeliqo-detail')).toHaveCount(2);
  });
});
